import { useEffect, useState } from "react";

export function useWindowMaximized(ready: boolean): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!ready) {
      return;
    }

    void window.agentStatus.isWindowMaximized().then(setMaximized);

    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ maximized: boolean }>).detail;
      setMaximized(detail.maximized);
    };

    window.addEventListener("agent-status:maximized", handler);
    return () => window.removeEventListener("agent-status:maximized", handler);
  }, [ready]);

  return maximized;
}
