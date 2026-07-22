import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalysisFilters from "../analysis/AnalysisFilters";

const text = {
  filters: "Filters",
  startDate: "Start date",
  endDate: "End date",
  minMagnitude: "Minimum magnitude",
  maxMagnitude: "Maximum magnitude",
  minDepth: "Minimum depth (km)",
  maxDepth: "Maximum depth (km)",
  depthQuality: "Depth quality",
  referenceOnly: "Matched depths only",
  includeUnverified: "Include unverified MPGV depths",
  depthFilterHint: "Depth hint",
  noEligibleDepths: "No eligible depth values are available.",
  category: "Data category",
  all: "All",
  matched: "Matched",
  mpgvOnly: "MPGV-only",
  grouping: "Time grouping",
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  apply: "Apply filters",
  reset: "Reset filters",
};

const limitsByPolicy = {
  reference_only: {
    magnitude_limits: { minimum: 3.01, maximum: 5.83 },
    depth_limits: { minimum: 2.4, maximum: 40.7 },
  },
  include_unverified: {
    magnitude_limits: { minimum: 3.01, maximum: 5.83 },
    depth_limits: { minimum: 1.1, maximum: 900 },
  },
};

const filters = {
  startDate: "2024-01-01",
  endDate: "2026-07-20",
  minMagnitude: 3.01,
  maxMagnitude: 5.83,
  minDepth: 2.4,
  maxDepth: 40.7,
  depthQuality: "reference_only",
  category: "all",
  grouping: "month",
};

const renderFilters = (overrides = {}) => {
  const onApply = vi.fn();
  render(
    <AnalysisFilters
      filters={filters}
      bounds={{
        startDate: "2024-01-01",
        endDate: "2026-07-20",
        minMagnitude: 3.01,
        maxMagnitude: 5.83,
        minDepth: 2.4,
        maxDepth: 40.7,
      }}
      errors={{}}
      onApply={onApply}
      onReset={() => filters}
      limitsByPolicy={limitsByPolicy}
      limitsLoading={false}
      text={text}
      {...overrides}
    />,
  );
  return onApply;
};

describe("AnalysisFilters numeric limits", () => {
  it("sets exact catalogue boundaries and accepts their full precision", () => {
    renderFilters();
    expect(screen.getByLabelText("Minimum magnitude")).toHaveAttribute("min", "3.01");
    expect(screen.getByLabelText("Maximum magnitude")).toHaveAttribute("max", "5.83");
    expect(screen.getByLabelText("Maximum magnitude")).toHaveAttribute("step", "any");
    expect(screen.getByLabelText("Minimum depth (km)")).toHaveAttribute("min", "2.4");
    expect(screen.getByLabelText("Maximum depth (km)")).toHaveAttribute("max", "40.7");
    expect(screen.getByLabelText("Maximum depth (km)")).toHaveAttribute("step", "any");
  });

  it("accepts an exact catalogue maximum that is not aligned to a display increment", () => {
    const exactMaximum = 22.657;
    const onApply = renderFilters({
      filters: { ...filters, maxDepth: exactMaximum },
      bounds: { minDepth: 2.4, maxDepth: exactMaximum },
      limitsByPolicy: {
        ...limitsByPolicy,
        reference_only: {
          ...limitsByPolicy.reference_only,
          depth_limits: { minimum: 2.4, maximum: exactMaximum },
        },
      },
    });
    const maximumDepth = screen.getByLabelText("Maximum depth (km)");
    expect(maximumDepth).toHaveValue(exactMaximum);
    expect(maximumDepth.validity.stepMismatch).toBe(false);
    fireEvent.submit(screen.getByRole("button", { name: "Apply filters" }).closest("form"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ maxDepth: exactMaximum }));
  });

  it("clamps manually typed values and permits equal endpoints", () => {
    const onApply = renderFilters();
    const minimumMagnitude = screen.getByLabelText("Minimum magnitude");
    const maximumDepth = screen.getByLabelText("Maximum depth (km)");
    fireEvent.change(minimumMagnitude, { target: { value: "99" } });
    fireEvent.blur(minimumMagnitude);
    expect(minimumMagnitude).toHaveValue(5.83);
    fireEvent.change(maximumDepth, { target: { value: "999" } });
    fireEvent.blur(maximumDepth);
    expect(maximumDepth).toHaveValue(40.7);
    fireEvent.submit(screen.getByRole("button", { name: "Apply filters" }).closest("form"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      minMagnitude: 5.83,
      maxMagnitude: 5.83,
      maxDepth: 40.7,
    }));
  });

  it("recalculates and clamps depth values when depth quality changes", () => {
    renderFilters({
      filters: {
        ...filters,
        minDepth: 100,
        maxDepth: 900,
        depthQuality: "include_unverified",
      },
      bounds: {
        startDate: "2024-01-01",
        endDate: "2026-07-20",
        minMagnitude: 3.01,
        maxMagnitude: 5.83,
        minDepth: 1.1,
        maxDepth: 900,
      },
    });
    fireEvent.change(document.querySelector('[name="depthQuality"]'), {
      target: { value: "reference_only" },
    });
    expect(screen.getByLabelText("Minimum depth (km)")).toHaveValue(40.7);
    expect(screen.getByLabelText("Maximum depth (km)")).toHaveValue(40.7);
  });

  it("disables depth fields when a policy has no eligible depths", () => {
    renderFilters({
      limitsByPolicy: {
        ...limitsByPolicy,
        reference_only: {
          ...limitsByPolicy.reference_only,
          depth_limits: { minimum: null, maximum: null },
        },
      },
    });
    expect(screen.getByLabelText("Minimum depth (km)")).toBeDisabled();
    expect(screen.getByLabelText("Maximum depth (km)")).toBeDisabled();
    expect(screen.getByText("No eligible depth values are available.")).toBeInTheDocument();
  });
});
