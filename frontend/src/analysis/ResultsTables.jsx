import { useMemo, useState } from "react";
import { depthLabel } from "./analysisData";

const PAGE_SIZE = 10;
const format = (value, digits = 1) => Number(value).toFixed(digits);

function ResultsTable({ title, rows, text, onViewMap, recent }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(recent ? "date" : "magnitude");
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        sort === "date" ? b.date - a.date : b.magnitude - a.magnitude,
      ),
    [rows, sort],
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <article className="results-card">
      <div className="results-heading">
        <h3>{title}</h3>
        <label>
          {text.sort}
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            <option value="date">{text.date}</option>
            <option value="magnitude">{text.magnitude}</option>
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{text.date}</th>
              <th>{text.magnitude}</th>
              <th>{text.depth}</th>
              <th>{text.coordinates}</th>
              <th>{text.category}</th>
              <th>{text.source}</th>
              {recent && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <td>{item.date.toLocaleString()}</td>
                <td>M {format(item.magnitude)}</td>
                <td
                  title={
                    item.hasDepth
                      ? depthLabel(item, text)
                      : text.depthUnavailable
                  }
                >
                  {item.hasDepth
                    ? `${format(item.depth)} km · ${item.depthSource}${item.depthQuality === "unverified_mpgv" ? `, ${text.unverifiedShort}` : ""}`
                    : "—"}
                </td>
                <td>
                  {format(item.latitude, 4)}, {format(item.longitude, 4)}
                </td>
                <td>
                  <span className={`category-badge ${item.category}`}>
                    {item.category === "matched" ? text.matched : text.mpgvOnly}
                  </span>
                </td>
                <td>{item.category === "matched" ? "MPGV + IMO" : "MPGV"}</td>
                {recent && (
                  <td>
                    <button type="button" onClick={() => onViewMap(item)}>
                      {text.viewMap}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((value) => value - 1)}
        >
          {text.previous}
        </button>
        <span>
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage((value) => value + 1)}
        >
          {text.next}
        </button>
      </div>
    </article>
  );
}

export default function ResultsTables({ analysis, text, onViewMap }) {
  return (
    <section className="results-grid" aria-label={text.results}>
      <ResultsTable
        title={text.strongestEarthquakes}
        rows={analysis.strongestRows}
        text={text}
        onViewMap={onViewMap}
      />
      <ResultsTable
        title={text.recentEarthquakes}
        rows={analysis.recentRows}
        text={text}
        onViewMap={onViewMap}
        recent
      />
    </section>
  );
}
