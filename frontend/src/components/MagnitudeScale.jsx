import { useState, useEffect, useRef } from "react";
import './MagnitudeScale.css';

const MagnitudeScale = ({ minMagnitude, maxMagnitude, onMagnitudeFilterChange, colorOwner }) => {

  const [filterValue, setFilterValue] = useState(minMagnitude);
  const debounceRef = useRef(null);

  // Clamp filterValue if maxMagnitude shrinks (e.g. time window change), so indicator stays on-screen
  useEffect(() => {
    setFilterValue(prev => Math.min(prev, maxMagnitude));
  }, [maxMagnitude]);

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    const invertedValue = maxMagnitude - (value - minMagnitude);
    setFilterValue(invertedValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (onMagnitudeFilterChange) onMagnitudeFilterChange(invertedValue);
    }, 150);
  };

  const sliderDisplayValue = maxMagnitude - (filterValue - minMagnitude);

  const getFilterBoxPosition = () => {
    const range = maxMagnitude - minMagnitude;
    const valueRatio = (filterValue - minMagnitude) / range;
    return (1 - valueRatio) * 100;
  };

  const barClass = colorOwner === 'magnitude' ? 'scale-bar-colored' : 'scale-bar-gray';

  return (
    <div className="magnitude-scale vertical">
      <span className="max-value">{maxMagnitude.toFixed(1)}</span>

      <div className="scale-container">
        <div className={`scale-bar-vertical ${barClass}`}></div>

        <div className="slider-container" style={{ position: "absolute", width: "100%", height: "100%" }}>
          <input
            type="range"
            min={minMagnitude}
            max={maxMagnitude}
            step={0.1}
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
            right: "50px",
            top: `${getFilterBoxPosition()}%`,
            transform: "translateY(-50%)"
          }}
        >
          <span>{filterValue.toFixed(1)}+</span>
        </div>
      </div>

      <span className="min-value">{minMagnitude.toFixed(1)}</span>
    </div>
  );
};

export default MagnitudeScale;
