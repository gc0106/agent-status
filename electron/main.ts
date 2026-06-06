import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import { buildMonitorSnapshot } from "../packages/core/monitor";
import { getCursorProjectsDir } from "../packages/core/paths";
import { getClaudeProjectsDir } from "../packages/core/claudePaths";
import { windowMatchesProject } from "../packages/core/openWindows";
import { readSessionContent } from "../packages/core/sessionContent";
import type { MonitorSnapshot } from "../packages/core/types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let watcher: FSWatcher | null = null;
let windowPollTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let refreshInFlight = false;
let pendingLightRefresh = false;
let hiddenSessionKeys = new Set<string>();
let sessionAliases: Record<string, string> = {};
let lastSnapshotSignature = "";
let cachedRuntime: {
  windowTitles: string[];
  processes: Array<{ pid: number; sessionId: string | null }>;
} = { windowTitles: [], processes: [] };
let latestSnapshot: MonitorSnapshot = buildMonitorSnapshot([], { processes: [] });
let isQuitting = false;
let appPreferences: AppPreferences = { alwaysOnTop: false };

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const WATCHER_DEBOUNCE_MS = 5000;
const WATCHER_DEBOUNCE_IDLE_MS = 10000;
const HEAVY_POLL_ACTIVE_MS = 25000;
const HEAVY_POLL_IDLE_MS = 60000;

const WINDOW_STATE_FILE = "window-state.json";
const HIDDEN_SESSIONS_FILE = "hidden-sessions.json";
const SESSION_NAMES_FILE = "session-names.json";
const PREFERENCES_FILE = "preferences.json";
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 120;
const DEFAULT_WINDOW_HEIGHT = 220;

interface WindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface AppPreferences {
  alwaysOnTop?: boolean;
}

function getWindowStatePath(): string {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function loadWindowState(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(getWindowStatePath(), "utf8")) as WindowState;
  } catch {
    return {};
  }
}

function saveWindowState(partial: WindowState): void {
  const current = loadWindowState();
  fs.writeFileSync(getWindowStatePath(), JSON.stringify({ ...current, ...partial }), "utf8");
}

function getHiddenSessionsPath(): string {
  return path.join(app.getPath("userData"), HIDDEN_SESSIONS_FILE);
}

function loadHiddenSessions(): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(getHiddenSessionsPath(), "utf8")) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function saveHiddenSessions(): void {
  fs.writeFileSync(getHiddenSessionsPath(), JSON.stringify([...hiddenSessionKeys]), "utf8");
}

function getSessionNamesPath(): string {
  return path.join(app.getPath("userData"), SESSION_NAMES_FILE);
}

function loadSessionAliases(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSessionNamesPath(), "utf8")) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionAliases(): void {
  fs.writeFileSync(getSessionNamesPath(), JSON.stringify(sessionAliases), "utf8");
}

function getPreferencesPath(): string {
  return path.join(app.getPath("userData"), PREFERENCES_FILE);
}

function loadPreferences(): AppPreferences {
  try {
    return JSON.parse(fs.readFileSync(getPreferencesPath(), "utf8")) as AppPreferences;
  } catch {
    return { alwaysOnTop: false };
  }
}

function savePreferences(): void {
  fs.writeFileSync(getPreferencesPath(), JSON.stringify(appPreferences), "utf8");
}

function applyAlwaysOnTop(pinned: boolean): void {
  appPreferences.alwaysOnTop = pinned;
  savePreferences();
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(pinned, pinned ? "screen-saver" : "normal");
  }
  mainWindow?.webContents.send("window:always-on-top-changed", pinned);
}

function hasActiveSessions(snapshot: MonitorSnapshot): boolean {
  return snapshot.summary.green + snapshot.summary.yellow + snapshot.summary.red > 0;
}

function getHeavyPollIntervalMs(): number {
  return hasActiveSessions(latestSnapshot) ? HEAVY_POLL_ACTIVE_MS : HEAVY_POLL_IDLE_MS;
}

function restartHeavyPollTimer(): void {
  if (windowPollTimer) {
    clearInterval(windowPollTimer);
  }
  windowPollTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      return;
    }
    void runRefresh(true);
  }, getHeavyPollIntervalMs());
}

function applyClaudeLabels(project: MonitorSnapshot["projects"][number]): MonitorSnapshot["projects"][number] {
  if (project.source !== "claude-cli") {
    return project;
  }

  const defaultDisplayName = project.displayName;
  const customName = sessionAliases[project.projectKey]?.trim();
  if (!customName) {
    return { ...project, defaultDisplayName };
  }

  return {
    ...project,
    defaultDisplayName,
    customName,
    displayName: customName,
  };
}

