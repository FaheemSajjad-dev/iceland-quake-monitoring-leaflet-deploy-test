import { useEffect, useState } from "react";
import { DEPTH_POLICIES } from "../api";

const NumberField = ({
  label,
  name,
  value,
  onChange,
  onBlur,
  min,
  max,
  step,
  disabled,
}) => (
  <label>
    <span>{label}</span>
    <input
      name={name}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
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
  limitsByPolicy,
  limitsLoading,
  text,
}) {
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(filters), [filters]);

  const magnitudeLimits =
    limitsByPolicy?.[DEPTH_POLICIES.MATCHED_ONLY]?.magnitude_limits;
  const depthLimits = limitsByPolicy?.[draft.depthQuality]?.depth_limits;
  const hasMagnitudeLimits = Number.isFinite(magnitudeLimits?.minimum) &&
    Number.isFinite(magnitudeLimits?.maximum);
  const hasDepthLimits = Number.isFinite(depthLimits?.minimum) &&
    Number.isFinite(depthLimits?.maximum);
  const clamp = (value, minimum, maximum) =>
    Math.min(Math.max(Number(value), minimum), maximum);
  const numberOr = (value, fallback) =>
    value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clampPair = (minimum, maximum, limits, edited) => {
    if (!Number.isFinite(limits?.minimum) || !Number.isFinite(limits?.maximum))
      return ["", ""];
    let nextMinimum = Number.isFinite(Number(minimum)) && minimum !== ""
      ? clamp(minimum, limits.minimum, limits.maximum)
      : limits.minimum;
    let nextMaximum = Number.isFinite(Number(maximum)) && maximum !== ""
      ? clamp(maximum, limits.minimum, limits.maximum)
      : limits.maximum;
    if (nextMinimum > nextMaximum) {
      if (edited?.startsWith("min")) nextMinimum = nextMaximum;
      else nextMaximum = nextMinimum;
    }
    return [nextMinimum, nextMaximum];
  };
  const normalizeDraft = (current, edited) => {
    const [minMagnitude, maxMagnitude] = clampPair(
      current.minMagnitude,
      current.maxMagnitude,
      magnitudeLimits,
      edited,
    );
    const [minDepth, maxDepth] = clampPair(
      current.minDepth,
      current.maxDepth,
      limitsByPolicy?.[current.depthQuality]?.depth_limits,
      edited,
    );
    return { ...current, minMagnitude, maxMagnitude, minDepth, maxDepth };
  };
  const change = (event) => {
    const { name, value } = event.target;
    setDraft((current) => {
      const next = { ...current, [name]: value };
      return name === "depthQuality" ? normalizeDraft(next, name) : next;
    });
  };
  const blur = (event) =>
    setDraft((current) => normalizeDraft(current, event.target.name));
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
          const normalized = normalizeDraft(draft, event.nativeEvent.submitter?.name);
          setDraft(normalized);
          onApply(normalized);
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
          min={magnitudeLimits?.minimum}
          max={numberOr(draft.maxMagnitude, magnitudeLimits?.maximum)}
          step="any"
          onChange={change}
          onBlur={blur}
          disabled={limitsLoading || !hasMagnitudeLimits}
        />
        <NumberField
          label={text.maxMagnitude}
          name="maxMagnitude"
          value={draft.maxMagnitude}
          min={numberOr(draft.minMagnitude, magnitudeLimits?.minimum)}
          max={bounds?.maxMagnitude}
          step="any"
          onChange={change}
          onBlur={blur}
          disabled={limitsLoading || !hasMagnitudeLimits}
        />
        <NumberField
          label={text.minDepth}
          name="minDepth"
          value={draft.minDepth}
          min={depthLimits?.minimum}
          max={numberOr(draft.maxDepth, depthLimits?.maximum)}
          step="any"
          onChange={change}
          onBlur={blur}
          disabled={limitsLoading || !hasDepthLimits}
        />
        <NumberField
          label={text.maxDepth}
          name="maxDepth"
          value={draft.maxDepth}
          min={numberOr(draft.minDepth, depthLimits?.minimum)}
          max={bounds?.maxDepth}
          step="any"
          onChange={change}
          onBlur={blur}
          disabled={limitsLoading || !hasDepthLimits}
        />
        <label>
          <span>{text.depthQuality}</span>
          <select
            name="depthQuality"
            value={draft.depthQuality}
            onChange={change}
          >
            <option value={DEPTH_POLICIES.MATCHED_ONLY}>
              {text.referenceOnly}
            </option>
            <option value={DEPTH_POLICIES.INCLUDE_UNVERIFIED}>
              {text.includeUnverified}
            </option>
          </select>
          <small>{text.depthFilterHint}</small>
          {!limitsLoading && !hasDepthLimits && (
            <small role="status">{text.noEligibleDepths}</small>
          )}
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
