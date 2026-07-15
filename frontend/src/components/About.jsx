import { useEffect, useRef } from "react";
import "./About.css";
import { API_URL } from "../api";
import { useLang, useT } from "../i18n";

const VERSION = "1.3";

const DATA_CADENCE = {
  en: [
    ["Earthquakes", "MPGV and the IMO Quakes API are checked by the backend every 3 minutes, then reconciled into the merged catalogue."],
    ["Volcanoes", "IMO EPOS volcano metadata is refreshed by the backend scheduler and reloaded by the map every 3 minutes."],
    ["Faults", "EGDI/HIKE WFS fault and fissure linework is loaded on first use and cached for later toggles."],
    ["ShakeMaps", "IMO EPOS ShakeMaps are checked on demand when an earthquake is selected, avoiding heavy bulk requests on every refresh."],
  ],
  is: [
    ["Jarðskjálftar", "MPGV og IMO Quakes API eru athuguð í bakenda á 3 mínútna fresti og samræmd í sameinaðan grunn."],
    ["Eldfjöll", "IMO EPOS eldfjallagögn eru uppfærð í bakenda og endurhlaðið í kortið á 3 mínútna fresti."],
    ["Misgengi", "EGDI/HIKE WFS línum fyrir misgengi og sprungur er hlaðið við fyrstu notkun og þær geymdar fyrir síðari birtingu."],
    ["ShakeMaps", "IMO EPOS ShakeMaps eru athuguð eftir þörfum þegar jarðskjálfti er valinn, til að forðast þungar fjöldafyrirspurnir."],
  ],
};

const MAP_LAYERS = {
  en: [
    ["Map", "OpenFreeMap vector basemap with Iceland glacier labels."],
    ["Satellite", "Esri World Imagery for visual terrain context."],
    ["Terrain", "Icelandic Meteorological Office raster terrain tiles."],
    ["Heatmap", "MapLibre density heatmap on a dark OpenFreeMap basemap; individual marker selection is intentionally unavailable."],
    ["Attribution", "Compact bottom-right map credits show the active basemap providers and EGDI/HIKE when faults are visible."],
  ],
  is: [
    ["Kort", "OpenFreeMap vektorkort með íslenskum jöklaheitum."],
    ["Gervihnöttur", "Esri World Imagery fyrir myndrænt landslagssamhengi."],
    ["Landslag", "Raster landslagsflísar frá Veðurstofu Íslands."],
    ["Hitakort", "MapLibre þéttleikakort á dökku OpenFreeMap grunnkorti; val á einstökum merkjum er ekki í boði."],
    ["Heimildir", "Stutt heimildalína neðst til hægri sýnir virkar grunnkortsveitur og EGDI/HIKE þegar misgengi eru sýnileg."],
  ],
};

const SOURCES = {
  en: [
    ["MPGV", "Historical and near-real-time M >= 3.0 earthquake listings from hraun.vedur.is/ja/Mpgv/."],
    ["IMO Quakes API", "Recent event metadata from api.vedur.is/quakes/events used to improve location, depth, and event identity."],
    ["EPOS", "Volcano catalogue and ShakeMap information from api.vedur.is/epos."],
    ["EGDI/HIKE", "Fault and fissure WFS linework from maps.europe-geology.eu, filtered to Iceland onshore records."],
  ],
  is: [
    ["MPGV", "Sögulegar og rauntímaskráningar M >= 3.0 jarðskjálfta frá hraun.vedur.is/ja/Mpgv/."],
    ["IMO Quakes API", "Nýleg atburðagögn frá api.vedur.is/quakes/events sem bæta staðsetningu, dýpt og auðkenni."],
    ["EPOS", "Eldfjallaskrá og ShakeMap upplýsingar frá api.vedur.is/epos."],
    ["EGDI/HIKE", "WFS-gögn frá maps.europe-geology.eu fyrir misgengi og sprungur."],
  ],
};

const Copy = ({ lang }) => lang === "en" ? (
  <>
    <p>
      This application is part of an MSc thesis at the University of Iceland. It
      monitors Icelandic earthquakes from June 2020 onward, focusing on events
      with <strong>M {">="} 3.0</strong>, and presents them in an interactive
      MapLibre-based interface for exploration, comparison, and export.
    </p>
    <p>
      The backend keeps a merged earthquake catalogue by scraping MPGV records,
      fetching recent IMO Quakes API data, and reconciling matching events by
      time, location, and magnitude. The frontend then layers that catalogue with live
      volcano metadata, ShakeMap links, coordinate grids, and filtered EGDI/HIKE
      fault and fissure geometry.
    </p>
    <p>
      Roadmap, Satellite, and Terrain views provide selectable earthquake markers,
      information cards, timeline or magnitude colouring, time and magnitude filters,
      and a ten-item Recent Selections history. Volcanoes, faults, and the latitude/
      longitude grid can be shown as overlays. The responsive controls support both
      desktop and mobile layouts.
    </p>
  </>
) : (
  <>
    <p>
      Þetta forrit er hluti af meistaraverkefni við Háskóla Íslands. Það
      fylgist með íslenskum jarðskjálftum frá júní 2020, með áherslu á atburði
      með <strong>M {">="} 3.0</strong>, og sýnir þá í gagnvirku MapLibre-viðmóti.
    </p>
    <p>
      Bakendinn heldur utan um sameinaðan jarðskjálftagrunn með því að lesa
      MPGV-skrá, sækja nýleg IMO Quakes API gögn og samræma atburði eftir tíma,
      staðsetningu og stærð. Framendinn bætir við eldfjallagögnum, ShakeMap
      tenglum, hnitaneti og EGDI/HIKE línum fyrir misgengi og sprungur.
    </p>
    <p>
      Kort-, gervihnatta- og landslagssýnir hafa valanleg jarðskjálftamerki,
      upplýsingaspjöld, tíma- eða stærðarlitun, tíma- og stærðarsíur og lista yfir
      tíu nýlegustu val. Viðmótið styður bæði skjáborð og farsíma.
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
            <p className="about-kicker">{lang === "en" ? "Research map" : "Rannsóknarkort"}</p>
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
            <h3>{lang === "en" ? "Data Sources" : "Uppruni gagna"}</h3>
            <InfoGrid items={SOURCES[lang]} />
          </section>

          <section className="about-section">
            <h3>{lang === "en" ? "Update Cadence" : "Uppfærslutíðni"}</h3>
            <InfoGrid items={DATA_CADENCE[lang]} />
          </section>

          <section className="about-section">
            <h3>{lang === "en" ? "Map Layers" : "Kortalög"}</h3>
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
                <span className="contact-name">Kristján Jónasson</span>
                <a className="contact-email" href="mailto:jonasson@hi.is">jonasson@hi.is</a>
              </li>
              <li>
                <span className="contact-name">Esa Olavi Hyytiä</span>
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
