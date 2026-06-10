import { useEffect, useRef } from "react";
import "./About.css";
import { API_URL } from "../api";
import { useLang, useT } from "../i18n";

const VERSION = "1.1";

const DATA_CADENCE = {
  en: [
    ["Earthquakes", "MPGV, Skjalftalisa, and the merged catalogue refresh every 3 minutes."],
    ["Volcanoes", "EPOS volcano metadata is refreshed by the backend scheduler and reloaded by the map every 3 minutes."],
    ["Faults", "EGDI/HIKE WFS fault and fissure linework refreshes while the overlay is visible."],
    ["ShakeMaps", "ShakeMap links are looked up on demand for selected earthquake events."],
  ],
  is: [
    ["Jardskjalftar", "MPGV, Skjalftalisa og sameinadi gagnagrunnurinn uppfaerast a 3 minutna fresti."],
    ["Eldfjoll", "EPOS eldfjallagogn eru uppfaerd i bakenda og endurhladin i kortinu a 3 minutna fresti."],
    ["Misgengi", "EGDI/HIKE WFS linur fyrir misgengi og sprungur endurhladast medan yfirlagid er synilegt."],
    ["ShakeMaps", "ShakeMap tenglar eru sottir eftir thorfum fyrir valda jardskjalfta."],
  ],
};

const MAP_LAYERS = {
  en: [
    ["Positron", "OpenFreeMap vector basemap with Iceland glacier labels."],
    ["Satellite", "Esri World Imagery for visual terrain context."],
    ["Terrain", "Icelandic Meteorological Office raster terrain tiles."],
    ["Gray", "CARTO light basemap for quiet inspection."],
    ["Heatmap", "Density-first earthquake heatmap with label overlay."],
  ],
  is: [
    ["Positron", "OpenFreeMap vektorkort med islenskum joklaheitum."],
    ["Gervihnottur", "Esri World Imagery fyrir myndraent landslagssamhengi."],
    ["Landslag", "Raster landslagsflisar fra Vedurstofu Islands."],
    ["Gratt", "Ljost CARTO grunnkort fyrir rolega skodun."],
    ["Hitakort", "Thettleikakort jardskjalfta med merkjayfirlagslagi."],
  ],
};

const SOURCES = {
  en: [
    ["MPGV", "Historical and near-real-time M >= 3.0 earthquake listings from IMO."],
    ["Skjalftalisa", "Recent IMO event metadata used to improve location, depth, and event identity."],
    ["EPOS", "Volcano catalogue and ShakeMap information from IMO EPOS services."],
    ["EGDI/HIKE", "Fault and fissure linework filtered to Iceland onshore records."],
  ],
  is: [
    ["MPGV", "Sogulegar og naer rauntima skraningar M >= 3.0 jardskjalfta fra Vedurstofu Islands."],
    ["Skjalftalisa", "Nyleg atburdagogn fra Vedurstofu sem baeta stadsetningu, dypt og audkenni."],
    ["EPOS", "Eldfjallaskra og ShakeMap upplysingar fra EPOS thjonustum Vedurstofu."],
    ["EGDI/HIKE", "Linugogn fyrir misgengi og sprungur, siud i islenskar landfaerslur."],
  ],
};

