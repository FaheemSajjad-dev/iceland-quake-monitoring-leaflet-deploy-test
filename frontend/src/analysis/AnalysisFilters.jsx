import { useState } from "react";

const NumberField = ({ label, name, value, onChange, step = 0.1 }) => (
  <label>
    <span>{label}</span>
    <input
      name={name}
      type="number"
      step={step}
      value={value}
      onChange={onChange}
      required
    />
  </label>
);

export default function AnalysisFilters({
  filters,
  bounds,
  errors,
  onApply,
  onReset,
  text,
}) {
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState(false);
  const change = (event) =>
    setDraft((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const reset = () => {
    const next = onReset();
    setDraft(next);
  };
  return (
    <section
      className="analysis-filters"
      aria-labelledby="analysis-filters-title"
    >
      <div className="analysis-section-heading">
        <h2 id="analysis-filters-title">{text.filters}</h2>
        <button
          className="analysis-filter-toggle"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {text.filters}
        </button>
      </div>
      <form
        className={open ? "is-open" : ""}
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
          setOpen(false);
        }}
      >
        <label>
          <span>{text.startDate}</span>
          <input
            name="startDate"
            type="date"
            min={bounds?.startDate}
            max={bounds?.endDate}
            value={draft.startDate}
            onChange={change}
            required
          />
        </label>
        <label>
          <span>{text.endDate}</span>
          <input
            name="endDate"
            type="date"
            min={bounds?.startDate}
            max={bounds?.endDate}
            value={draft.endDate}
            onChange={change}
            required
          />
        </label>
        <NumberField
          label={text.minMagnitude}
          name="minMagnitude"
          value={draft.minMagnitude}
          onChange={change}
        />
        <NumberField
          label={text.maxMagnitude}
          name="maxMagnitude"
          value={draft.maxMagnitude}
          onChange={change}
        />
        <NumberField
          label={text.minDepth}
          name="minDepth"
          value={draft.minDepth}
          onChange={change}
        />
        <NumberField
          label={text.maxDepth}
          name="maxDepth"
          value={draft.maxDepth}
          onChange={change}
        />
        <label>
          <span>{text.depthQuality}</span>
          <select
            name="depthQuality"
            value={draft.depthQuality}
            onChange={change}
          >
            <option value="reference_only">{text.referenceOnly}</option>
            <option value="include_unverified">{text.includeUnverified}</option>
          </select>
          <small>{text.depthFilterHint}</small>
        </label>
        <label>
          <span>{text.category}</span>
          <select name="category" value={draft.category} onChange={change}>
            <option value="all">{text.all}</option>
            <option value="matched">{text.matched}</option>
            <option value="mpgv_only">{text.mpgvOnly}</option>
          </select>
        </label>
        <label>
          <span>{text.grouping}</span>
          <select name="grouping" value={draft.grouping} onChange={change}>
            <option value="day">{text.day}</option>
            <option value="week">{text.week}</option>
            <option value="month">{text.month}</option>
            <option value="year">{text.year}</option>
          </select>
        </label>
        <div className="analysis-filter-actions">
          <button className="primary" type="submit">
            {text.apply}
          </button>
          <button type="button" onClick={reset}>
            {text.reset}
          </button>
        </div>
      </form>
      {Object.keys(errors).length > 0 && (
        <p className="analysis-error" role="alert">
          {text[Object.values(errors)[0]]}
        </p>
      )}
    </section>
  );
}
