import { contextBridge, ipcRenderer } from "electron";
import type { AgentStatusAPI } from "../packages/core/types";

const api: AgentStatusAPI = {
  getSnapshot: () => ipcRenderer.invoke("snapshot:get"),
  focusProject: (projectKey) => ipcRenderer.invoke("project:focus", projectKey),
  hideProject: (projectKey) => ipcRenderer.invoke("project:hide", projectKey),
  renameSession: (projectKey, name) => ipcRenderer.invoke("session:rename", projectKey, name),
  getSessionContent: (projectKey) => ipcRenderer.invoke("session:content", projectKey),
  copyText: (text) => ipcRenderer.invoke("clipboard:copy", text),
  openWorkspace: (workspacePath) => ipcRenderer.invoke("workspace:open", workspacePath),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:get-always-on-top"),
  setAlwaysOnTop: (pinned) => ipcRenderer.invoke("window:set-always-on-top", pinned),
  refreshSnapshot: () => ipcRenderer.invoke("snapshot:refresh"),
};

contextBridge.exposeInMainWorld("agentStatus", api);

ipcRenderer.on("window:always-on-top-changed", (_event, pinned: boolean) => {
  window.dispatchEvent(new CustomEvent("agent-status:always-on-top", { detail: { pinned } }));
});

ipcRenderer.on("window:maximized-changed", (_event, maximized: boolean) => {
  window.dispatchEvent(new CustomEvent("agent-status:maximized", { detail: { maximized } }));
});

ipcRenderer.on("snapshot:update", (_event, snapshot) => {
  window.dispatchEvent(new CustomEvent("agent-status:snapshot", { detail: snapshot }));
});
