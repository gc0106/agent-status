import { useEffect, useState } from "react";

export function useAlwaysOnTop(ready: boolean): [boolean, (next: boolean) => void] {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!ready) {
      return;
    }

    void window.agentStatus.getAlwaysOnTop().then(setPinned);

    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ pinned: boolean }>).detail;
      setPinned(detail.pinned);
    };

    window.addEventListener("agent-status:always-on-top", handler);
    return () => window.removeEventListener("agent-status:always-on-top", handler);
  }, [ready]);

  const setAlwaysOnTop = (next: boolean): void => {
    setPinned(next);
    void window.agentStatus.setAlwaysOnTop(next);
  };

  return [pinned, setAlwaysOnTop];
}
