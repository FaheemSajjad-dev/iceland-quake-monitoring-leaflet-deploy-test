import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => {
  const Container = ({ children }) => <div>{children}</div>;
  const Empty = () => null;
  const Brush = ({ ariaLabel, endIndex, onChange, startIndex, tickFormatter }) => (
    <div>
      <span data-testid="brush-hover-label">
        {tickFormatter?.("2021-11-01T00:00:00.000Z")}
      </span>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onChange({ startIndex: Math.min(startIndex + 1, endIndex), endIndex })}
      >
        Move start
      </button>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onChange({ startIndex, endIndex: Math.max(startIndex, endIndex - 1) })}
      >
        Move end
      </button>
    </div>
  );
  return {
    Bar: Empty,
    BarChart: Container,
    Brush,
    CartesianGrid: Empty,
    Legend: Empty,
    Line: Empty,
    LineChart: Container,
    ReferenceDot: Empty,
    ResponsiveContainer: Container,
    Scatter: Empty,
    ScatterChart: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
    ZAxis: Empty,
  };
});

import { CategoryTimeChart, TimeChart } from "../analysis/AnalysisCharts";

const text = {
  locale: "en-GB",
  rangeStart: "Start",
  rangeEnd: "End",
};
const data = [
  { period: "2021-11-01T00:00:00.000Z", count: 1 },
  { period: "2022-06-01T00:00:00.000Z", count: 2 },
  { period: "2024-12-01T00:00:00.000Z", count: 3 },
];

describe("time-chart range labels", () => {
  it("hides temporary slider dates on the data-category chart", () => {
    render(
      <CategoryTimeChart
        data={data}
        includeUnverified
        text={{ ...text, matched: "Matched", mpgvOnly: "MPGV only" }}
      />,
    );
    expect(screen.getByTestId("brush-hover-label")).toBeEmptyDOMElement();
    expect(screen.getByText("1 Nov 2021")).toBeInTheDocument();
    expect(screen.getByText("1 Dec 2024")).toBeInTheDocument();
  });

  it("shows the full range and updates labels and accessibility with both handles", () => {
    render(<TimeChart data={data} metric="count" color="#000" text={text} />);
    expect(screen.getByText("1 Nov 2021")).toBeInTheDocument();
    expect(screen.getByText("1 Dec 2024")).toBeInTheDocument();
    expect(screen.getByTestId("brush-hover-label")).toBeEmptyDOMElement();
    expect(screen.getAllByRole("button", {
      name: "Start: 1 November 2021; End: 1 December 2024",
    })).toHaveLength(2);

    fireEvent.click(screen.getByText("Move start"));
    expect(screen.getByText("1 Jun 2022")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Move end"));
    expect(screen.getAllByText("1 Jun 2022")).toHaveLength(2);
  });

  it("resets to a newly filtered range and formats Icelandic labels", async () => {
    const { rerender } = render(
      <TimeChart data={data} metric="count" color="#000" text={text} />,
    );
    fireEvent.click(screen.getByText("Move start"));
    const filtered = data.slice(1);
    rerender(
      <TimeChart
        data={filtered}
        metric="count"
        color="#000"
        text={{ locale: "is-IS", rangeStart: "Upphaf", rangeEnd: "Endir" }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("1. jún. 2022")).toBeInTheDocument();
      expect(screen.getByText("1. des. 2024")).toBeInTheDocument();
    });
  });

  it("returns to the full range when Reset zoom remounts the chart", () => {
    const { rerender } = render(
      <TimeChart key="zoom-0" data={data} metric="count" color="#000" text={text} />,
    );
    fireEvent.click(screen.getByText("Move start"));
    expect(screen.queryByText("1 Nov 2021")).not.toBeInTheDocument();
    rerender(
      <TimeChart key="zoom-1" data={data} metric="count" color="#000" text={text} />,
    );
    expect(screen.getByText("1 Nov 2021")).toBeInTheDocument();
    expect(screen.getByText("1 Dec 2024")).toBeInTheDocument();
  });
});
