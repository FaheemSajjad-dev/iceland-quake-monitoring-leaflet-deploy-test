import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLang } from '../i18n';
import './TimeWindowSlider.css';

const IS_MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'maí', 'jún', 'júl', 'ágú', 'sep', 'okt', 'nóv', 'des'];
const ZOOM_TEXT = {
  en: {
    day: 'Day view',
    week: 'Week view',
    year: 'Year view',
    month: 'Month view',
    hint: 'scroll to zoom time window, drag to shift',
  },
  is: {
    day: 'Dagsyfirlit',
    week: 'Vikuyfirlit',
    year: 'Ársyfirlit',
    month: 'Mánaðaryfirlit',
    hint: 'skrunaðu til að þysja tímabil, dragðu til að færa',
  },
};

const getDragSensitivity = ({ isDayViewMode, isWeekMode, isTouch = false }) => {
  if (!isTouch) return (isDayViewMode || isWeekMode) ? 0.1 : 2.0;
  if (isDayViewMode) return 0.03;
  if (isWeekMode) return 0.045;
  return 0.55;
};

const getZoomButtonDelta = ({ direction, isDayViewMode, isWeekMode, isYearMode }) => {
  const base =
    isDayViewMode ? 18 :
    isWeekMode ? 24 :
    isYearMode ? 60 : 36;
  return direction === "in" ? -base : base;
};

