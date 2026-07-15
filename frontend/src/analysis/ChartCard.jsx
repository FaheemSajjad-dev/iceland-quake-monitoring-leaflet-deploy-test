import { useRef } from "react";
import { exportRowsCsv, saveChartPng, saveChartSvg } from "./analysisExport";

export default function ChartCard({
  id,
  title,
  description,
  rows,
  children,
  text,
  onResetZoom,
  exportContext,
}) {
  const ref = useRef(null);
  return (
    <article className="chart-card" ref={ref} aria-labelledby={`${id}-title`}>
      <div className="chart-card-header">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <div className="chart-actions">
          {onResetZoom && (
            <button type="button" onClick={onResetZoom}>
              {text.resetZoom}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              saveChartPng(ref.current, `${id}.png`, exportContext)
            }
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() =>
              saveChartSvg(ref.current, `${id}.svg`, exportContext)
            }
          >
            SVG
          </button>
          <button
            type="button"
            onClick={() => exportRowsCsv(rows, `${id}.csv`, exportContext)}
          >
            CSV
          </button>
        </div>
      </div>
      <div className="chart-content">{children}</div>
    </article>
  );
}