const Copy = ({ lang }) => lang === "en" ? (
  <>
    <p>
      This application is part of an MSc thesis at the University of Iceland. It
      monitors Icelandic earthquakes from June 2020 onward, focusing on events
      with <strong>M {">="} 3.0</strong>, and presents them on an interactive Leaflet
      map for exploration, comparison, and export.
    </p>
    <p>
      The backend keeps a merged earthquake catalogue by scraping MPGV records,
      fetching recent Skjalftalisa data, and reconciling matching events by time,
      location, and magnitude. The frontend then layers that catalogue with live
      volcano metadata, ShakeMap links, coordinate grids, and filtered EGDI/HIKE
      fault and fissure geometry.
    </p>
  </>
) : (
  <>
    <p>
      Thetta forrit er hluti af meistaraverkefni vid Haskola Islands. Thad
      fylgist med islenskum jardskjalftum fra juni 2020, med aherslu a atburdi
      med <strong>M {">="} 3.0</strong>, og synir tha a gagnvirku Leaflet-korti.
    </p>
    <p>
      Bakendinn heldur utan um sameinadan jardskjalftagrunn med thvi ad lesa
      MPGV-skra, saekja nyleg Skjalftalisa-gogn og samraema atburdi eftir tima,
      stadsetningu og staerd. Framendinn baetir vid eldfjallagogn, ShakeMap
      tenglum, hnitaneti og EGDI/HIKE linum fyrir misgengi og sprungur.
    </p>
  </>
);

const InfoGrid = ({ items }) => (
  <div className="about-info-grid">
    {items.map(([title, text]) => (
      <article className="about-info-item" key={title}>
        <h4>{title}</h4>
        <p>{text}</p>
      </article>
    ))}
  </div>
);

const About = ({ onClose }) => {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const { lang } = useLang();
  const t = useT();

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { closeBtnRef.current?.focus(); }, []);

  const onBackdropClick = (e) => { if (e.target === dialogRef.current) onClose(); };

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
      <div className="about-content card" onMouseDown={(e) => e.stopPropagation()}>
        <header className="about-header">
          <div>
            <p className="about-kicker">{lang === "en" ? "Research map" : "Rannsoknarkort"}</p>
            <h2 id="about-title" className="about-title">{t("about_title")}</h2>
          </div>
          <button ref={closeBtnRef} className="close-button" aria-label={t("about_close")} onClick={onClose}>x</button>
        </header>

        <div className="about-body" id="about-desc">
          <section className="about-section">
            <h3>{t("about_overview")}</h3>
            <Copy lang={lang} />
          </section>

          <section className="about-section">
            <h3>{lang === "en" ? "Data Sources" : "Gagnauppsprettur"}</h3>
            <InfoGrid items={SOURCES[lang]} />
          </section>

          <section className="about-section">
            <h3>{lang === "en" ? "Update Cadence" : "Uppfaerslutidni"}</h3>
            <InfoGrid items={DATA_CADENCE[lang]} />
          </section>

          <section className="about-section">
            <h3>{lang === "en" ? "Map Layers" : "Kortalog"}</h3>
            <InfoGrid items={MAP_LAYERS[lang]} />
          </section>

          <section className="about-section">
            <h3>{t("about_data_export")}</h3>
            <p>{t("about_data_export_desc")}</p>
            <button
              type="button"
              className="download-csv-button"
              onClick={() => window.open(`${API_URL}/earthquakes_csv`, "_blank", "noopener,noreferrer")}
            >
              {t("about_download_csv")}
            </button>
          </section>

          <section className="about-section about-two-column">
            <div>
              <h3>{t("about_contact")}</h3>
              <p>{t("about_contact_desc")}</p>
              <ul className="contact-list">
                <li><a href="mailto:mfs7@hi.is">mfs7@hi.is</a></li>
                <li><a href="mailto:jonasson@hi.is">jonasson@hi.is</a></li>
                <li><a href="mailto:esa@hi.is">esa@hi.is</a></li>
              </ul>
            </div>
            <div>
              <h3>{t("about_credits")}</h3>
              <ul>
                <li>Muhammad Faheem Sajjad</li>
                <li>Kristjan Jonasson</li>
                <li>Esa Olavi Hyytia</li>
              </ul>
            </div>
          </section>

          <section className="about-section disclaimer">
            <h3>{t("about_disclaimer")}</h3>
            <p>{t("about_disclaimer_desc")}</p>
          </section>
        </div>

        <footer className="about-footer">
          <small>{t("about_version")} {VERSION} | (c) {new Date().getFullYear()} {t("about_university")}</small>
        </footer>
      </div>
    </div>
  );
};

export default About;
