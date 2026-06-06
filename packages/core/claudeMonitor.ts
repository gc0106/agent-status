import path from "node:path";
import {
  claudeProjectKeyToDisplayName,
  claudeProjectKeyToWorkspacePath,
  getClaudeProjectsDir,
  listClaudeProjectKeys,
  makeClaudeSessionCapsuleKey,
} from "./claudePaths";
import { fileExists, getLatestMtime, readFileTail, safeReadDir } from "./paths";
import { withMtimeCache } from "./parseCache";
import type {
  AgentConversation,
  ClaudeRuntimeInfo,
  ProjectCapsule,
  SessionPreview,
  ToolInfo,
  TrafficLight,
} from "./types";

const GREEN_WINDOW_MS = 10_000;
const YELLOW_WINDOW_MS = 30_000;
const VISIBLE_WINDOW_MS = 24 * 60 * 60_000;
const RUNNING_PROCESS_WINDOW_MS = 30 * 60_000;

interface ParsedClaudeTranscript {
  sessionId: string | null;
  lastActivityAt: number;
  lastUserAt: number | null;
  lastAgentAt: number | null;
  preview: SessionPreview;
  workspacePath: string | null;
}

function truncate(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function isToolResultUserMessage(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    return (block as Record<string, unknown>).type === "tool_result";
  });
}

function parseClaudeTranscriptFile(transcriptPath: string, fallbackSessionId: string): ParsedClaudeTranscript {
  const content = readFileTail(transcriptPath);
  const lines = content.split(/\r?\n/).filter(Boolean);
  const mtime = getLatestMtime(transcriptPath);

  let sessionId: string | null = fallbackSessionId;
  let lastUserAt: number | null = null;
  let lastAgentAt: number | null = null;
  let lastUserMessage: string | undefined;
  let lastAgentMessage: string | undefined;
  const recentTools: ToolInfo[] = [];
  let lastRole: "user" | "assistant" | null = null;
  let workspacePath: string | null = null;

  for (const line of lines) {
    const row = parseJsonLine(line);
    if (!row) {
      continue;
    }

    if (typeof row.sessionId === "string") {
      sessionId = row.sessionId;
    }
    if (typeof row.cwd === "string") {
      workspacePath = row.cwd;
    }

    const rowType = row.type;
    const message = row.message as Record<string, unknown> | undefined;
    const timestamp = parseTimestamp(row.timestamp, mtime);

    if (rowType === "user" && message) {
      const rawContent = message.content;
      if (isToolResultUserMessage(rawContent)) {
        continue;
      }

      lastRole = "user";
      lastUserAt = timestamp;

      if (typeof rawContent === "string") {
        lastUserMessage = rawContent;
      } else if (Array.isArray(rawContent)) {
        for (const block of rawContent) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const typed = block as Record<string, unknown>;
          if (typed.type === "text" && typeof typed.text === "string") {
            lastUserMessage = typed.text;
          }
        }
      }
    }

    if (rowType === "assistant" && message) {
      lastRole = "assistant";
      lastAgentAt = timestamp;
      const blocks = (message.content as Array<Record<string, unknown>>) ?? [];

      for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string") {
          lastAgentMessage = block.text;
        }
        if (block.type === "tool_use") {
          const name = typeof block.name === "string" ? block.name : "tool";
          const input = block.input as Record<string, unknown> | undefined;
          const target =
            typeof input?.file_path === "string"
              ? input.file_path
              : typeof input?.path === "string"
                ? input.path
                : typeof input?.pattern === "string"
                  ? input.pattern
                  : typeof input?.command === "string"
                    ? input.command
                    : undefined;
          recentTools.push({ name, target: target ? truncate(target, 60) : undefined });
        }
      }
    }
  }

  const lastActivityAt = Math.max(mtime, lastUserAt ?? 0, lastAgentAt ?? 0);

  return {
    sessionId,
    lastActivityAt,
    lastUserAt,
    lastAgentAt,
    workspacePath,
    preview: {
      lastUserMessage: lastUserMessage ? truncate(lastUserMessage, 160) : undefined,
      lastAgentMessage: lastAgentMessage ? truncate(lastAgentMessage, 160) : undefined,
      recentTools: recentTools.slice(-4).reverse(),
    },
  };
}

