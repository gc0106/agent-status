import { useState } from "react";
import { SessionBoard } from "./components/SessionBoard";
import { useBridgeReady, useMonitorSnapshot, useNowTick } from "./hooks/useMonitorSnapshot";

export default function App() {
  const bridgeReady = useBridgeReady();
  const snapshot = useMonitorSnapshot(bridgeReady);
  const hasActive =
    snapshot.summary.green + snapshot.summary.yellow + snapshot.summary.red > 0;
  const now = useNowTick(bridgeReady, hasActive ? 1000 : 8000);
  const [refreshing, setRefreshing] = useState(false);

  if (!bridgeReady) {
    return (
      <div className="bar-root bar-error">
        <span>Agent Status 加载中…</span>
      </div>
    );
  }

  const focusProject = async (projectKey: string): Promise<void> => {
    await window.agentStatus.focusProject(projectKey);
  };

  const hideProject = async (projectKey: string): Promise<void> => {
    await window.agentStatus.hideProject(projectKey);
  };

  const renameSession = async (projectKey: string, name: string): Promise<void> => {
    await window.agentStatus.renameSession(projectKey, name);
  };

  const refreshSnapshot = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await window.agentStatus.refreshSnapshot();
    } finally {
      window.setTimeout(() => setRefreshing(false), 400);
    }
  };

  return (
    <SessionBoard
      snapshot={snapshot}
      now={now}
      onFocus={(projectKey) => void focusProject(projectKey)}
      onHide={(projectKey) => void hideProject(projectKey)}
      onRename={(projectKey, name) => void renameSession(projectKey, name)}
      onMinimize={() => void window.agentStatus.minimizeWindow()}
      onToggleMaximize={() => void window.agentStatus.toggleMaximizeWindow()}
      onCloseWindow={() => void window.agentStatus.closeWindow()}
      onRefresh={() => void refreshSnapshot()}
      refreshing={refreshing}
      windowReady={bridgeReady}
    />
  );
}
