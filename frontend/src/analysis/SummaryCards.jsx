const number = (value, digits = 1) =>
  value == null
    ? "—"
    : Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      });

export default function SummaryCards({ analysis, text }) {
  const percentage = (count) =>
    analysis.count
      ? `${number(count)} (${number((count / analysis.count) * 100)}%)`
      : "—";
  const cards = [
    [text.total, number(analysis.count, 0)],
    [
      text.strongest,
      analysis.strongest
        ? `M ${number(analysis.strongest.magnitude)} · ${analysis.strongest.date.toLocaleDateString()}`
        : "—",
    ],
    [text.averageMagnitude, number(analysis.averageMagnitude, 2)],
    [
      text.averageDepth,
      analysis.averageDepth == null
        ? "—"
        : `${number(analysis.averageDepth)} km`,
    ],
    [
      text.shallowest,
      analysis.shallowest ? `${number(analysis.shallowest.depth)} km` : "—",
    ],
    [
      text.deepest,
      analysis.deepest ? `${number(analysis.deepest.depth)} km` : "—",
    ],
    [text.matched, percentage(analysis.matched)],
    [text.mpgvOnly, percentage(analysis.mpgvOnly)],
  ];
  return (
    <section className="summary-grid" aria-label={text.summary}>
      {cards.map(([label, value]) => (
        <article className="summary-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}