function enrichSnapshot(snapshot: MonitorSnapshot): MonitorSnapshot {
  const projects = snapshot.projects
    .filter((project) => !hiddenSessionKeys.has(project.projectKey))
    .map((project) => applyClaudeLabels({
      ...project,
      isLive:
        project.source === "claude-cli"
          ? Boolean(project.claudePid)
          : cachedRuntime.windowTitles.some((title) => windowMatchesProject(title, project)),
    }));

  return {
    ...snapshot,
    projects,
    summary: {
      green: projects.filter((p) => p.status === "green").length,
      yellow: projects.filter((p) => p.status === "yellow").length,
      red: projects.filter((p) => p.status === "red").length,
      gray: projects.filter((p) => p.status === "gray").length,
    },
  };
}

function createWindow(): void {
  const primary = screen.getPrimaryDisplay();
  const { width: workWidth } = primary.workAreaSize;
  const saved = loadWindowState();

  mainWindow = new BrowserWindow({
    width: saved.width ?? workWidth,
    height: saved.height ?? DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    x: saved.x ?? primary.workArea.x,
    y: saved.y ?? primary.workArea.y,
    frame: false,
    resizable: true,
    thickFrame: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    transparent: false,
    backgroundColor: "#111827",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", false);
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error("Renderer failed to load:", code, description);
  });

  mainWindow.on("moved", () => {
    if (!mainWindow || mainWindow.isMaximized()) {
      return;
    }
    const [x, y] = mainWindow.getPosition();
    saveWindowState({ x, y });
  });

  mainWindow.on("resized", () => {
    if (!mainWindow || mainWindow.isMaximized()) {
      return;
    }
    const [width, height] = mainWindow.getSize();
    saveWindowState({ width, height });
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(process.execPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Agent Status");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示窗口",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

async function pollRuntimeState(): Promise<{
  windowTitles: string[];
  processes: Array<{ pid: number; sessionId: string | null }>;
}> {
  const script = `
    $titles = @(Get-Process -Name Cursor -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowTitle -ne '' } |
      Select-Object -ExpandProperty MainWindowTitle)
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      $sessionId = $null
      if ($_.CommandLine -match '(?:-r|--resume)\\s+([0-9a-f-]{36})') {
        $sessionId = $matches[1]
      }
      [PSCustomObject]@{
        pid = [int]$_.ProcessId
        sessionId = $sessionId
      }
    })
    @{
      windowTitles = $titles
      processes = $procs
    } | ConvertTo-Json -Compress -Depth 4
  `;

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim() || "{}") as {
          windowTitles?: string[] | string;
          processes?:
            | Array<{ pid: number; sessionId: string | null }>
            | { pid: number; sessionId: string | null };
        };
        const titles = Array.isArray(parsed.windowTitles)
          ? parsed.windowTitles
          : parsed.windowTitles
            ? [parsed.windowTitles]
            : [];
        const processes = Array.isArray(parsed.processes)
          ? parsed.processes
          : parsed.processes
            ? [parsed.processes]
            : [];
        resolve({ windowTitles: titles.filter(Boolean), processes });
      } catch {
        resolve({ windowTitles: [], processes: [] });
      }
    });
    child.on("error", () => resolve({ windowTitles: [], processes: [] }));
  });
}

function snapshotSignature(snapshot: MonitorSnapshot): string {
  return snapshot.projects
    .map((project) => `${project.projectKey}:${project.status}:${project.lastActivityAt}`)
    .join("|");
}

function buildLightSnapshot(): MonitorSnapshot {
  return enrichSnapshot(buildMonitorSnapshot(cachedRuntime.windowTitles, { processes: cachedRuntime.processes }));
}

async function refreshHeavySnapshot(): Promise<MonitorSnapshot> {
  const runtime = await pollRuntimeState();
  cachedRuntime = runtime;
  return enrichSnapshot(buildMonitorSnapshot(runtime.windowTitles, { processes: runtime.processes }));
}

function broadcastSnapshot(snapshot: MonitorSnapshot): void {
  const signature = snapshotSignature(snapshot);
  const wasActive = hasActiveSessions(latestSnapshot);
  const isActive = hasActiveSessions(snapshot);
  if (signature === lastSnapshotSignature) {
    return;
  }
  lastSnapshotSignature = signature;
  latestSnapshot = snapshot;
  if (wasActive !== isActive) {
    restartHeavyPollTimer();
  }
  mainWindow?.webContents.send("snapshot:update", snapshot);
}

