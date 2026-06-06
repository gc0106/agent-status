/// <reference types="vite/client" />

import type { AgentStatusAPI } from "@core/types";

declare global {
  interface Window {
    agentStatus: AgentStatusAPI;
  }
}

export {};
