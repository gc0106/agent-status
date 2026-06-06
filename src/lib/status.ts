import type { TrafficLight } from "@core/types";

/** 内部状态 → Herdr 术语对照（https://herdr.dev/docs/agents/） */
export type HerdrState = "working" | "blocked" | "error" | "idle";

export interface StatusLegendItem {
  status: TrafficLight;
  emoji: string;
  label: string;
  herdrTerm: HerdrState;
  herdrLabel: string;
  meaning: string;
  action: string;
}

/**
 * 展示顺序与 Herdr 一致：先看你该处理的，再看在跑的，最后才是空闲。
 * Herdr 用 🔴 blocked / 🟡 working / 🟢 idle，我们保留「异常」作为第 4 档。
 */
export const STATUS_LEGEND: StatusLegendItem[] = [
  {
    status: "yellow",
    emoji: "🔴",
    label: "需处理",
    herdrTerm: "blocked",
    herdrLabel: "blocked",
    meaning: "Agent 在等你回复、确认或授权（Herdr: blocked）",
    action: "👉 优先处理",
  },
  {
    status: "red",
    emoji: "⛔",
    label: "异常",
    herdrTerm: "error",
    herdrLabel: "error",
    meaning: "终端报错、命令失败或任务中断",
    action: "👉 立刻排查",
  },
  {
    status: "green",
    emoji: "🟡",
    label: "运行中",
    herdrTerm: "working",
    herdrLabel: "working",
    meaning: "Agent 正在写代码、跑工具（Herdr: working）",
    action: "一般不用管",
  },
  {
    status: "gray",
    emoji: "🟢",
    label: "空闲",
    herdrTerm: "idle",
    herdrLabel: "idle",
    meaning: "暂无近期活动，窗口可能还开着（Herdr: idle）",
    action: "不用急",
  },
];

export const STATUS_PRIORITY: Record<TrafficLight, number> = {
  yellow: 0,
  red: 1,
  green: 2,
  gray: 3,
};

export function statusLabel(status: TrafficLight): string {
  return STATUS_LEGEND.find((item) => item.status === status)?.label ?? "未知";
}

export function statusEmoji(status: TrafficLight): string {
  return STATUS_LEGEND.find((item) => item.status === status)?.emoji ?? "🟢";
}

export function statusAction(status: TrafficLight): string {
  return STATUS_LEGEND.find((item) => item.status === status)?.action ?? "";
}

export function herdrState(status: TrafficLight): HerdrState {
  return STATUS_LEGEND.find((item) => item.status === status)?.herdrTerm ?? "idle";
}

export function needsAttention(status: TrafficLight): boolean {
  return status === "yellow" || status === "red";
}

export function sortByStatusPriority<T extends { status: TrafficLight; lastActivityAt: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return b.lastActivityAt - a.lastActivityAt;
  });
}

export { formatElapsed } from "@core/format";
