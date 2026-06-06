import fs from "node:fs";
import path from "node:path";

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".claude",
  "projects",
);

export function getClaudeProjectsDir(): string {
  return CLAUDE_PROJECTS_DIR;
}

/** C--code-wlgd-member-vip -> wlgd-member-vip */
export function claudeProjectKeyToDisplayName(projectKey: string): string {
  const workspace = claudeProjectKeyToWorkspacePath(projectKey);
  if (workspace) {
    return path.basename(workspace);
  }
  if (projectKey.startsWith("C--code-")) {
    return projectKey.slice("C--code-".length);
  }
  return projectKey.replace(/^C--/, "");
}

/** C--code-wlgd-member-vip -> C:\code\wlgd-member-vip */
export function claudeProjectKeyToWorkspacePath(projectKey: string): string | null {
  const parts = projectKey.split("--");
  if (parts.length < 2) {
    return null;
  }
  const drive = parts[0];
  if (drive.length !== 1 || !/^[A-Za-z]$/.test(drive)) {
    return null;
  }
  return `${drive.toUpperCase()}:\\${parts.slice(1).join("\\")}`;
}

export function listClaudeProjectKeys(): string[] {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function makeClaudeCapsuleKey(projectKey: string): string {
  return `claude::${projectKey}`;
}

export function makeClaudeSessionCapsuleKey(sessionId: string): string {
  return `claude::session::${sessionId}`;
}

export function parseCapsuleKey(capsuleKey: string): {
  source: "cursor" | "claude-cli";
  projectKey: string;
  sessionId?: string;
} {
  if (capsuleKey.startsWith("claude::session::")) {
    return {
      source: "claude-cli",
      projectKey: capsuleKey,
      sessionId: capsuleKey.slice("claude::session::".length),
    };
  }
  if (capsuleKey.startsWith("claude::")) {
    return { source: "claude-cli", projectKey: capsuleKey.slice("claude::".length) };
  }
  if (capsuleKey.startsWith("cursor::")) {
    return { source: "cursor", projectKey: capsuleKey.slice("cursor::".length) };
  }
  return { source: "cursor", projectKey: capsuleKey };
}

export function makeCursorCapsuleKey(projectKey: string): string {
  return `cursor::${projectKey}`;
}
