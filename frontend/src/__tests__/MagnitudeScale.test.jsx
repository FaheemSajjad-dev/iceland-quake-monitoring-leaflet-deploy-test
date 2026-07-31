import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import MagnitudeScale from "../components/MagnitudeScale";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

const labels = (container) =>
  [...container.querySelectorAll(".magnitude-tick-label")].map((label) => label.textContent);

describe("MagnitudeScale", () => {
  it("uses the real display maximum for its slider, labels, and accessibility range", () => {
    const { container, getByRole } = render(
      <MagnitudeScale minMagnitude={3} maxMagnitude={6} vertical />,
    );
    const slider = getByRole("slider", { name: "Minimum earthquake magnitude" });

    expect(slider).toHaveAttribute("max", "6");
    expect(slider).toHaveAttribute("aria-valuemax", "6");
    expect(labels(container)).toEqual(["6.0", "5.0", "4.0", "3.0"]);
  });

  it("adds every whole-number label when the catalogue ceiling expands", () => {
    const { container, rerender, getByRole } = render(
      <MagnitudeScale minMagnitude={3} maxMagnitude={6} vertical />,
    );

    rerender(<MagnitudeScale minMagnitude={3} maxMagnitude={8} vertical />);

    expect(getByRole("slider")).toHaveAttribute("max", "8");
    expect(labels(container)).toEqual(["8.0", "7.0", "6.0", "5.0", "4.0", "3.0"]);
  });

  it("supports the expanded range through input and vertical keyboard controls", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <MagnitudeScale
        minMagnitude={3}
        maxMagnitude={7}
        onMagnitudeFilterChange={onChange}
        vertical
      />,
    );
    const slider = getByRole("slider");

    fireEvent.change(slider, { target: { value: "3.5" } });
    expect(onChange).toHaveBeenLastCalledWith(6.5);

    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(6.6);

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(6.5);

    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it("clamps the selected threshold and reset value when the catalogue ceiling shrinks", () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = render(
      <MagnitudeScale
        minMagnitude={3}
        maxMagnitude={7}
        onMagnitudeFilterChange={onChange}
        vertical
      />,
    );

    fireEvent.keyDown(getByRole("slider"), { key: "End" });
    rerender(
      <MagnitudeScale
        minMagnitude={3}
        maxMagnitude={6}
        onMagnitudeFilterChange={onChange}
        vertical
      />,
    );

    expect(onChange).toHaveBeenLastCalledWith(6);
    expect(getByRole("slider")).toHaveAttribute("aria-valuenow", "6");

    fireEvent.keyDown(getByRole("slider"), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(3);
  });
});
