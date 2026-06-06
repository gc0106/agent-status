import fs from "node:fs";
import path from "node:path";

const CURSOR_PROJECTS_DIR = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".cursor",
  "projects",
);

export function getCursorProjectsDir(): string {
  return CURSOR_PROJECTS_DIR;
}

/** c-code-wlgd-member-vip -> wlgd-member-vip */
export function projectKeyToDisplayName(projectKey: string): string {
  if (projectKey.startsWith("c-code-")) {
    return projectKey.slice("c-code-".length);
  }
  if (projectKey.startsWith("c-")) {
    return projectKey.slice(2);
  }
  return projectKey;
}

/** Best-effort map from Cursor project key to workspace path on this machine. */
export function projectKeyToWorkspacePath(projectKey: string): string | null {
  if (!projectKey.startsWith("c-code-")) {
    return null;
  }
  const suffix = projectKey.slice("c-code-".length);
  if (!suffix) {
    return null;
  }
  return path.join("C:", "code", ...suffix.split("-"));
}

export function listProjectKeys(): string[] {
  if (!fs.existsSync(CURSOR_PROJECTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(CURSOR_PROJECTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."));
}

export function readFileTail(filePath: string, maxBytes = 96_000): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function getLatestMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

export function safeReadDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
