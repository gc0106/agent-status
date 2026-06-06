import { useEffect, useState } from "react";
import type { ProjectCapsule } from "@core/types";

interface RenameSessionModalProps {
  project: ProjectCapsule;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function RenameSessionModal({ project, onClose, onSave }: RenameSessionModalProps) {
  const defaultName = project.defaultDisplayName ?? project.displayName;
  const [name, setName] = useState(project.customName ?? "");

  useEffect(() => {
    setName(project.customName ?? "");
  }, [project.customName, project.projectKey]);

  const handleSubmit = (): void => {
    onSave(name.trim());
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-card-sm" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <strong>命名 Claude 会话</strong>
            <span className="modal-subtitle">自定义名称，方便区分不同会话</span>
          </div>
          <button type="button" className="bar-icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <label className="rename-label" htmlFor="session-name-input">
            会话名称
          </label>
          <input
            id="session-name-input"
            className="rename-input"
            value={name}
            placeholder={defaultName}
            maxLength={64}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSubmit();
              }
              if (event.key === "Escape") {
                onClose();
              }
            }}
          />
          <div className="rename-hint">默认：{defaultName}</div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              onSave("");
              onClose();
            }}
          >
            恢复默认
          </button>
          <button type="button" className="primary" onClick={handleSubmit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
