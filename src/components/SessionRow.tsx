import { memo, useMemo } from "react";
import type { ProjectCapsule } from "@core/types";
import { formatElapsed } from "@core/format";
import { statusEmoji, statusLabel } from "../lib/status";

interface SessionRowProps {
  project: ProjectCapsule;
  now: number;
  onView: () => void;
  onOpen: () => void;
  onHide: () => void;
  onRename?: () => void;
}

export const SessionRow = memo(function SessionRow({ project, now, onView, onOpen, onHide, onRename }: SessionRowProps) {
  const conversation = project.conversations[0];
  const subtitle = useMemo(() => {
    if (project.activeTerminal?.running && project.activeTerminal.command) {
      return project.activeTerminal.command;
    }
    if (conversation?.preview.currentStep) {
      return conversation.preview.currentStep;
    }
    if (conversation?.preview.lastAgentMessage) {
      return conversation.preview.lastAgentMessage;
    }
    if (conversation?.preview.lastUserMessage) {
      return conversation.preview.lastUserMessage;
    }
    return statusLabel(project.status);
  }, [conversation, project]);

  const openLabel =
    project.source === "claude-cli"
      ? project.isLive
        ? "打开"
        : "恢复"
      : project.isLive
        ? "打开"
        : project.status === "yellow" || project.status === "red"
          ? "处理"
          : "继续";

  if (!conversation) {
    return null;
  }

  return (
    <div className={`session-row status-${project.status}`}>
      <div className="session-row-main">
        <div className="session-row-title">
          <span className="session-light">{statusEmoji(project.status)}</span>
          <span className="session-name">{project.displayName}</span>
          {project.isLive && <span className="session-live">运行中</span>}
          <span className="session-time">{formatElapsed(project.taskStartedAt, now)}</span>
        </div>
        <div className="session-row-subtitle">
          {project.customName && project.defaultDisplayName ? (
            <span className="session-origin">{project.defaultDisplayName}</span>
          ) : null}
          {subtitle}
        </div>
      </div>

      <div className="session-row-actions">
        {project.source === "claude-cli" && onRename && (
          <button type="button" className="session-btn" onClick={onRename} title="自定义会话名称">
            命名
          </button>
        )}
        <button type="button" className="session-btn" onClick={onView} title="查看会话内容">
          查看
        </button>
        <button type="button" className="session-btn primary" onClick={onOpen} title={openLabel}>
          {openLabel}
        </button>
        <button type="button" className="session-btn danger" onClick={onHide} title="从列表隐藏">
          删除
        </button>
      </div>
    </div>
  );
});
