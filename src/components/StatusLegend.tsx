import { STATUS_LEGEND } from "../lib/status";

export function StatusLegend() {
  return (
    <div className="status-legend-wrap">
      <div className="status-legend-headline">
        <span>状态图例</span>
        <a
          className="status-legend-link"
          href="https://herdr.dev/docs/agents/"
          target="_blank"
          rel="noreferrer"
        >
          参考 Herdr
        </a>
      </div>
      <div className="status-legend">
        {STATUS_LEGEND.map((item) => (
          <div key={item.status} className={`status-legend-item status-legend-${item.status}`}>
            <div className="status-legend-item-head">
              <span>{item.emoji}</span>
              <strong>{item.label}</strong>
              <span className="status-legend-herdr">{item.herdrLabel}</span>
            </div>
            <div className="status-legend-body">{item.meaning}</div>
            <div className="status-legend-foot">{item.action}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
