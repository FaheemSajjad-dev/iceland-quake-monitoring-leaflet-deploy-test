import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../i18n";

vi.mock("../analysis/AnalysisCharts", () => ({
  default: () => <div data-testid="analysis-charts">Charts</div>,
}));
vi.mock("../analysis/ResultsTables", () => ({
  default: () => <div data-testid="analysis-tables">Tables</div>,
}));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchInsightsLimits: vi.fn() };
});

import { DEPTH_POLICIES, fetchInsightsLimits } from "../api";
import AnalysisPage from "../analysis/AnalysisPage";

const earthquake = {
  "Date-time": "2024-01-01 12:00:00",
  Latitude: 64,
  Longitude: -21,
  Depth: 8.5,
  Mw_mean: 4.2,
  status: "matched",
};
const response = (policy, depthLimits = { minimum: 2.4, maximum: 40.7 }) => ({
  depth_quality: policy,
  magnitude_limits: { minimum: 3.01, maximum: 5.83 },
  depth_limits: depthLimits,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const completeLimits = () => fetchInsightsLimits.mockImplementation((policy) =>
  Promise.resolve(response(policy, policy === DEPTH_POLICIES.MATCHED_ONLY
    ? { minimum: 2.4, maximum: 40.7 }
    : { minimum: 1.1, maximum: 900 })),
);
const renderPage = (props = {}) => render(
  <LangProvider>
    <AnalysisPage
      earthquakes={[earthquake]}
      loading={false}
      loadError={false}
      onRetryData={vi.fn()}
      onMap={vi.fn()}
      onViewMap={vi.fn()}
      {...props}
    />
  </LangProvider>,
);

describe("AnalysisPage initialization lifecycle", () => {
  beforeEach(() => fetchInsightsLimits.mockReset());

  it("shows only the skeleton while earthquake data is pending", async () => {
    const matched = deferred();
    const all = deferred();
    fetchInsightsLimits.mockImplementation((policy) =>
      policy === DEPTH_POLICIES.MATCHED_ONLY ? matched.promise : all.promise);
    renderPage({ earthquakes: [], loading: true });
    expect(screen.getByTestId("analysis-skeleton")).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum magnitude")).not.toBeInTheDocument();
    expect(screen.queryByTestId("analysis-charts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("analysis-tables")).not.toBeInTheDocument();
    expect(screen.queryByText("No earthquakes match these filters.")).not.toBeInTheDocument();
    await act(async () => {
      matched.resolve(response(DEPTH_POLICIES.MATCHED_ONLY));
      all.resolve(response(DEPTH_POLICIES.INCLUDE_UNVERIFIED));
    });
  });

  it("keeps filters, charts, and tables unmounted while limits are pending", async () => {
    const matched = deferred();
    const all = deferred();
    fetchInsightsLimits.mockImplementation((policy) =>
      policy === DEPTH_POLICIES.MATCHED_ONLY ? matched.promise : all.promise,
    );
    renderPage();
    expect(screen.getByTestId("analysis-skeleton")).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum depth (km)")).not.toBeInTheDocument();
    expect(screen.queryByTestId("analysis-charts")).not.toBeInTheDocument();

    await act(async () => {
      matched.resolve(response(DEPTH_POLICIES.MATCHED_ONLY));
      all.resolve(response(DEPTH_POLICIES.INCLUDE_UNVERIFIED, { minimum: 1.1, maximum: 900 }));
    });
  });

  it("reveals the complete page only after coordinated filter initialization", async () => {
    completeLimits();
    renderPage();
    await waitFor(() => expect(screen.queryByTestId("analysis-skeleton")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Start date")).toHaveValue("2024-01-01");
    expect(screen.getByLabelText("Maximum magnitude")).toHaveValue(5.83);
    expect(screen.getByLabelText("Maximum depth (km)")).toHaveValue(40.7);
    expect(screen.getByTestId("analysis-charts")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-tables")).toBeInTheDocument();
  });

  it("does not restore the full skeleton when applied filters produce no results", async () => {
    completeLimits();
    renderPage();
    const minimum = await screen.findByLabelText("Minimum magnitude");
    fireEvent.change(minimum, { target: { value: "5" } });
    fireEvent.submit(screen.getByRole("button", { name: "Apply filters" }).closest("form"));
    expect(await screen.findByText("No earthquakes match these filters.")).toBeInTheDocument();
    expect(screen.queryByTestId("analysis-skeleton")).not.toBeInTheDocument();
  });

  it("shows a retryable limits error without exposing empty filters", async () => {
    fetchInsightsLimits.mockImplementation((policy) => policy === DEPTH_POLICIES.MATCHED_ONLY
      ? Promise.reject(new Error("network failure"))
      : Promise.resolve(response(policy)));
    renderPage();
    expect(await screen.findByText("Filter limits could not be loaded. Try again shortly.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum magnitude")).not.toBeInTheDocument();
  });

  it("shows a retryable earthquake error separately", async () => {
    const matched = deferred();
    const all = deferred();
    fetchInsightsLimits.mockImplementation((policy) =>
      policy === DEPTH_POLICIES.MATCHED_ONLY ? matched.promise : all.promise);
    const retry = vi.fn();
    renderPage({ earthquakes: [], loading: false, loadError: true, onRetryData: retry });
    expect(screen.getByText("Earthquake data could not be loaded. Try again shortly.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("analysis-skeleton")).not.toBeInTheDocument();
    await act(async () => {
      matched.resolve(response(DEPTH_POLICIES.MATCHED_ONLY));
      all.resolve(response(DEPTH_POLICIES.INCLUDE_UNVERIFIED));
    });
  });
});