async function runRefresh(heavy: boolean): Promise<MonitorSnapshot> {
  if (refreshInFlight) {
    if (!heavy) {
      pendingLightRefresh = true;
    }
    return latestSnapshot;
  }

  refreshInFlight = true;
  try {
    const snapshot = heavy ? await refreshHeavySnapshot() : buildLightSnapshot();
    broadcastSnapshot(snapshot);
    return snapshot;
  } finally {
    refreshInFlight = false;
    if (pendingLightRefresh) {
      pendingLightRefresh = false;
      void runRefresh(false);
    }
  }
}

function scheduleLightRefresh(): void {
  if (mainWindow && !mainWindow.isVisible() && !hasActiveSessions(latestSnapshot)) {
    return;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  const delay = hasActiveSessions(latestSnapshot) ? WATCHER_DEBOUNCE_MS : WATCHER_DEBOUNCE_IDLE_MS;
  debounceTimer = setTimeout(() => {
    void runRefresh(false);
  }, delay);
}

function startWatcher(): void {
  const claudeHistory = path.join(process.env.USERPROFILE ?? "", ".claude", "history.jsonl");
  const watchTargets = [
    path.join(getCursorProjectsDir(), "**/agent-transcripts/**/*.jsonl"),
    path.join(getCursorProjectsDir(), "**/terminals/*.txt"),
    path.join(getClaudeProjectsDir(), "**/*.jsonl"),
    claudeHistory,
  ];

  watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 400,
    },
    ignorePermissionErrors: true,
  });

  watcher.on("all", scheduleLightRefresh);
  restartHeavyPollTimer();
  void runRefresh(true);
}

async function forceRefresh(): Promise<MonitorSnapshot> {
  return runRefresh(true);
}

async function focusCursorWindow(titleHint: string, workspacePath: string | null): Promise<{ ok: boolean; message: string }> {
  const escapedHint = titleHint.replace(/'/g, "''");
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class WinFocus {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
      }
"@
    $hint = '${escapedHint}'
    $proc = Get-Process | Where-Object {
      $_.ProcessName -eq 'Cursor' -and $_.MainWindowTitle -ne '' -and (
        $_.MainWindowTitle -eq $hint -or
        $_.MainWindowTitle -like "*$hint*" -or
        $_.MainWindowTitle -like "*$hint - Cursor*"
      )
    } | Select-Object -First 1
    if ($null -eq $proc) {
      Write-Output 'NOT_FOUND'
      exit 1
    }
    $handle = $proc.MainWindowHandle
    if ([WinFocus]::IsIconic($handle)) { [WinFocus]::ShowWindow($handle, 9) | Out-Null }
    [WinFocus]::SetForegroundWindow($handle) | Out-Null
    Write-Output $proc.MainWindowTitle
  `;

  const focused = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: stdout.trim() || "Focused Cursor window" });
      } else {
        resolve({ ok: false, message: "Cursor window not found" });
      }
    });
    child.on("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
  });

  if (focused.ok || !workspacePath) {
    return focused;
  }

  return openWorkspace(workspacePath);
}

async function focusClaudeWindow(pid: number): Promise<{ ok: boolean; message: string }> {
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class WinFocus {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
      }
"@
    $startPid = ${pid}
    $visited = New-Object 'System.Collections.Generic.HashSet[int]'
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($startPid)
    while ($queue.Count -gt 0) {
      $currentPid = $queue.Dequeue()
      if (-not $visited.Add($currentPid)) { continue }
      try {
        $proc = Get-Process -Id $currentPid -ErrorAction Stop
        $handle = $proc.MainWindowHandle
        if ($handle -ne [IntPtr]::Zero) {
          if ([WinFocus]::IsIconic($handle)) { [WinFocus]::ShowWindow($handle, 9) | Out-Null }
          [WinFocus]::SetForegroundWindow($handle) | Out-Null
          Write-Output $proc.ProcessName
          exit 0
        }
      } catch {}
      try {
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$currentPid" -ErrorAction SilentlyContinue |
          ForEach-Object { $queue.Enqueue([int]$_.ProcessId) }
      } catch {}
    }
    Write-Output 'NOT_FOUND'
    exit 1
  `;

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: stdout.trim() || "Focused Claude window" });
      } else {
        resolve({ ok: false, message: "Claude window not found" });
      }
    });
    child.on("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
  });
}

function openWorkspace(workspacePath: string): Promise<{ ok: boolean; message: string }> {
  const cursorCmd = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "cursor",
    "resources",
    "app",
    "bin",
    "cursor.cmd",
  );

  return launchInShell(workspacePath, cursorCmd, "-r", workspacePath);
}

function resumeClaudeSession(
  workspacePath: string,
  sessionId: string,
): Promise<{ ok: boolean; message: string }> {
  const claudeCmd = path.join(process.env.APPDATA ?? "", "npm", "claude.cmd");
  return launchInShell(workspacePath, claudeCmd, "-r", sessionId);
}

