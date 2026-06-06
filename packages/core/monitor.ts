import fs from "node:fs";
import path from "node:path";
import {
  fileExists,
  getCursorProjectsDir,
  getLatestMtime,
  isProcessAlive,
  listProjectKeys,
  projectKeyToDisplayName,
  projectKeyToWorkspacePath,
  readFileTail,
  safeReadDir,
} from "./paths";
import { makeCursorCapsuleKey } from "./claudePaths";
import { scanClaudeSessions } from "./claudeMonitor";
import { mergeOpenWindowCapsules, recomputeSummary, windowMatchesProject } from "./openWindows";
import { withMtimeCache } from "./parseCache";
import type { ClaudeRuntimeInfo } from "./types";
import type {
  AgentConversation,
  MonitorSnapshot,
  ProjectCapsule,
  SessionPreview,
  ToolInfo,
  TrafficLight,
} from "./types";

const GREEN_WINDOW_MS = 10_000;
const YELLOW_WINDOW_MS = 30_000;
const GRAY_WINDOW_MS = 30 * 60_000;
const VISIBLE_WINDOW_MS = 24 * 60 * 60_000;

interface ParsedTranscript {
  lastActivityAt: number;
  lastUserAt: number | null;
  lastAgentAt: number | null;
  preview: SessionPreview;
  hasTerminalError: boolean;
}

interface TerminalInfo {
  cwd: string | null;
  pid?: number;
  command?: string;
  running: boolean;
  hasError: boolean;
  mtime: number;
}

function extractUserQuery(text: string): string | undefined {
  const tagged = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (tagged?.[1]) {
    return tagged[1].trim();
  }
  return text.trim() || undefined;
}

