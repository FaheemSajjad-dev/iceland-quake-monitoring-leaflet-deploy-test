import { useState, useEffect, useRef, useCallback } from "react";
import './MagnitudeScale.css';

const MagnitudeScale = ({ minMagnitude, maxMagnitude, onMagnitudeFilterChange, colorOwner, isHeatmap, vertical = true }) => {

  const [filterValue, setFilterValue] = useState(minMagnitude);
  const [trackLength, setTrackLength] = useState(200);
  const scaleContainerRef = useRef(null);
  const clampMagnitude = useCallback(
    (value) => Math.min(Math.max(value, minMagnitude), maxMagnitude),
    [minMagnitude, maxMagnitude]
  );
  const roundMagnitude = (value) => Math.round(value * 10) / 10;

  // Clamp filterValue if maxMagnitude shrinks (e.g. time window change), so indicator stays on-screen
  useEffect(() => {
    setFilterValue(prev => clampMagnitude(prev));
  }, [clampMagnitude, minMagnitude, maxMagnitude]);

  useEffect(() => {
    const element = scaleContainerRef.current;
    if (!element) return undefined;

    const updateTrackLength = () => {
      const rect = element.getBoundingClientRect();
      const nextLength = vertical ? rect.height : rect.width;
      if (Number.isFinite(nextLength) && nextLength > 0) {
        setTrackLength(nextLength);
      }
    };

    updateTrackLength();
    const observer = new ResizeObserver(updateTrackLength);
    observer.observe(element);
    return () => observer.disconnect();
  }, [vertical]);


  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    const nextValue = vertical ? clampMagnitude(maxMagnitude - (value - minMagnitude)) : clampMagnitude(value);
    setFilterValue(nextValue);
    if (onMagnitudeFilterChange) onMagnitudeFilterChange(roundMagnitude(nextValue));
  };

  const sliderDisplayValue = vertical ? maxMagnitude - (filterValue - minMagnitude) : filterValue;

  const getFilterBoxPosition = () => {
    const range = maxMagnitude - minMagnitude;
    if (range <= 0) return 100;
    const valueRatio = (filterValue - minMagnitude) / range;
    const thumbRadius = vertical ? 10 : 8;
    const length = Math.max(trackLength, thumbRadius * 2);
    const px = thumbRadius + (vertical ? 1 - valueRatio : valueRatio) * (length - 2 * thumbRadius);
    return (px / length) * 100;
  };

  const getMagnitudeTickPosition = (value) => {
    const range = maxMagnitude - minMagnitude;
    if (range <= 0) return 100;
    const valueRatio = (value - minMagnitude) / range;
    const thumbRadius = vertical ? 10 : 8;
    const length = Math.max(trackLength, thumbRadius * 2);
    const px = thumbRadius + (vertical ? 1 - valueRatio : valueRatio) * (length - 2 * thumbRadius);
    return (px / length) * 100;
  };

  const barClass = colorOwner === 'magnitude' ? 'scale-bar-colored' : 'scale-bar-gray';
  const magnitudeLabels = vertical
    ? [maxMagnitude, 5.0, 4.0, minMagnitude].filter((value, index, values) => (
        value >= minMagnitude && value <= maxMagnitude && values.indexOf(value) === index
      ))
    : [];

  return (
    <div className={`magnitude-scale ${vertical ? 'vertical' : 'horizontal'}${isHeatmap ? ' heatmap-mode' : ''}`}>
      <span className="scale-letter-label">M</span>
      {!vertical && <span className="max-value">{maxMagnitude.toFixed(1)}</span>}

      <div className="scale-container" ref={scaleContainerRef}>
        <div className={`scale-bar-vertical ${barClass}`}></div>
        {magnitudeLabels.map((tick) => (
          <span
            key={tick}
            className={`magnitude-tick-label${tick === minMagnitude || tick === maxMagnitude ? ' magnitude-limit-label' : ''}`}
            style={{ top: `${getMagnitudeTickPosition(tick)}%` }}
          >
            {tick.toFixed(1)}
          </span>
        ))}
        <div className="slider-container" style={{ position: "absolute", width: "100%", height: "100%" }}>
          <input
            type="range"
            min={minMagnitude}
            max={maxMagnitude}
            step={0.01}
            value={sliderDisplayValue}
            onChange={handleSliderChange}
            onInput={handleSliderChange}
            className="magnitude-slider"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: vertical ? `${trackLength}px` : "100%",
              height: "10px",
              "--magnitude-slider-length": vertical ? `${trackLength}px` : undefined,
              transform: vertical ? "translate(-50%, -50%) rotate(90deg)" : "translate(-50%, -50%)",
              margin: 0,
              padding: 0
            }}
          />
        </div>

        <div
          className="current-filter"
          style={{
            position: "absolute",
            left: vertical ? "95%" : `${getFilterBoxPosition()}%`,
            top: vertical ? `${getFilterBoxPosition()}%` : "26px",
            transform: vertical ? "translateX(-50%) translateY(-55%)" : "translateX(-50%)"
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1 }}>
            <span>↑</span>
            <span>{roundMagnitude(filterValue).toFixed(1)}</span>
          </span>
        </div>
      </div>

      {!vertical && <span className="min-value">{minMagnitude.toFixed(1)}</span>}
    </div>
  );
};

export default MagnitudeScale;