const TimeWindowSlider = ({ onFilterChange, colorOwner = 'timeline', mapType = 'roadmap', vertical = false, isHeatmap = false }) => {
  const langContext = useLang();
  const lang = langContext?.lang ?? 'en';
  const zoomText = ZOOM_TEXT[lang] ?? ZOOM_TEXT.en;
  const startDate = useMemo(() => new Date(2020, 5, 1), []);
  const currentDate = useMemo(() => new Date(), []);

  const totalDays = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));
  const totalMonths =
    (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
    (currentDate.getMonth() - startDate.getMonth()) + 1;

  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [viewOffset, setViewOffset] = useState(1.0);

  const isDayViewMode = zoomLevel < 0.01;
  const isWeekMode    = !isDayViewMode && zoomLevel < 0.02;
  const isYearMode    = zoomLevel >= 0.95;

  const sliderRef = useRef(null);
  const trackRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);

  const calculateVisibleRange = useCallback(() => {
    if (isDayViewMode) {
      const minDays = 3;
      const maxDays = 7;
      let normalized = (zoomLevel - 0.005) / (0.01 - 0.005);
      normalized = Math.max(0, Math.min(1, normalized));
      const daysToShow = Math.round(minDays + normalized * (maxDays - minDays));
      const maxOffset = Math.max(0, totalDays - daysToShow+1);
      const dayOffset = Math.round(viewOffset * maxOffset);
      const firstVisibleDate = new Date(startDate);
      firstVisibleDate.setDate(startDate.getDate() + dayOffset);
      const lastVisibleDate = new Date(firstVisibleDate);
      lastVisibleDate.setDate(firstVisibleDate.getDate() + daysToShow - 1);
      if (lastVisibleDate > currentDate) {
        lastVisibleDate.setTime(currentDate.getTime());
      }
      return { firstVisibleDate, lastVisibleDate, isDayView: true };
    } else if (isWeekMode) {
      // Weeks mode: 4 → 3 → 2 → 1 week(s) as you zoom in
        const weeksToShow =
          zoomLevel < 0.0125 ? 1 :
          zoomLevel < 0.015  ? 2 :
          zoomLevel < 0.0175 ? 3 : 4;
       const daysToShow = weeksToShow * 7;
        const maxOffset = Math.max(0, totalDays - daysToShow + 1);
        const dayOffset = Math.round(viewOffset * maxOffset);
        const firstVisibleDate = new Date(startDate);
        firstVisibleDate.setDate(startDate.getDate() + dayOffset);
        const lastVisibleDate = new Date(firstVisibleDate);
        lastVisibleDate.setDate(firstVisibleDate.getDate() + daysToShow - 1);
        if (lastVisibleDate > currentDate) {
          lastVisibleDate.setTime(currentDate.getTime());
        }
        return { firstVisibleDate, lastVisibleDate, isWeekMode: true };
      	} else if (isYearMode) {
		// Year mode: show the full range June 2020 → today,
		// but still express it in terms of months so dividers line up correctly.
		const visibleMonths = totalMonths;
		const firstVisibleMonthIndex = 0;
		const firstVisibleDate = new Date(startDate);
		const lastVisibleDate  = new Date(currentDate);

		return {
			firstVisibleDate,
			lastVisibleDate,
			visibleMonths,
			isDayView: false,
			isYearMode: true,
			firstVisibleMonthIndex,
			lastVisibleMonthIndex: firstVisibleMonthIndex + visibleMonths - 1,
		};
	} else {
      // Months mode: continuous mapping from zoom → span
      const visibleMonths = Math.max(
        1,
        Math.min(totalMonths, Math.round(totalMonths * zoomLevel))
      );
      const maxOffset = Math.max(0, totalMonths - visibleMonths);
      const firstVisibleMonthIndex = Math.round(viewOffset * maxOffset);
      const firstVisibleDate = new Date(startDate);
      firstVisibleDate.setMonth(startDate.getMonth() + firstVisibleMonthIndex);
      const lastVisibleDate = new Date(firstVisibleDate);
      lastVisibleDate.setMonth(firstVisibleDate.getMonth() + visibleMonths - 1);
      const lastDay = new Date(lastVisibleDate.getFullYear(), lastVisibleDate.getMonth() + 1, 0).getDate();
      lastVisibleDate.setDate(lastDay);
      if (lastVisibleDate > currentDate) {
        lastVisibleDate.setTime(currentDate.getTime());
      }
      return {
        firstVisibleDate,
        lastVisibleDate,
        visibleMonths,
        isDayView: false,
        firstVisibleMonthIndex,
        lastVisibleMonthIndex: firstVisibleMonthIndex + visibleMonths - 1,
      };
    }
  }, [currentDate, isDayViewMode, isWeekMode, isYearMode, startDate, totalDays, totalMonths, viewOffset, zoomLevel]);

  const formatDateRangeDisplay = () => {
		const range = calculateVisibleRange();
		const { firstVisibleDate, lastVisibleDate } = range;
    const formatMonth = (date) =>
      lang === 'is'
        ? IS_MONTH_SHORT[date.getMonth()]
        : date.toLocaleString("default", { month: "short" });

		const fmtDay = (date) =>
			`${date.getDate()} ${formatMonth(date)} ${date.getFullYear()}`;

		const fmtMonth = (date) =>
			`${formatMonth(date)} ${date.getFullYear()}`;

		const useDayPrecision = range.isDayView || range.isWeekMode;
		const f = useDayPrecision ? fmtDay : fmtMonth;

		return `${f(firstVisibleDate)} to ${f(lastVisibleDate)}`;
	};


  const updateParentWithCurrentRange = useCallback(() => {
    const range = calculateVisibleRange();
    if (range.isDayView || range.isWeekMode) {
      onFilterChange(
        range.firstVisibleDate.getFullYear(),
        range.firstVisibleDate.getMonth() + 1,
        range.lastVisibleDate.getFullYear(),
        range.lastVisibleDate.getMonth() + 1,
        range.firstVisibleDate.getDate(),
        range.lastVisibleDate.getDate()
      );
    } else if (range.isYearMode) {
      onFilterChange(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        currentDate.getFullYear(),
        currentDate.getMonth() + 1
      );
    } else {
      onFilterChange(
        range.firstVisibleDate.getFullYear(),
        range.firstVisibleDate.getMonth() + 1,
        range.lastVisibleDate.getFullYear(),
        range.lastVisibleDate.getMonth() + 1
      );
    }
  }, [calculateVisibleRange, currentDate, onFilterChange, startDate]);

  useEffect(() => {
    const handler = setTimeout(() => {
      updateParentWithCurrentRange();
    }, 200);
    return () => clearTimeout(handler);
  }, [updateParentWithCurrentRange, viewOffset, zoomLevel]);

  useEffect(() => {
    updateParentWithCurrentRange();
  }, [updateParentWithCurrentRange]);

  const handleMouseDown = (e) => {
    if (!trackRef.current) return;
    
    isDraggingRef.current = true;
    dragStartXRef.current = vertical ? e.clientY : e.clientX;
    dragStartOffsetRef.current = viewOffset;
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    
    trackRef.current.classList.add("dragging");
    e.preventDefault(); // Prevent text selection during drag
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current || !trackRef.current) return;
    
    const trackWidth = trackRef.current.offsetWidth;
    const delta = (vertical ? e.clientY : e.clientX) - dragStartXRef.current;

    // Horizontal: drag right → earlier dates, so negate delta.
    // Vertical (rotated -90deg): drag down is visually leftward along the timeline,
    // so use positive delta to keep drag-down = earlier dates (natural direction).
    const sensitivityFactor = getDragSensitivity({ isDayViewMode, isWeekMode });
    const deltaRatio = (vertical ? delta : -delta) / trackWidth * sensitivityFactor;
    const newOffset = Math.max(0, Math.min(1, dragStartOffsetRef.current + deltaRatio));

    setViewOffset(newOffset);
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    
    if (trackRef.current) {
      trackRef.current.classList.remove("dragging");
    }
  };

  // Zoom handler – smooth, no big jumps, anchored to cursor in month mode
  const applyZoom = (raw, cursorRatio = 0.5) => {
    const clamped = Math.max(-60, Math.min(60, raw));
    const k = zoomLevel < 0.1 ? 0.004 : 0.006;
    const scale = Math.exp(clamped * k);

    const oldZoom = zoomLevel;
    const newZoom = Math.max(0.005, Math.min(1.0, zoomLevel * scale));

    // Month mode: anchor zoom to the month under the cursor to avoid big jumps
    if (!isDayViewMode && !isWeekMode && !isYearMode) {
      const range = calculateVisibleRange();
      const N = totalMonths;

      const Mold = Math.max(
        1,
        Math.min(N, range.visibleMonths || Math.round(totalMonths * oldZoom))
      );
      const i0old = range.firstVisibleMonthIndex || 0; // leftmost visible month index

      // Absolute month index under the cursor before zoom
      const iUnderCursor = i0old + cursorRatio * Mold;

      const Mnew = Math.max(
        1,
        Math.min(N, Math.round(totalMonths * newZoom))
      );
      const maxOffsetIdx = Math.max(0, N - Mnew);

      // New left index so that the same absolute month stays under the cursor
      let i0new = iUnderCursor - cursorRatio * Mnew;
      i0new = Math.max(0, Math.min(maxOffsetIdx, i0new));

      // Convert back to viewOffset in [0, 1]
      const newViewOffset =
        maxOffsetIdx > 0 ? i0new / maxOffsetIdx : 0;

      setZoomLevel(newZoom);
      setViewOffset(newViewOffset);
      return;
    }

    // Day / week / year modes
    const absolutePoint = viewOffset + cursorRatio * oldZoom;
    let newOffset = absolutePoint - cursorRatio * newZoom;

    if (newZoom >= 1.0) {
      newOffset = 1.0;
    }

    newOffset = Math.max(0, Math.min(1, newOffset));
    setZoomLevel(newZoom);
    setViewOffset(newOffset);
  };

  const handleWheel = (e) => {
    e.preventDefault();

    if (!trackRef.current) {
      applyZoom(e.deltaY);
      return;
    }

    const rect = trackRef.current.getBoundingClientRect();
    // In vertical mode the slider is rotated -90deg; top = newer, bottom = older
    const cursorRatio = vertical
      ? 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)))
      : Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));

    applyZoom(e.deltaY, cursorRatio);
  };

  // Stable wheel listener registered once. handleWheelRef.current is updated every render
  // so the wrapper always calls the latest closure without re-registering the listener.
  const handleWheelRef = useRef(null);
  handleWheelRef.current = handleWheel;

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const handler = (e) => handleWheelRef.current(e);
    slider.addEventListener("wheel", handler, { passive: false });
    return () => slider.removeEventListener("wheel", handler);
  }, []);

  const handleTouchStart = (e) => {
    if (!trackRef.current) return;
    const t = e.touches[0];
    isDraggingRef.current = true;
    dragStartXRef.current = vertical ? t.clientY : t.clientX;
    dragStartOffsetRef.current = viewOffset;
    trackRef.current.classList.add("dragging");
  };

  const handleTouchMove = (e) => {
    if (!isDraggingRef.current || !trackRef.current) return;
    const t = e.touches[0];
    const trackWidth = trackRef.current.offsetWidth;
    const delta = (vertical ? t.clientY : t.clientX) - dragStartXRef.current;

    const sensitivityFactor = getDragSensitivity({ isDayViewMode, isWeekMode, isTouch: true });
    const deltaRatio = (vertical ? delta : -delta) / trackWidth * sensitivityFactor;
    const newOffset = Math.max(0, Math.min(1, dragStartOffsetRef.current + deltaRatio));
    setViewOffset(newOffset);
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    if (trackRef.current) trackRef.current.classList.remove("dragging");
  };

  const handleZoomButtonClick = (direction) => {
    applyZoom(getZoomButtonDelta({ direction, isDayViewMode, isWeekMode, isYearMode }));
  };


	const generateDividers = useCallback(() => {
		const dividers = [];
		const labels = [];
		const range = calculateVisibleRange();

		if (range.isDayView || range.isWeekMode) {
			const { firstVisibleDate, lastVisibleDate } = range;
			const oneDay = 24 * 60 * 60 * 1000;
			const days =
				Math.ceil((lastVisibleDate - firstVisibleDate) / oneDay) + 1;
			const dividerDate = new Date(firstVisibleDate);

			// Only three day labels: left, center, right
			const labelIndices =
				days <= 3
					? [...Array(days).keys()]
					: [0, Math.floor((days - 1) / 2), days - 1];

			for (let i = 0; i < days; i++) {
				// Left edge of this day's box; labels are centred inside the box
				const dividerPos = (i / days) * 100;
				const labelPos   = ((i + 0.5) / days) * 100;

				const isYearBoundary =
					dividerDate.getMonth() === 0 && dividerDate.getDate() === 1;

				dividers.push(
					<div
						key={`day-divider-${dividerDate.toISOString()}`}
						className={
							isYearBoundary
								? "divider divider-year"
								: "divider divider-day"
						}
						style={{ left: `${dividerPos}%`, height: "100%", top: 0 }}
					/>
				);

				if (labelIndices.includes(i)) {
					labels.push(
						<div
							key={`day-label-${dividerDate.toISOString()}`}
							className="day-label"
							style={{ left: `${labelPos}%` }}
						>
							{dividerDate.getDate()}
						</div>
					);
				}

				// Year label at the Jan 1 divider line showing prev/next year
				if (isYearBoundary) {
					const yr = dividerDate.getFullYear();
					labels.push(
						<div
							key={`year-label-${yr}`}
							className="year-label"
							style={{ left: `${dividerPos}%` }}
						>
							{String(yr - 1).slice(-2)}/{String(yr).slice(-2)}
						</div>
					);
				}

				dividerDate.setDate(dividerDate.getDate() + 1);
			}

			dividers.push(
				<div
					key="day-divider-end"
					className="divider divider-day"
					style={{ left: "100%", height: "100%", top: 0 }}
				/>
			);

			return { dividers, labels };
		}

		const visibleMonths = range.visibleMonths || 0;
		const firstVisibleMonthIndex = range.firstVisibleMonthIndex || 0;

		if (!visibleMonths) return { dividers, labels };

		const segments = visibleMonths;

		// For year mode: collect boundary positions then place labels at midpoints
		const yearBoundaryPositions = [];

		for (let i = 0; i <= segments; i++) {
			const boundaryIndex = firstVisibleMonthIndex + i;

			const base = startDate.getMonth() + boundaryIndex;
			const year =
				startDate.getFullYear() + Math.floor(base / 12);
			const month = base % 12; // 0 = Jan ... 11 = Dec

			const pos = segments > 0 ? (i / segments) * 100 : 0;
			const boundaryDate = new Date(year, month, 1);

			// A year boundary is *only* a January 1st that lies inside the data window
			const isYearBoundary =
				month === 0 &&
				boundaryDate >= startDate &&
				boundaryDate <= currentDate;

			if (range.isYearMode) {
				if (!isYearBoundary) continue;

				dividers.push(
					<div
						key={`year-boundary-${year}`}
						className="divider divider-year"
						style={{ left: `${pos}%`, height: "100%", top: 0 }}
					/>
				);

				yearBoundaryPositions.push({ year, pos });
			} else {
				dividers.push(
					<div
						key={`month-boundary-${year}-${month + 1}`}
						className={
							isYearBoundary
								? "divider divider-year"
								: "divider divider-month"
						}
						style={{ left: `${pos}%`, height: "100%", top: 0 }}
					/>
				);

				if (isYearBoundary && i < segments) {
					labels.push(
						<div
							key={`year-label-${year}`}
							className="year-label"
							style={{ left: `${pos}%` }}
						>
							{String(year - 1).slice(-2)}/{String(year).slice(-2)}
						</div>
					);
				}
			}
		}

		if (range.isYearMode && yearBoundaryPositions.length > 0) {
			// First partial year (e.g. Jun-Dec 2020): band is 0% to first boundary
			const first = yearBoundaryPositions[0];
			if (first.pos > 0) {
				labels.push(
					<div
						key={`year-label-${first.year - 1}`}
						className="year-label"
						style={{ left: `${first.pos / 2}%` }}
					>
						{first.year - 1}
					</div>
				);
			}

			for (let j = 0; j < yearBoundaryPositions.length - 1; j++) {
				const midPos = (yearBoundaryPositions[j].pos + yearBoundaryPositions[j + 1].pos) / 2;
				labels.push(
					<div
						key={`year-label-${yearBoundaryPositions[j].year}`}
						className="year-label"
						style={{ left: `${midPos}%` }}
					>
						{yearBoundaryPositions[j].year}
					</div>
				);
			}

			// Last partial year (e.g. Jan-Mar 2026): band is last boundary to 100%
			const last = yearBoundaryPositions[yearBoundaryPositions.length - 1];
			if (last.pos < 100) {
				const midPos = (last.pos + 100) / 2;
				labels.push(
					<div
						key={`year-label-${last.year}`}
						className="year-label"
						style={{ left: `${midPos}%` }}
					>
						{last.year}
					</div>
				);
			}
		}

		return { dividers, labels };
	}, [calculateVisibleRange, currentDate, startDate]);



  const { dividers, labels } = useMemo(() => generateDividers(), [generateDividers]);
  const dateRangeDisplay = formatDateRangeDisplay();

  return (
    <>
      <div className={`time-window-slider-container ${isDayViewMode ? "day-view" : isWeekMode ? "week-view" : ""} ${vertical ? "vertical" : ""} ${vertical && isHeatmap ? "heatmap-mode" : ""}`}>
        {vertical && <span className="vertical-letter-label">T</span>}
        {vertical && (
          <div className="timeline-zoom-buttons" aria-label="Timeline zoom controls">
            <button
              type="button"
              className="timeline-zoom-button"
              onClick={() => handleZoomButtonClick("in")}
              aria-label="Zoom timeline in"
            >
              +
            </button>
            <button
              type="button"
              className="timeline-zoom-button"
              onClick={() => handleZoomButtonClick("out")}
              aria-label="Zoom timeline out"
            >
              -
            </button>
          </div>
        )}
        <div className="timeline-slider" ref={sliderRef}>
          <div
            className={`timeline-track ${colorOwner === 'magnitude' ? 'gray' : isHeatmap ? 'heatmap-neutral' : mapType === 'satellite' ? 'satellite-colored' : 'colored'}`}
            ref={trackRef}
            style={{ cursor: "grab" }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {dividers}
          </div>

          <div className={(isDayViewMode || isWeekMode) ? "day-labels" : "year-labels"}>
            {labels}
          </div>

        </div>

        {!vertical && <div className="selected-date">{dateRangeDisplay}</div>}
        <div className="zoom-indicator">
          {isDayViewMode ? zoomText.day : isWeekMode ? zoomText.week : isYearMode ? zoomText.year : zoomText.month}
          {` (${zoomText.hint})`}
        </div>
      </div>
      {vertical && <div className="selected-date selected-date-below">{dateRangeDisplay}</div>}
    </>
  );
};

export default TimeWindowSlider;
