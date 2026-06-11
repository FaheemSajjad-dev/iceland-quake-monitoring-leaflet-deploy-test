import { useEffect, useRef } from "react";
import "./About.css";
import { API_URL } from "../api";
import { useLang, useT } from "../i18n";

const VERSION = "1.1";

const DATA_CADENCE = {
  en: [
    ["Earthquakes", "MPGV and Skjalftalisa are checked by the backend every 3 minutes, then reconciled into the merged catalogue."],
    ["Volcanoes", "IMO EPOS volcano metadata is refreshed by the backend scheduler and reloaded by the map every 3 minutes."],
    ["Faults", "EGDI/HIKE WFS fault and fissure linework is checked every 3 minutes while the overlay is visible."],
    ["ShakeMaps", "IMO EPOS ShakeMaps are checked on demand when an earthquake is selected, avoiding heavy bulk requests on every refresh."],
  ],
  is: [
    ["Jardskjalftar", "MPGV og Skjalftalisa eru athugud i bakenda a 3 minutna fresti og samraemd i sameinadan grunn."],
    ["Eldfjoll", "IMO EPOS eldfjallagogn eru uppfaerd i bakenda og endurhladin i kortinu a 3 minutna fresti."],
    ["Misgengi", "EGDI/HIKE WFS linur fyrir misgengi og sprungur eru athugadar a 3 minutna fresti medan yfirlagid er synilegt."],
    ["ShakeMaps", "IMO EPOS ShakeMaps eru athugud eftir thorfum thegar jardskjalfti er valinn, til ad forda thungum fjoldafyrirspurnum."],
  ],
};

const MAP_LAYERS = {
  en: [
    ["Map", "OpenFreeMap vector basemap with Iceland glacier labels."],
    ["Satellite", "Esri World Imagery for visual terrain context."],
    ["Terrain", "Icelandic Meteorological Office raster terrain tiles."],
    ["Gray", "CARTO light basemap for quiet inspection."],
    ["Heatmap", "Density-first earthquake heatmap with label overlay."],
  ],
  is: [
    ["Map", "OpenFreeMap vektorkort med islenskum joklaheitum."],
    ["Gervihnottur", "Esri World Imagery fyrir myndraent landslagssamhengi."],
    ["Landslag", "Raster landslagsflisar fra Vedurstofu Islands."],
    ["Gratt", "Ljost CARTO grunnkort fyrir rolega skodun."],
    ["Hitakort", "Thettleikakort jardskjalfta med merkjayfirlagslagi."],
  ],
};

const SOURCES = {
  en: [
    ["MPGV", "Historical and near-real-time M >= 3.0 earthquake listings from hraun.vedur.is/ja/Mpgv/."],
    ["Skjalftalisa", "Recent event metadata from api.vedur.is/skjalftalisa used to improve location, depth, and event identity."],
    ["EPOS", "Volcano catalogue and ShakeMap information from api.vedur.is/epos."],
    ["EGDI/HIKE", "Fault and fissure WFS linework from maps.europe-geology.eu, filtered to Iceland onshore records."],
  ],
  is: [
    ["MPGV", "Sogulegar og naer rauntima skraningar M >= 3.0 jardskjalfta fra hraun.vedur.is/ja/Mpgv/."],
    ["Skjalftalisa", "Nyleg atburdagogn fra api.vedur.is/skjalftalisa sem baeta stadsetningu, dypt og audkenni."],
    ["EPOS", "Eldfjallaskra og ShakeMap upplysingar fra api.vedur.is/epos."],
    ["EGDI/HIKE", "WFS linugogn fra maps.europe-geology.eu fyrir misgengi og sprungur, siud i islenskar landfaerslur."],
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

          <section className="about-section">
            <h3>{t("about_contact")}</h3>
            <p>{t("about_contact_desc")}</p>
            <ul className="contact-list">
              <li>
                <span className="contact-name">Muhammad Faheem Sajjad</span>
                <a className="contact-email" href="mailto:mfs7@hi.is">mfs7@hi.is</a>
              </li>
              <li>
                <span className="contact-name">Kristjan Jonasson</span>
                <a className="contact-email" href="mailto:jonasson@hi.is">jonasson@hi.is</a>
              </li>
              <li>
                <span className="contact-name">Esa Olavi Hyytia</span>
                <a className="contact-email" href="mailto:esa@hi.is">esa@hi.is</a>
              </li>
            </ul>
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
