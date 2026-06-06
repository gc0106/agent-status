import path from "node:path";
import { makeCursorCapsuleKey } from "./claudePaths";
import type { AgentConversation, ProjectCapsule, TrafficLight } from "./types";

export interface OpenWindowInfo {
  title: string;
  displayName: string;
}

export function parseCursorWindowTitle(title: string): OpenWindowInfo | null {
  const trimmed = title.trim();
  const match = trimmed.match(/^(.+?) - Cursor$/i);
  if (!match?.[1]) {
    return null;
  }
  const displayName = match[1].trim();
  if (!displayName) {
    return null;
  }
  return { title: trimmed, displayName };
}

function guessWorkspaceFromDisplayName(displayName: string): string | null {
  if (displayName.includes("\\") || displayName.includes("/")) {
    return displayName;
  }
  return path.join("C:", "code", displayName);
}

function emptyConversation(now: number, hint: string): AgentConversation {
  return {
    id: "open-window",
    isSubagent: false,
    status: "gray",
    taskStartedAt: null,
    lastActivityAt: now,
    preview: {
      lastAgentMessage: hint,
      recentTools: [],
    },
    transcriptPath: "",
  };
}

export function createCapsuleFromOpenWindow(info: OpenWindowInfo, now: number): ProjectCapsule {
  return {
    projectKey: makeCursorCapsuleKey(`window::${info.displayName.toLowerCase()}`),
    source: "cursor",
    displayName: info.displayName,
    workspacePath: guessWorkspaceFromDisplayName(info.displayName),
    windowTitle: info.title,
    status: "gray",
    taskStartedAt: null,
    lastActivityAt: now,
    conversations: [emptyConversation(now, "窗口已打开，等待 Agent 活动…")],
  };
}

export function windowMatchesProject(title: string, project: ProjectCapsule): boolean {
  const normalized = title.trim().toLowerCase();
  const name = project.displayName.toLowerCase();
  if (project.windowTitle && project.windowTitle.toLowerCase() === normalized) {
    return true;
  }
  return (
    normalized === `${name} - cursor` ||
    normalized.startsWith(`${name} - cursor`) ||
    normalized.endsWith(`${name} - cursor`)
  );
}

export function mergeOpenWindowCapsules(
  projects: ProjectCapsule[],
  windowTitles: string[],
  now: number,
): ProjectCapsule[] {
  const merged = [...projects];

  for (const title of windowTitles) {
    const info = parseCursorWindowTitle(title);
    if (!info) {
      continue;
    }

    const existingIndex = merged.findIndex(
      (project) =>
        project.source === "cursor" && windowMatchesProject(info.title, project),
    );

    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        windowTitle: info.title,
        lastActivityAt: Math.max(existing.lastActivityAt, now),
      };
      continue;
    }

    merged.push(createCapsuleFromOpenWindow(info, now));
  }

  return merged.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function recomputeSummary(projects: ProjectCapsule[]): Record<TrafficLight, number> {
  const summary: Record<TrafficLight, number> = {
    green: 0,
    yellow: 0,
    red: 0,
    gray: 0,
  };
  for (const project of projects) {
    summary[project.status] += 1;
  }
  return summary;
}
