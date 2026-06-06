export type TrafficLight = "green" | "yellow" | "red" | "gray";

export type SessionSource = "cursor" | "claude-cli";

export interface ClaudeRuntimeInfo {
  processes: Array<{ pid: number; sessionId: string | null }>;
}

export interface ToolInfo {
  name: string;
  target?: string;
}

export interface SessionPreview {
  lastUserMessage?: string;
  lastAgentMessage?: string;
  currentStep?: string;
  recentTools: ToolInfo[];
}

export interface AgentConversation {
  id: string;
  isSubagent: boolean;
  status: TrafficLight;
  taskStartedAt: number | null;
  lastActivityAt: number;
  preview: SessionPreview;
  transcriptPath: string;
}

export interface ProjectCapsule {
  projectKey: string;
  source: SessionSource;
  displayName: string;
  workspacePath: string | null;
  windowTitle: string | null;
  status: TrafficLight;
  taskStartedAt: number | null;
  lastActivityAt: number;
  conversations: AgentConversation[];
  resumeSessionId?: string;
  claudePid?: number;
  isLive?: boolean;
  customName?: string;
  defaultDisplayName?: string;
  activeTerminal?: {
    command?: string;
    cwd?: string;
    pid?: number;
    running: boolean;
  };
}

export interface SessionContentDetail {
  projectKey: string;
  displayName: string;
  source: SessionSource;
  transcriptPath?: string;
  messages: Array<{ role: string; text: string; time?: string }>;
}

export interface MonitorSnapshot {
  updatedAt: number;
  summary: Record<TrafficLight, number>;
  projects: ProjectCapsule[];
}

export interface AgentStatusAPI {
  getSnapshot: () => Promise<MonitorSnapshot>;
  focusProject: (projectKey: string) => Promise<{ ok: boolean; message: string }>;
  hideProject: (projectKey: string) => Promise<void>;
  renameSession: (projectKey: string, name: string) => Promise<void>;
  getSessionContent: (projectKey: string) => Promise<SessionContentDetail>;
  copyText: (text: string) => Promise<void>;
  openWorkspace: (workspacePath: string) => Promise<{ ok: boolean; message: string }>;
  quitApp: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  isWindowMaximized: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  getAlwaysOnTop: () => Promise<boolean>;
  setAlwaysOnTop: (pinned: boolean) => Promise<boolean>;
  refreshSnapshot: () => Promise<MonitorSnapshot>;
}

declare global {
  interface Window {
    agentStatus: AgentStatusAPI;
  }
}