function launchInShell(
  cwd: string,
  command: string,
  ...args: string[]
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const wtPath = path.join(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft",
      "WindowsApps",
      "wt.exe",
    );

    const useWindowsTerminal = fs.existsSync(wtPath);
    const child = useWindowsTerminal
      ? spawn("cmd.exe", ["/c", "start", "", wtPath, "-d", cwd, command, ...args], {
          windowsHide: true,
          detached: true,
        })
      : spawn("cmd.exe", ["/c", "start", "", "/D", cwd, command, ...args], {
          windowsHide: true,
          detached: true,
        });

    child.on("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        message: code === 0 ? `Launched in ${cwd}` : `Launch exited with code ${code}`,
      });
    });
  });
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.agentstatus.app");
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  createWindow();
  createTray();
  hiddenSessionKeys = loadHiddenSessions();
  sessionAliases = loadSessionAliases();
  appPreferences = loadPreferences();
  applyAlwaysOnTop(Boolean(appPreferences.alwaysOnTop));
  startWatcher();

  ipcMain.handle("snapshot:get", async () => latestSnapshot);
  ipcMain.handle("snapshot:refresh", async () => forceRefresh());
  ipcMain.handle("app:quit", async () => {
    isQuitting = true;
    app.quit();
  });
  ipcMain.handle("window:minimize", async () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", async () => {
    if (!mainWindow) {
      return false;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });
  ipcMain.handle("window:is-maximized", async () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle("window:close", async () => {
    mainWindow?.hide();
  });
  ipcMain.handle("window:get-always-on-top", async () => Boolean(appPreferences.alwaysOnTop));
  ipcMain.handle("window:set-always-on-top", async (_event, pinned: boolean) => {
    applyAlwaysOnTop(pinned);
    return pinned;
  });
  ipcMain.handle("project:hide", async (_event, projectKey: string) => {
    hiddenSessionKeys.add(projectKey);
    saveHiddenSessions();
    const snapshot = buildLightSnapshot();
    broadcastSnapshot(snapshot);
  });
  ipcMain.handle("session:rename", async (_event, projectKey: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      sessionAliases[projectKey] = trimmed;
    } else {
      delete sessionAliases[projectKey];
    }
    saveSessionAliases();
    const snapshot = buildLightSnapshot();
    broadcastSnapshot(snapshot);
  });
  ipcMain.handle("session:content", async (_event, projectKey: string) => {
    const project = latestSnapshot.projects.find((item) => item.projectKey === projectKey);
    if (!project) {
      return {
        projectKey,
        displayName: "未知会话",
        source: "cursor" as const,
        messages: [{ role: "system", text: "会话不存在或已被隐藏" }],
      };
    }
    const conversation = project.conversations[0];
    return readSessionContent(
      conversation?.transcriptPath ?? "",
      project.source,
      project.displayName,
      project.projectKey,
    );
  });
  ipcMain.handle("project:focus", async (_event, projectKey: string) => {
    const project = latestSnapshot.projects.find((item) => item.projectKey === projectKey);
    if (!project) {
      return { ok: false, message: "Project not found" };
    }

    if (project.source === "claude-cli") {
      if (project.claudePid) {
        const focused = await focusClaudeWindow(project.claudePid);
        if (focused.ok) {
          return focused;
        }
      }

      if (project.workspacePath && project.resumeSessionId) {
        return resumeClaudeSession(project.workspacePath, project.resumeSessionId);
      }
      if (project.workspacePath) {
        return launchInShell(
          project.workspacePath,
          path.join(process.env.APPDATA ?? "", "npm", "claude.cmd"),
        );
      }
      if (project.resumeSessionId) {
        return launchInShell(
          process.env.USERPROFILE ?? "C:\\",
          path.join(process.env.APPDATA ?? "", "npm", "claude.cmd"),
          "-r",
          project.resumeSessionId,
        );
      }
      return { ok: false, message: "Claude CLI 会话信息不足，请在 cmd 中手动切换" };
    }

    const hint = project.windowTitle ?? project.displayName;
    const result = await focusCursorWindow(hint, project.workspacePath);
    if (!result.ok && project.workspacePath) {
      return openWorkspace(project.workspacePath);
    }
    return result;
  });
  ipcMain.handle("workspace:open", async (_event, workspacePath: string) => openWorkspace(workspacePath));
  ipcMain.handle("clipboard:copy", async (_event, text: string) => {
    clipboard.writeText(text);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  watcher?.close();
  if (windowPollTimer) {
    clearInterval(windowPollTimer);
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  tray?.destroy();
});
