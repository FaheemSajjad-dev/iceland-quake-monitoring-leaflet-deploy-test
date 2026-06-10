import { useState, useEffect, useRef } from "react";
import './MagnitudeScale.css';

const MagnitudeScale = ({ minMagnitude, maxMagnitude, onMagnitudeFilterChange, colorOwner, isHeatmap }) => {

  const [filterValue, setFilterValue] = useState(minMagnitude);
  const debounceRef = useRef(null);
  const clampMagnitude = (value) => Math.min(Math.max(value, minMagnitude), maxMagnitude);
  const roundMagnitude = (value) => Math.round(value * 10) / 10;

  // Clamp filterValue if maxMagnitude shrinks (e.g. time window change), so indicator stays on-screen
  useEffect(() => {
    setFilterValue(prev => clampMagnitude(prev));
  }, [minMagnitude, maxMagnitude]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    const invertedValue = clampMagnitude(maxMagnitude - (value - minMagnitude));
    setFilterValue(invertedValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (onMagnitudeFilterChange) onMagnitudeFilterChange(roundMagnitude(invertedValue));
    }, 150);
  };

  const sliderDisplayValue = maxMagnitude - (filterValue - minMagnitude);

  const getFilterBoxPosition = () => {
    const range = maxMagnitude - minMagnitude;
    if (range <= 0) return 100;
    const valueRatio = (filterValue - minMagnitude) / range;
    const thumbRadius = 8;   // half of 16px thumb
    const trackLength = 200; // slider width in px
    const px = thumbRadius + (1 - valueRatio) * (trackLength - 2 * thumbRadius);
    return (px / trackLength) * 100;
  };

  const barClass = colorOwner === 'magnitude' ? 'scale-bar-colored' : 'scale-bar-gray';

  return (
    <div className={`magnitude-scale vertical${isHeatmap ? ' heatmap-mode' : ''}`}>
      <span className="scale-letter-label">M</span>
      <span className="max-value">{maxMagnitude.toFixed(1)}</span>

      <div className="scale-container">
        <div className={`scale-bar-vertical ${barClass}`}></div>

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
              width: "200px",
              height: "10px",
              transform: "translate(-48.5%, -50%) rotate(90deg)",
              margin: 0,
              padding: 0
            }}
          />
        </div>

        <div
          className="current-filter"
          style={{
            position: "absolute",
            left: "95%",
            top: `${getFilterBoxPosition()}%`,
            transform: "translateX(-50%) translateY(-55%)"
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
