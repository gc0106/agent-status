interface WindowControlsProps {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowControls({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-btn"
        title="最小化"
        aria-label="最小化"
        onClick={onMinimize}
      >
        −
      </button>
      <button
        type="button"
        className="window-btn"
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
        onClick={onToggleMaximize}
      >
        {maximized ? "❐" : "□"}
      </button>
      <button
        type="button"
        className="window-btn window-btn-close"
        title="关闭到托盘"
        aria-label="关闭"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
