import type { MonitorSnapshot } from "@core/types";
import { statusEmoji } from "../lib/status";

interface AttentionBannerProps {
  snapshot: MonitorSnapshot;
}

export function AttentionBanner({ snapshot }: AttentionBannerProps) {
  const blocked = snapshot.summary.yellow;
  const errors = snapshot.summary.red;
  const total = blocked + errors;

  if (total === 0) {
    return null;
  }

  const parts: string[] = [];
  if (blocked > 0) {
    parts.push(`${statusEmoji("yellow")} ${blocked} 个需处理`);
  }
  if (errors > 0) {
    parts.push(`${statusEmoji("red")} ${errors} 个异常`);
  }

  return (
    <div className="attention-banner" role="status">
      <strong>需要你关注：</strong>
      <span>{parts.join(" · ")}</span>
      <span className="attention-banner-hint">（已按 Herdr 优先级排在最前）</span>
    </div>
  );
}
