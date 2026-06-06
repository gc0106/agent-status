import { useMemo, useState } from "react";
import type { MonitorSnapshot, ProjectCapsule } from "@core/types";
import { useAlwaysOnTop } from "../hooks/useAlwaysOnTop";
import { useWindowMaximized } from "../hooks/useWindowControls";
import { sortByStatusPriority, statusEmoji } from "../lib/status";
import { APP_VERSION } from "../version";
import { AttentionBanner } from "./AttentionBanner";
import { RenameSessionModal } from "./RenameSessionModal";
import { SessionDetailModal } from "./SessionDetailModal";
import { SessionRow } from "./SessionRow";
import { StatusLegend } from "./StatusLegend";
import { WindowControls } from "./WindowControls";

interface SessionBoardProps {
  snapshot: MonitorSnapshot;
  now: number;
  onFocus: (projectKey: string) => void;
  onHide: (projectKey: string) => void;
  onRename: (projectKey: string, name: string) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onCloseWindow: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  windowReady?: boolean;
}

interface SessionColumnProps {
  title: string;
  emptyText: string;
  projects: ProjectCapsule[];
  now: number;
  onView: (project: ProjectCapsule) => void;
  onFocus: (projectKey: string) => void;
  onHide: (projectKey: string) => void;
  onRename?: (project: ProjectCapsule) => void;
}

function SessionColumn({
  title,
  emptyText,
  projects,
  now,
  onView,
  onFocus,
  onHide,
  onRename,
}: SessionColumnProps) {
  return (
    <section className="session-column">
      <header className="session-column-header">
        <span>{title}</span>
        <span className="session-column-count">{projects.length}</span>
      </header>
      <div className="session-column-list">
        {projects.length === 0 ? (
          <div className="session-empty">{emptyText}</div>
        ) : (
          projects.map((project) => (
            <SessionRow
              key={project.projectKey}
              project={project}
              now={now}
              onView={() => onView(project)}
              onOpen={() => onFocus(project.projectKey)}
              onHide={() => onHide(project.projectKey)}
              onRename={onRename ? () => onRename(project) : undefined}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function SessionBoard({
  snapshot,
  now,
  onFocus,
  onHide,
  onRename,
  onMinimize,
  onToggleMaximize,
  onCloseWindow,
  onRefresh,
  refreshing,
  windowReady = true,
}: SessionBoardProps) {
  const { summary, projects } = snapshot;
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [detailProject, setDetailProject] = useState<ProjectCapsule | null>(null);
  const [renameProject, setRenameProject] = useState<ProjectCapsule | null>(null);
  const maximized = useWindowMaximized(windowReady);
  const [alwaysOnTop, setAlwaysOnTop] = useAlwaysOnTop(windowReady);

  const claudeProjects = useMemo(
    () => sortByStatusPriority(projects.filter((project) => project.source === "claude-cli")),
    [projects],
  );
  const cursorProjects = useMemo(
    () => sortByStatusPriority(projects.filter((project) => project.source === "cursor")),
    [projects],
  );

  const handleRefresh = (): void => {
    setRefreshSpin(true);
    onRefresh();
    window.setTimeout(() => setRefreshSpin(false), 600);
  };

  return (
    <div className="bar-root">
      <div className="bar-titlebar">
        <div
          className="bar-drag-handle bar-drag"
          title="按住拖动；双击最大化/还原"
          onDoubleClick={() => onToggleMaximize()}
        >
          <span className="bar-drag-grip">⠿⠿⠿</span>
          <span className="bar-drag-label">Agent Status v{APP_VERSION}</span>
        </div>
        <button
          type="button"
          className={`pin-btn ${alwaysOnTop ? "pin-btn-active" : ""}`}
          title={alwaysOnTop ? "点击取消置顶" : "点击后将窗口固定在最前"}
          aria-pressed={alwaysOnTop}
          onClick={() => setAlwaysOnTop(!alwaysOnTop)}
        >
          {alwaysOnTop ? "已置顶" : "置顶"}
        </button>
        <WindowControls
          maximized={maximized}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          onClose={onCloseWindow}
        />
      </div>

      <div className="bar-toolbar">
        <div className="bar-summary">
          <span title="需处理 (Herdr blocked)">{statusEmoji("yellow")} {summary.yellow}</span>
          <span title="异常">{statusEmoji("red")} {summary.red}</span>
          <span title="运行中 (Herdr working)">{statusEmoji("green")} {summary.green}</span>
          <span title="空闲 (Herdr idle)">{statusEmoji("gray")} {summary.gray}</span>
          <span className="bar-count">{projects.length} 项</span>
        </div>

        <div className="bar-actions">
          <span className="bar-brand">Agent Status</span>
          <button
            type="button"
            className={`bar-icon-btn ${refreshSpin || refreshing ? "spinning" : ""}`}
            title="刷新会话列表"
            aria-label="刷新"
            onClick={handleRefresh}
          >
            ↻
          </button>
        </div>
      </div>

      <AttentionBanner snapshot={snapshot} />
      <StatusLegend />

      <div className="session-board">
        <SessionColumn
          title="Claude Code"
          emptyText="暂无 Claude 会话"
          projects={claudeProjects}
          now={now}
          onView={setDetailProject}
          onFocus={onFocus}
          onHide={onHide}
          onRename={setRenameProject}
        />
        <SessionColumn
          title="Cursor"
          emptyText="暂无 Cursor 会话"
          projects={cursorProjects}
          now={now}
          onView={setDetailProject}
          onFocus={onFocus}
          onHide={onHide}
        />
      </div>

      {renameProject && (
        <RenameSessionModal
          project={renameProject}
          onClose={() => setRenameProject(null)}
          onSave={(name) => onRename(renameProject.projectKey, name)}
        />
      )}

      {detailProject && (
        <SessionDetailModal
          project={detailProject}
          onClose={() => setDetailProject(null)}
          onOpen={() => {
            onFocus(detailProject.projectKey);
            setDetailProject(null);
          }}
        />
      )}
    </div>
  );
}
