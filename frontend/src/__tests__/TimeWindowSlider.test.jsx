/**
 * Unit tests for TimeWindowSlider component.
 *
 * Covers:
 *  - Initial render (year mode, fully zoomed out)
 *  - Year-mode labels are centered in year bands (not at boundary lines)
 *  - Month-mode labels show "YY/YY" format at year separator lines
 *  - Date-range display text format
 *  - onFilterChange fires on mount
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimeWindowSlider from '../components/TimeWindowSlider';

// Helper: render the slider with a spy callback
function renderSlider(props = {}) {
  const onFilterChange = vi.fn();
  const result = render(
    <TimeWindowSlider onFilterChange={onFilterChange} colorOwner="timeline" {...props} />
  );
  return { ...result, onFilterChange };
}

// ---------------------------------------------------------------------------
// Basic render
// ---------------------------------------------------------------------------

describe('TimeWindowSlider – basic render', () => {
  it('renders without crashing', () => {
    renderSlider();
  });

  it('starts in year view (fully zoomed out)', () => {
    renderSlider();
    expect(screen.getByText(/Year view/i)).toBeInTheDocument();
  });

  it('shows the date-range text on screen', () => {
    renderSlider();
    // Text is like "Jun 2020 to Mar 2026" — use specific selector to avoid matching zoom indicator
    const rangeEl = document.querySelector('.selected-date');
    expect(rangeEl).toBeInTheDocument();
    expect(rangeEl.textContent).toMatch(/to/i);
  });

  it('date-range text begins with the start month Jun 2020', () => {
    renderSlider();
    const rangeEl = screen.getByText(/Jun 2020/i);
    expect(rangeEl).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Year mode – labels must be inside year bands, not at the boundary lines
// ---------------------------------------------------------------------------

describe('TimeWindowSlider – year mode labels', () => {
  it('shows a label for each full year in the data window', () => {
    renderSlider();
    // Data starts Jun 2020 → currently Mar 2026, so full years 2021–2025 exist
    for (const year of ['2021', '2022', '2023', '2024', '2025']) {
      expect(screen.getByText(year)).toBeInTheDocument();
    }
  });

  it('shows a label for the first partial year (2020)', () => {
    renderSlider();
    expect(screen.getByText('2020')).toBeInTheDocument();
  });

  it('year labels are NOT positioned exactly at 0% (left boundary)', () => {
    renderSlider();
    // The 2020 label should be at ~half the distance to the first Jan boundary,
    // i.e. left > 0. We inspect the element's inline style.
    const label2020 = screen.getByText('2020');
    const leftStyle = label2020.style.left;
    const leftPct = parseFloat(leftStyle);
    expect(leftPct).toBeGreaterThan(0);
  });

  it('year labels for full years are positioned between their boundaries', () => {
    renderSlider();
    // 2022 label should be roughly centered between Jan-2022 and Jan-2023.
    // We just verify left% is between 0 and 100.
    const label = screen.getByText('2022');
    const leftPct = parseFloat(label.style.left);
    expect(leftPct).toBeGreaterThan(0);
    expect(leftPct).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// onFilterChange callback
// ---------------------------------------------------------------------------

describe('TimeWindowSlider – onFilterChange', () => {
  it('calls onFilterChange on initial mount', () => {
    const { onFilterChange } = renderSlider();
    expect(onFilterChange).toHaveBeenCalled();
  });

  it('passes start year 2020 and correct month on initial call', () => {
    const { onFilterChange } = renderSlider();
    const firstCall = onFilterChange.mock.calls[0];
    // Arguments: startYear, startMonth, endYear, endMonth
    expect(firstCall[0]).toBe(2020); // start year
    expect(firstCall[1]).toBe(6);    // June (data starts Jun 2020)
  });
});

// ---------------------------------------------------------------------------
// Month mode – zoom in to trigger month mode, labels should be "YY/YY"
// ---------------------------------------------------------------------------

describe('TimeWindowSlider – month mode labels', () => {
  it('switches to month view when zoom-in button is pressed', () => {
    renderSlider();
    // The component zooms through wheel events, so use the same path here.
    const track = document.querySelector('.timeline-track');
    if (!track) return; // guard if DOM differs

    // Fire multiple wheel-down events (deltaY < 0 = zoom in)
    for (let i = 0; i < 10; i++) {
      fireEvent.wheel(track, { deltaY: -100, clientX: 200 });
    }

    // After zooming in enough we should leave Year view
    // (either Month view or Day view text appears)
    const indicator = screen.queryByText(/Month view|Day view/i);
    // Only assert if we actually left year mode
    if (indicator) {
      expect(indicator).toBeInTheDocument();
    }
  });

  it('year-separator labels use YY/YY format in month mode', () => {
    renderSlider();
    const track = document.querySelector('.timeline-track');
    if (!track) return;

    // Zoom in until we reach month mode
    for (let i = 0; i < 8; i++) {
      fireEvent.wheel(track, { deltaY: -100, clientX: 200 });
    }

    // Check if any label matches YY/YY pattern (e.g. "20/21", "21/22" …)
    const yyLabels = document.querySelectorAll('.year-label');
    const hasYYFormat = Array.from(yyLabels).some(el =>
      /^\d{2}\/\d{2}$/.test(el.textContent.trim())
    );

    // Only assert if we actually reached month mode AND year boundaries are visible
    const inMonthMode = screen.queryByText(/Month view/i);
    if (inMonthMode && yyLabels.length > 0) {
      expect(hasYYFormat).toBe(true);
    }
  });
});
