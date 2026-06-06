import { useEffect, useState } from "react";
import type { MonitorSnapshot } from "@core/types";

const emptySnapshot: MonitorSnapshot = {
  updatedAt: Date.now(),
  summary: { green: 0, yellow: 0, red: 0, gray: 0 },
  projects: [],
};

export function useBridgeReady(): boolean {
  const [ready, setReady] = useState(Boolean(window.agentStatus));

  useEffect(() => {
    if (window.agentStatus) {
      setReady(true);
      return;
    }
    const timer = setInterval(() => {
      if (window.agentStatus) {
        setReady(true);
        clearInterval(timer);
      }
    }, 50);
    return () => clearInterval(timer);
  }, []);

  return ready;
}

export function useMonitorSnapshot(enabled = true): MonitorSnapshot {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(emptySnapshot);

  useEffect(() => {
    if (!enabled || !window.agentStatus) {
      return;
    }

    void window.agentStatus.getSnapshot().then(setSnapshot);

    const handler = (event: Event) => {
      const custom = event as CustomEvent<MonitorSnapshot>;
      setSnapshot(custom.detail);
    };

    window.addEventListener("agent-status:snapshot", handler);
    return () => window.removeEventListener("agent-status:snapshot", handler);
  }, [enabled]);

  return snapshot;
}

export function useNowTick(enabled = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);

  return now;
}
