export default function ChartCard({ id, title, description, children, text, onResetZoom }) {
  return (
    <article className="chart-card" aria-labelledby={`${id}-title`}>
      <div className="chart-card-header">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {onResetZoom && (
          <div className="chart-actions">
            <button type="button" onClick={onResetZoom}>{text.resetZoom}</button>
          </div>
        )}
      </div>
      <div className="chart-content">{children}</div>
    </article>
  );
}
