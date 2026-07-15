import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import "./About.css";
import "./RecentSelections.css";

const formatNumber = (value, digits) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "N/A";
};

const RecentSelections = ({ earthquakes, onClose, onClear, onView }) => {
  const t = useT();
  const closeButtonRef = useRef(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="about-overlay recent-overlay" role="dialog" aria-modal="true" aria-labelledby="recent-title" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="about-content card recent-content">
        <header className="about-header">
          <div>
            <p className="about-kicker">Earthquake history</p>
            <h2 className="about-title" id="recent-title">Recent selections</h2>
          </div>
          <button ref={closeButtonRef} className="close-button" aria-label="Close Recent selections" onClick={onClose}>x</button>
        </header>

        <div className="about-body recent-body">
          {earthquakes.length === 0 ? (
            <p className="recent-empty">Select an earthquake marker to add it to this history.</p>
          ) : (
            <div className="recent-table-wrap">
              <table className="recent-table">
                <thead>
                  <tr>
                    <th>Magnitude</th>
                    <th>Date and time</th>
                    <th>{t("info_depth")}</th>
                    <th>Coordinates</th>
                    <th><span className="sr-only">View on map</span></th>
                  </tr>
                </thead>
                <tbody>
                  {earthquakes.map(quake => {
                    const key = `${quake["Date-time"] ?? ""}|${quake.Latitude ?? ""}|${quake.Longitude ?? ""}`;
                    return (
                      <tr key={key}>
                        <td className="recent-magnitude">M {formatNumber(quake.Mw_mean, 1)}</td>
                        <td>{quake["Date-time"] ?? "N/A"}</td>
                        <td>{formatNumber(quake.Depth, 1)} km</td>
                        <td>{formatNumber(quake.Latitude, 4)}, {formatNumber(quake.Longitude, 4)}</td>
                        <td><button className="recent-view-button" onClick={() => onView(quake)}>View on map</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="about-footer recent-footer">
          <span>{earthquakes.length}/10 selections</span>
          <button className="recent-clear-button" onClick={onClear} disabled={earthquakes.length === 0}>Clear history</button>
        </footer>
      </div>
    </div>
  );
};

export default RecentSelections;
