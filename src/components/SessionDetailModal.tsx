import { useEffect, useState } from "react";
import type { ProjectCapsule, SessionContentDetail } from "@core/types";

interface SessionDetailModalProps {
  project: ProjectCapsule;
  onClose: () => void;
  onOpen: () => void;
}

export function SessionDetailModal({ project, onClose, onOpen }: SessionDetailModalProps) {
  const [content, setContent] = useState<SessionContentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void window.agentStatus.getSessionContent(project.projectKey).then((detail) => {
      if (active) {
        setContent(detail);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [project.projectKey]);

  const openLabel =
    project.source === "claude-cli"
      ? project.isLive
        ? "打开窗口"
        : "恢复会话"
      : project.isLive
        ? "打开 Cursor"
        : "打开项目";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <strong>{project.displayName}</strong>
            <span className="modal-subtitle">
              {project.source === "claude-cli" ? "Claude Code" : "Cursor"}
              {project.isLive ? " · 运行中" : ""}
            </span>
          </div>
          <button type="button" className="bar-icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="modal-loading">加载会话内容…</div>
          ) : (
            content?.messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className="modal-message">
                <div className="modal-message-role">
                  {message.role}
                  {message.time ? ` · ${message.time}` : ""}
                </div>
                <div className="modal-message-text">{message.text}</div>
              </div>
            ))
          )}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              const lastUser = [...(content?.messages ?? [])].reverse().find((m) => m.role === "你");
              if (lastUser) {
                void window.agentStatus.copyText(lastUser.text);
              }
            }}
          >
            复制最后问题
          </button>
          <button type="button" className="primary" onClick={onOpen}>
            {openLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
