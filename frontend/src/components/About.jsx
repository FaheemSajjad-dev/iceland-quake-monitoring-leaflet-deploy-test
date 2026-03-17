import { useEffect, useRef } from "react";
import "./About.css";
import { API_URL } from "../api";

const VERSION = "1.0";

const About = ({ onClose }) => {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);

  // Close on ESC
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus close button on mount
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Close when clicking the backdrop; keep clicks inside from bubbling out
  const onBackdropClick = (e) => {
    if (e.target === dialogRef.current) onClose();
  };

  return (
    <div
      className="about-overlay fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      aria-describedby="about-desc"
      ref={dialogRef}
      onMouseDown={onBackdropClick}
    >
      <div
        className="about-content card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="about-header">
          <h2 id="about-title" className="about-title">
            Iceland MPGV Earthquake Map
          </h2>
          <button
            ref={closeBtnRef}
            className="close-button"
            aria-label="Close About window"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="about-body" id="about-desc">
          <section className="about-section">
            <h3>Overview</h3>
            <p>
              This web application is part of an MSc thesis at the University
              of Iceland (Háskóli Íslands). It visualizes earthquakes across
              Iceland in near-real time, focusing on events with magnitude{" "}
              <strong>M&nbsp;≥&nbsp;2.7</strong>. The primary source is the
              Icelandic Meteorological Office’s MPGV feed, complemented by
              additional public datasets.
            </p>

            <p>
              The system integrates three main data providers:
              <br />
              • <strong>MPGV data</strong> — public earthquake listings at{" "}
              <a
                href="http://hraun.vedur.is/ja/Mpgv/"
                target="_blank"
                rel="noopener noreferrer"
              >
                hraun.vedur.is/ja/Mpgv/
              </a>
              <br />
              • <strong>Skjálftalísa API</strong> — detailed event metadata via{" "}
              <a
                href="https://api.vedur.is/?urls.primaryName=Skj%C3%A1lftal%C3%ADsa"
                target="_blank"
                rel="noopener noreferrer"
              >
                api.vedur.is (Skjálftalísa)
              </a>
              <br />
              • <strong>EPOS API</strong> — volcanic and shakemap information via{" "}
              <a
                href="https://api.vedur.is/?urls.primaryName=EPOS"
                target="_blank"
                rel="noopener noreferrer"
              >
                api.vedur.is (EPOS)
              </a>
            </p>

            <p>
              The backend continuously reconciles earthquake information from different
              sources using a custom matching algorithm. Each MPGV event is compared
              against Skjálftalísa records based on time, location, and magnitude
              thresholds to identify corresponding events. The merged dataset—combining
              the most accurate attributes from each source—is then served through an
              API to the frontend, where it powers the interactive map and visualization
              features.
            </p>


            <p>
              Key features include an interactive <strong>timeline color mode</strong> that
              displays earthquakes by month and a <strong>magnitude color mode</strong> that
              dynamically shades markers according to their seismic strength. A{" "}
              <strong>time window slider</strong> lets users filter events by day, week,
              month, or year — scroll to zoom the time range, drag to pan it. Users can
              switch between four map layers: roadmap, satellite, dark mode, and a{" "}
              <strong>heatmap layer</strong> for density analysis. A{" "}
              <strong>lat/lon grid overlay</strong> can be toggled on to display
              auto-density coordinate lines that adapt to the current zoom level.
              The system also integrates <strong>ShakeMap data</strong> for visualizing
              ground motion intensity, and <strong>volcano overlays</strong> featuring
              33 Icelandic volcanoes with their current status and detailed information
              retrieved from the <strong>EPOS API</strong>.
            </p>

          </section>

          <section className="about-section">
            <h3>Data export</h3>
            <p>
              You can download the curated earthquake catalogue used in this map
              as a CSV file (all merged events from June 2020 onward, Mw ≥ 2.7).
            </p>
            <button
              type="button"
              className="download-csv-button"
              onClick={() => window.open(`${API_URL}/earthquakes_csv`, "_blank", "noopener,noreferrer")}
            >
              Download CSV
            </button>
          </section>

          <section className="about-section">
            <h3>Contact</h3>
            <p>For feedback, collaboration, or support:</p>
            <ul className="contact-list">
              <li>
                <a href="mailto:mfs7@hi.is">mfs7@hi.is</a>
              </li>
              <li>
                <a href="mailto:jonasson@hi.is">jonasson@hi.is</a>
              </li>
              <li>
                <a href="mailto:esa@hi.is">esa@hi.is</a>
              </li>
            </ul>
          </section>

          <section className="about-section">
            <h3>Credits</h3>
            <ul>
              <li>Muhammad Faheem Sajjad</li>
              <li>Kristján Jónasson</li>
              <li>Esa Olavi Hyytia</li>
            </ul>
          </section>

          <section className="about-section disclaimer">
            <h3>Disclaimer</h3>
            <p>
              Optimized for desktop browsers; mobile support is limited.
            </p>
          </section>
         
        </div>

        <footer className="about-footer">
          <small>
            Version {VERSION} · © {new Date().getFullYear()} University of Iceland
          </small>
        </footer>
      </div>
    </div>
  );
};

export default About;