function truncate(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseTranscriptFile(transcriptPath: string): ParsedTranscript {
  const content = readFileTail(transcriptPath);
  const lines = content.split(/\r?\n/).filter(Boolean);

  let lastUserAt: number | null = null;
  let lastAgentAt: number | null = null;
  let lastUserMessage: string | undefined;
  let lastAgentMessage: string | undefined;
  let currentStep: string | undefined;
  const recentTools: ToolInfo[] = [];
  let lastRole: "user" | "assistant" | null = null;

  for (const line of lines) {
    const row = parseJsonLine(line);
    if (!row) {
      continue;
    }

    const role = row.role;
    const message = row.message as Record<string, unknown> | undefined;
    const contentBlocks = (message?.content as Array<Record<string, unknown>>) ?? [];

    if (role === "user") {
      lastRole = "user";
      for (const block of contentBlocks) {
        if (block.type === "text" && typeof block.text === "string") {
          const query = extractUserQuery(block.text);
          if (query) {
            lastUserMessage = query;
          }
        }
      }
    }

    if (role === "assistant") {
      lastRole = "assistant";
      for (const block of contentBlocks) {
        if (block.type === "text" && typeof block.text === "string") {
          const cleaned = block.text.replace(/\[REDACTED\]/g, "").trim();
          if (cleaned) {
            lastAgentMessage = cleaned;
          }
        }

        if (block.type === "tool_use") {
          const name = typeof block.name === "string" ? block.name : "tool";
          if (name === "UpdateCurrentStep") {
            const input = block.input as Record<string, unknown> | undefined;
            const step = typeof input?.current_step === "string" ? input.current_step : undefined;
            if (step) {
              currentStep = step;
            }
          } else if (name === "Shell") {
            const input = block.input as Record<string, unknown> | undefined;
            const command = typeof input?.command === "string" ? input.command : undefined;
            recentTools.push({ name, target: command ? truncate(command, 60) : undefined });
          } else {
            const input = block.input as Record<string, unknown> | undefined;
            const target =
              typeof input?.path === "string"
                ? input.path
                : typeof input?.pattern === "string"
                  ? input.pattern
                  : typeof input?.query === "string"
                    ? input.query
                    : undefined;
            recentTools.push({ name, target: target ? truncate(target, 60) : undefined });
          }
        }
      }
    }
  }

  const mtime = getLatestMtime(transcriptPath);
  const lastActivityAt = mtime;
  if (lastRole === "user") {
    lastUserAt = mtime;
  } else if (lastRole === "assistant") {
    lastAgentAt = mtime;
  }

  return {
    lastActivityAt,
    lastUserAt,
    lastAgentAt,
    hasTerminalError: false,
    preview: {
      lastUserMessage: lastUserMessage ? truncate(lastUserMessage, 160) : undefined,
      lastAgentMessage: lastAgentMessage ? truncate(lastAgentMessage, 160) : undefined,
      currentStep,
      recentTools: recentTools.slice(-4).reverse(),
    },
  };
}

function parseTerminalFile(filePath: string): TerminalInfo {
  const content = fs.readFileSync(filePath, "utf8");
  const mtime = getLatestMtime(filePath);

  const pidMatch = content.match(/^pid:\s*(\d+)\s*$/m);
  const cwdMatch = content.match(/^cwd:\s*\|\s*\r?\n\s*(.+)\s*$/m);
  const activeCommandMatch = content.match(/^active_command:\s*\|\s*\r?\n([\s\S]*?)(?:\r?\n[^\s]|\r?\n---|\r?\nlast_command:|\r?\n$)/m);
  const lastCommandMatch = content.match(/^last_command:\s*\|\s*\r?\n([\s\S]*?)(?:\r?\nlast_exit_code:|\r?\n---|\r?\n$)/m);
  const exitCodeMatch = content.match(/^last_exit_code:\s*(\d+)\s*$/m);

  const pid = pidMatch ? Number(pidMatch[1]) : undefined;
  const cwd = cwdMatch?.[1]?.trim() ?? null;
  const activeCommand = activeCommandMatch?.[1]?.trim();
  const lastCommand = lastCommandMatch?.[1]?.trim();
  const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : undefined;

  const command = activeCommand || lastCommand;
  const running = Boolean(activeCommand) && isProcessAlive(pid);
  const hasError = !running && exitCode !== undefined && exitCode !== 0;

  return {
    cwd,
    pid,
    command: command ? truncate(command.replace(/\s+/g, " "), 80) : undefined,
    running,
    hasError,
    mtime,
  };
}

function inferConversationStatus(
  parsed: ParsedTranscript,
  terminal: TerminalInfo | undefined,
  now: number,
): { status: TrafficLight; taskStartedAt: number | null } {
  const age = now - parsed.lastActivityAt;

  if (terminal?.hasError) {
    return { status: "red", taskStartedAt: parsed.lastUserAt ?? parsed.lastActivityAt };
  }

  if (terminal?.running || age <= GREEN_WINDOW_MS) {
    const lastIsUser =
      parsed.lastUserAt !== null &&
      (parsed.lastAgentAt === null || parsed.lastUserAt > parsed.lastAgentAt);
    if (lastIsUser && age <= YELLOW_WINDOW_MS) {
      return { status: "yellow", taskStartedAt: parsed.lastUserAt };
    }
    return {
      status: "green",
      taskStartedAt: parsed.lastUserAt ?? parsed.lastActivityAt,
    };
  }

  if (
    parsed.lastUserAt !== null &&
    (parsed.lastAgentAt === null || parsed.lastUserAt >= parsed.lastAgentAt) &&
    age <= YELLOW_WINDOW_MS
  ) {
    return { status: "yellow", taskStartedAt: parsed.lastUserAt };
  }

  if (age >= GRAY_WINDOW_MS) {
    return { status: "gray", taskStartedAt: null };
  }

  return { status: "gray", taskStartedAt: null };
}

function collectTranscriptPaths(projectDir: string): Array<{ id: string; path: string; isSubagent: boolean }> {
  const transcriptsRoot = path.join(projectDir, "agent-transcripts");
  const results: Array<{ id: string; path: string; isSubagent: boolean }> = [];

  for (const sessionId of safeReadDir(transcriptsRoot)) {
    const sessionDir = path.join(transcriptsRoot, sessionId);
    const mainFile = path.join(sessionDir, `${sessionId}.jsonl`);
    if (fileExists(mainFile)) {
      results.push({ id: sessionId, path: mainFile, isSubagent: false });
    }

    const subagentsDir = path.join(sessionDir, "subagents");
    for (const subId of safeReadDir(subagentsDir)) {
      const subFile = path.join(subagentsDir, `${subId}.jsonl`);
      if (fileExists(subFile)) {
        results.push({ id: subId, path: subFile, isSubagent: true });
      }
    }
  }

  return results;
}

function mergeStatus(statuses: TrafficLight[]): TrafficLight {
  const priority: TrafficLight[] = ["red", "green", "yellow", "gray"];
  for (const level of priority) {
    if (statuses.includes(level)) {
      return level;
    }
  }
  return "gray";
}

function scanProject(projectKey: string, now: number, windowTitles: string[] = []): ProjectCapsule | null {
  const projectDir = path.join(getCursorProjectsDir(), projectKey);
  if (!fileExists(projectDir)) {
    return null;
  }

  const dirMtime = getLatestMtime(projectDir);
  const displayName = projectKeyToDisplayName(projectKey);
  const mightBeOpen = windowTitles.some(
    (title) =>
      title.toLowerCase().includes(displayName.toLowerCase()) ||
      title.toLowerCase().includes(`${displayName.toLowerCase()} - cursor`),
  );
  if (now - dirMtime > VISIBLE_WINDOW_MS && !mightBeOpen) {
    return null;
  }

  const terminalsDir = path.join(projectDir, "terminals");
  const terminalFiles = safeReadDir(terminalsDir)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => path.join(terminalsDir, name));

  const terminals = terminalFiles.map(parseTerminalFile);
  const activeTerminal = terminals
    .filter((t) => t.running || t.mtime > now - GRAY_WINDOW_MS)
    .sort((a, b) => b.mtime - a.mtime)[0];

  const workspaceFromTerminal = activeTerminal?.cwd ?? terminals.find((t) => t.cwd)?.cwd ?? null;
  const workspacePath = workspaceFromTerminal ?? projectKeyToWorkspacePath(projectKey);

  const conversations: AgentConversation[] = collectTranscriptPaths(projectDir)
    .map(({ id, path: transcriptPath, isSubagent }) => {
      const parsed = withMtimeCache(transcriptPath, () => parseTranscriptFile(transcriptPath));
      const { status, taskStartedAt } = inferConversationStatus(parsed, activeTerminal, now);
      return {
        id,
        isSubagent,
        status,
        taskStartedAt,
        lastActivityAt: parsed.lastActivityAt,
        preview: parsed.preview,
        transcriptPath,
      };
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  if (conversations.length === 0 && !activeTerminal) {
    return null;
  }

  const lastActivityAt = Math.max(
    ...conversations.map((c) => c.lastActivityAt),
    activeTerminal?.mtime ?? 0,
  );

  const statuses = conversations.map((c) => c.status);
  if (activeTerminal?.hasError) {
    statuses.push("red");
  } else if (activeTerminal?.running) {
    statuses.push("green");
  }

  const status = mergeStatus(statuses.length ? statuses : ["gray"]);
  const primary = conversations[0];
  const taskStartedAt = primary?.taskStartedAt ?? null;

  return {
    projectKey: makeCursorCapsuleKey(projectKey),
    source: "cursor",
    displayName: projectKeyToDisplayName(projectKey),
    workspacePath,
    windowTitle: workspacePath ? `${path.basename(workspacePath)} - Cursor` : null,
    status,
    taskStartedAt,
    lastActivityAt,
    conversations,
    activeTerminal: activeTerminal
      ? {
          command: activeTerminal.command,
          cwd: activeTerminal.cwd ?? undefined,
          pid: activeTerminal.pid,
          running: activeTerminal.running,
        }
      : undefined,
  };
}

export function buildMonitorSnapshot(
  windowTitles: string[] = [],
  claudeRuntime: ClaudeRuntimeInfo = { processes: [] },
): MonitorSnapshot {
  const now = Date.now();
  const cursorProjects = listProjectKeys()
    .map((projectKey) => scanProject(projectKey, now, windowTitles))
    .filter((project): project is ProjectCapsule => project !== null)
    .filter((project) => {
      if (project.status !== "gray") {
        return true;
      }
      if (now - project.lastActivityAt <= VISIBLE_WINDOW_MS) {
        return true;
      }
      return windowTitles.some((title) => windowMatchesProject(title, project));
    });

  const claudeProjects = scanClaudeSessions(now, claudeRuntime);
  const projects = mergeOpenWindowCapsules(
    [...cursorProjects, ...claudeProjects],
    windowTitles,
    now,
  );

  return {
    updatedAt: now,
    summary: recomputeSummary(projects),
    projects,
  };
}
