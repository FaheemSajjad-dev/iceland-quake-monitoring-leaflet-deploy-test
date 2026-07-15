import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../i18n";
import RecentSelections from "../components/RecentSelections";

const quake = {
  Mw_mean: 4.2,
  "Date-time": "2026-07-15 12:34:56",
  Depth: 8.5,
  Latitude: 64.12345,
  Longitude: -21.98765,
};

const renderPanel = props => render(
  <LangProvider>
    <RecentSelections earthquakes={[quake]} onClose={() => {}} onClear={() => {}} onView={() => {}} {...props} />
  </LangProvider>
);

describe("RecentSelections", () => {
  it("shows compact earthquake details and sends the selected earthquake to the map", () => {
    const onView = vi.fn();
    renderPanel({ onView });

    expect(screen.getByText("M 4.2")).toBeInTheDocument();
    expect(screen.getByText("2026-07-15 12:34:56")).toBeInTheDocument();
    expect(screen.getByText("8.5 km")).toBeInTheDocument();
    expect(screen.getByText("64.1235, -21.9876")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View on map" }));
    expect(onView).toHaveBeenCalledWith(quake);
  });

  it("supports clearing history and closing with Escape", () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    renderPanel({ onClear, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(onClear).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an empty state and disables clearing when no markers have been selected", () => {
    renderPanel({ earthquakes: [] });
    expect(screen.getByText(/Select an earthquake marker/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear history" })).toBeDisabled();
  });
});