function inferConversationStatus(parsed: ParsedClaudeTranscript, now: number): {
  status: TrafficLight;
  taskStartedAt: number | null;
} {
  const age = now - parsed.lastActivityAt;

  if (age <= GREEN_WINDOW_MS) {
    const waitingForUser =
      parsed.lastUserAt !== null &&
      (parsed.lastAgentAt === null || parsed.lastUserAt > parsed.lastAgentAt);
    if (waitingForUser && age <= YELLOW_WINDOW_MS) {
      return { status: "yellow", taskStartedAt: parsed.lastUserAt };
    }
    return { status: "green", taskStartedAt: parsed.lastUserAt ?? parsed.lastActivityAt };
  }

  if (
    parsed.lastUserAt !== null &&
    (parsed.lastAgentAt === null || parsed.lastUserAt >= parsed.lastAgentAt) &&
    age <= YELLOW_WINDOW_MS
  ) {
    return { status: "yellow", taskStartedAt: parsed.lastUserAt };
  }

  return { status: "gray", taskStartedAt: null };
}

function collectClaudeTranscriptPaths(projectDir: string): Array<{ id: string; path: string; isSubagent: boolean }> {
  const results: Array<{ id: string; path: string; isSubagent: boolean }> = [];

  for (const entry of safeReadDir(projectDir)) {
    const entryPath = path.join(projectDir, entry);
    if (entry.endsWith(".jsonl") && fileExists(entryPath)) {
      results.push({ id: entry.replace(/\.jsonl$/, ""), path: entryPath, isSubagent: false });
      continue;
    }

    const maybeSessionFile = path.join(entryPath, `${entry}.jsonl`);
    if (fileExists(maybeSessionFile)) {
      results.push({ id: entry, path: maybeSessionFile, isSubagent: false });
    }

    const subagentsDir = path.join(entryPath, "subagents");
    for (const subId of safeReadDir(subagentsDir)) {
      const subFile = path.join(subagentsDir, subId.endsWith(".jsonl") ? subId : `${subId}.jsonl`);
      if (fileExists(subFile)) {
        results.push({ id: subId.replace(/\.jsonl$/, ""), path: subFile, isSubagent: true });
      }
    }
  }

  const deduped = new Map<string, { id: string; path: string; isSubagent: boolean }>();
  for (const item of results) {
    deduped.set(item.path, item);
  }
  return [...deduped.values()];
}

function buildSessionCapsule(
  projectKey: string,
  sessionId: string,
  transcriptPath: string,
  isSubagent: boolean,
  now: number,
): ProjectCapsule | null {
  const parsed = withMtimeCache(transcriptPath, () =>
    parseClaudeTranscriptFile(transcriptPath, sessionId),
  );
  const resolvedSessionId = parsed.sessionId ?? sessionId;
  const { status, taskStartedAt } = inferConversationStatus(parsed, now);
  const workspacePath = parsed.workspacePath ?? claudeProjectKeyToWorkspacePath(projectKey);
  const projectName = claudeProjectKeyToDisplayName(projectKey);
  const labelPrefix = isSubagent ? `${projectName} · sub` : projectName;

  const conversation: AgentConversation = {
    id: resolvedSessionId,
    isSubagent,
    status,
    taskStartedAt,
    lastActivityAt: parsed.lastActivityAt,
    preview: parsed.preview,
    transcriptPath,
  };

  return {
    projectKey: makeClaudeSessionCapsuleKey(resolvedSessionId),
    source: "claude-cli",
    displayName: `${labelPrefix} · ${shortSessionId(resolvedSessionId)}`,
    workspacePath,
    windowTitle: null,
    status,
    taskStartedAt,
    lastActivityAt: parsed.lastActivityAt,
    conversations: [conversation],
    resumeSessionId: resolvedSessionId,
  };
}

