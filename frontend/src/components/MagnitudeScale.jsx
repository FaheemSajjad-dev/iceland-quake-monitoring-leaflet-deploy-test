import { useState, useEffect, useRef, useCallback } from "react";
import './MagnitudeScale.css';

const MagnitudeScale = ({ minMagnitude, maxMagnitude, onMagnitudeFilterChange, colorOwner, isHeatmap, vertical = true }) => {

  const [filterValue, setFilterValue] = useState(minMagnitude);
  const debounceRef = useRef(null);
  const clampMagnitude = useCallback(
    (value) => Math.min(Math.max(value, minMagnitude), maxMagnitude),
    [minMagnitude, maxMagnitude]
  );
  const roundMagnitude = (value) => Math.round(value * 10) / 10;

  // Clamp filterValue if maxMagnitude shrinks (e.g. time window change), so indicator stays on-screen
  useEffect(() => {
    setFilterValue(prev => clampMagnitude(prev));
  }, [clampMagnitude, minMagnitude, maxMagnitude]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    const nextValue = vertical ? clampMagnitude(maxMagnitude - (value - minMagnitude)) : clampMagnitude(value);
    setFilterValue(nextValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (onMagnitudeFilterChange) onMagnitudeFilterChange(roundMagnitude(nextValue));
    }, 150);
  };

  const sliderDisplayValue = vertical ? maxMagnitude - (filterValue - minMagnitude) : filterValue;

  const getFilterBoxPosition = () => {
    const range = maxMagnitude - minMagnitude;
    if (range <= 0) return 100;
    const valueRatio = (filterValue - minMagnitude) / range;
    const thumbRadius = 8;   // half of 16px thumb
    const trackLength = 200; // slider width in px
    const px = thumbRadius + (vertical ? 1 - valueRatio : valueRatio) * (trackLength - 2 * thumbRadius);
    return (px / trackLength) * 100;
  };

  const getMagnitudeTickPosition = (value) => {
    const range = maxMagnitude - minMagnitude;
    if (range <= 0) return 100;
    return Math.max(0, Math.min(100, ((maxMagnitude - value) / range) * 100));
  };

  const barClass = colorOwner === 'magnitude' ? 'scale-bar-colored' : 'scale-bar-gray';

  return (
    <div className={`magnitude-scale ${vertical ? 'vertical' : 'horizontal'}${isHeatmap ? ' heatmap-mode' : ''}`}>
      <span className="scale-letter-label">M</span>
      <span className="max-value">{maxMagnitude.toFixed(1)}</span>

      <div className="scale-container">
        <div className={`scale-bar-vertical ${barClass}`}></div>
        {[5.0, 4.0].map((tick) => (
          tick > minMagnitude && tick < maxMagnitude ? (
            <span
              key={tick}
              className="magnitude-tick-label"
              style={{ top: `${getMagnitudeTickPosition(tick)}%` }}
            >
              {tick.toFixed(1)}
            </span>
          ) : null
        ))}

        <div className="slider-container" style={{ position: "absolute", width: "100%", height: "100%" }}>
          <input
            type="range"
            min={minMagnitude}
            max={maxMagnitude}
            step={0.01}
            value={sliderDisplayValue}
            onChange={handleSliderChange}
            className="magnitude-slider"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: vertical ? "200px" : "100%",
              height: "10px",
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

      <span className="min-value">{minMagnitude.toFixed(1)}</span>
    </div>
  );
};

export default MagnitudeScale;