function shouldShowSession(
  capsule: ProjectCapsule,
  now: number,
  activeSessionIds: Set<string>,
  runningProcessCount: number,
): boolean {
  const sessionId = capsule.resumeSessionId;
  if (sessionId && activeSessionIds.has(sessionId)) {
    return true;
  }
  if (capsule.status !== "gray") {
    return true;
  }
  if (now - capsule.lastActivityAt <= VISIBLE_WINDOW_MS) {
    return true;
  }
  if (runningProcessCount > 0 && now - capsule.lastActivityAt <= RUNNING_PROCESS_WINDOW_MS) {
    return true;
  }
  return false;
}

function createRunningProcessCapsule(
  pid: number,
  sessionId: string | null,
  now: number,
  index: number,
): ProjectCapsule {
  const id = sessionId ?? `pid-${pid}`;
  const displayName = sessionId
    ? `Claude CLI · ${shortSessionId(sessionId)}`
    : `Claude CLI · 窗口 ${index}`;

  return {
    projectKey: makeClaudeSessionCapsuleKey(id),
    source: "claude-cli",
    displayName,
    workspacePath: null,
    windowTitle: null,
    status: "green",
    taskStartedAt: now,
    lastActivityAt: now,
    claudePid: pid,
    resumeSessionId: sessionId ?? undefined,
    conversations: [
      {
        id,
        isSubagent: false,
        status: "green",
        taskStartedAt: now,
        lastActivityAt: now,
        preview: {
          lastAgentMessage: "Claude CLI 正在运行（cmd 窗口）",
          recentTools: [],
        },
        transcriptPath: "",
      },
    ],
  };
}

export function scanClaudeSessions(now: number, runtime: ClaudeRuntimeInfo = { processes: [] }): ProjectCapsule[] {
  const activeSessionIds = new Set(
    runtime.processes.map((item) => item.sessionId).filter((id): id is string => Boolean(id)),
  );
  const runningProcessCount = runtime.processes.length;
  const capsules: ProjectCapsule[] = [];
  const seenSessionIds = new Set<string>();

  for (const projectKey of listClaudeProjectKeys()) {
    const projectDir = path.join(getClaudeProjectsDir(), projectKey);
    for (const { id, path: transcriptPath, isSubagent } of collectClaudeTranscriptPaths(projectDir)) {
      const capsule = buildSessionCapsule(projectKey, id, transcriptPath, isSubagent, now);
      if (!capsule?.resumeSessionId) {
        continue;
      }
      if (seenSessionIds.has(capsule.resumeSessionId)) {
        continue;
      }
      seenSessionIds.add(capsule.resumeSessionId);

      if (shouldShowSession(capsule, now, activeSessionIds, runningProcessCount)) {
        const proc = runtime.processes.find((item) => item.sessionId === capsule.resumeSessionId);
        if (proc) {
          capsule.claudePid = proc.pid;
          if (capsule.status === "gray") {
            capsule.status = "green";
          }
        }
        capsules.push(capsule);
      }
    }
  }

  let orphanIndex = 1;
  for (const proc of runtime.processes) {
    if (proc.sessionId && seenSessionIds.has(proc.sessionId)) {
      continue;
    }
    capsules.push(createRunningProcessCapsule(proc.pid, proc.sessionId, now, orphanIndex++));
    if (proc.sessionId) {
      seenSessionIds.add(proc.sessionId);
    }
  }

  return capsules.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** @deprecated use scanClaudeSessions */
export function scanClaudeProjects(now = Date.now(), runtime: ClaudeRuntimeInfo = { processes: [] }): ProjectCapsule[] {
  return scanClaudeSessions(now, runtime);
}
