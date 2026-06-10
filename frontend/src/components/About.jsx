import { useEffect, useRef } from "react";
import "./About.css";
import { API_URL } from "../api";
import { useLang, useT } from "../i18n";

const VERSION = "1.0";

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
          <h2 id="about-title" className="about-title">
            {t('about_title')}
          </h2>
          <button
            ref={closeBtnRef}
            className="close-button"
            aria-label={t('about_close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="about-body" id="about-desc">
          <section className="about-section">
            <h3>{t('about_overview')}</h3>

            {lang === 'en' ? (
              <>
                <p>
                  This web application is part of an MSc thesis at the University
                  of Iceland (Háskóli Íslands). It visualizes earthquakes across
                  Iceland in near-real time, focusing on events with magnitude{" "}
                  <strong>M&nbsp;≥&nbsp;3.0</strong>. The primary source is the
                  Icelandic Meteorological Office's MPGV feed, complemented by
                  additional public datasets.
                </p>
                <p>
                  The system integrates three main data providers:
                  <br />
                  • <strong>MPGV data</strong> — public earthquake listings at{" "}
                  <a href="http://hraun.vedur.is/ja/Mpgv/" target="_blank" rel="noopener noreferrer">
                    hraun.vedur.is/ja/Mpgv/
                  </a>
                  <br />
                  • <strong>Skjálftalísa API</strong> — detailed event metadata via{" "}
                  <a href="https://api.vedur.is/?urls.primaryName=Skj%C3%A1lftal%C3%ADsa" target="_blank" rel="noopener noreferrer">
                    api.vedur.is (Skjálftalísa)
                  </a>
                  <br />
                  • <strong>EPOS API</strong> — volcanic and shakemap information via{" "}
                  <a href="https://api.vedur.is/?urls.primaryName=EPOS" target="_blank" rel="noopener noreferrer">
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
                  switch between map layers: roadmap, satellite, dark mode, and a{" "}
                  <strong>heatmap layer</strong> for density analysis. A{" "}
                  <strong>lat/lon grid overlay</strong> can be toggled on to display
                  auto-density coordinate lines that adapt to the current zoom level.
                  The system also integrates <strong>ShakeMap data</strong> for visualizing
                  ground motion intensity, and <strong>volcano overlays</strong> featuring
                  33 Icelandic volcanoes with their current status and detailed information
                  retrieved from the <strong>EPOS API</strong>.
                </p>
              </>
            ) : (
              <>
                <p>
                  Þetta vefforrit er hluti af meistararannsókn við Háskóla Íslands.
                  Það sýnir jarðskjálfta um allt Ísland í nær rauntíma, með áherslu
                  á atburði með stærð <strong>M&nbsp;≥&nbsp;3.0</strong>. Megingagnaveitan
                  er MPGV-straumurinn frá Veðurstofu Íslands, ásamt opinberum viðbótargagnasöfnum.
                </p>
                <p>
                  Kerfið sameinar þrjár meginuppruna gagna:
                  <br />
                  • <strong>MPGV-gögn</strong> — opinberar jarðskjálftaskrár á{" "}
                  <a href="http://hraun.vedur.is/ja/Mpgv/" target="_blank" rel="noopener noreferrer">
                    hraun.vedur.is/ja/Mpgv/
                  </a>
                  <br />
                  • <strong>Skjálftalísa API</strong> — ítarlegur atburðargrunnur via{" "}
                  <a href="https://api.vedur.is/?urls.primaryName=Skj%C3%A1lftal%C3%ADsa" target="_blank" rel="noopener noreferrer">
                    api.vedur.is (Skjálftalísa)
                  </a>
                  <br />
                  • <strong>EPOS API</strong> — eldfjalla- og skjálftakortaupplýsingar via{" "}
                  <a href="https://api.vedur.is/?urls.primaryName=EPOS" target="_blank" rel="noopener noreferrer">
                    api.vedur.is (EPOS)
                  </a>
                </p>
                <p>
                  Bakendinn samræmir jarðskjálftaupplýsingar frá mismunandi uppruna stöðugt
                  með sérsniðnum reikniriti. Hvert MPGV-atvik er borið saman við
                  Skjálftalísa-færslur á grundvelli tíma, staðsetningar og stærðarmarka
                  til að þekkja samsvarandi atvik. Sameinuð gagnasafnið—sem sameinar
                  nákvæmustu eiginleikana frá hverjum uppruna—er síðan afgreitt í gegnum
                  API til framendans, þar sem það knýr gagnvirka kortið og myndrænar aðgerðir.
                </p>
                <p>
                  Helstu eiginleikar eru gagnvirkur <strong>tímalínulitatilhögun</strong> sem
                  sýnir jarðskjálfta eftir mánuðum og <strong>stærðarlitatilhögun</strong> sem
                  litfærðir merkingar eftir jarðskjálftastyrk. <strong>Tímabilsglidari</strong>{" "}
                  leyfir notendum að sía atvik eftir degi, viku, mánuði eða ári — skrunaðu
                  til að þysja, dragðu til að færa. Hægt er að skipta á milli kortalaga:
                  vegakort, gervihnöttull, dökk stilling og <strong>hitakort</strong> fyrir
                  þéttleikagreiningu. <strong>Hnitanetyfirlag</strong> má víxla til að sýna
                  sjálfvirkar hnitamarkar sem laga sig að þysju. Kerfið sameinar einnig{" "}
                  <strong>ShakeMap-gögn</strong> og <strong>eldfjallayfirlög</strong> með
                  33 íslenskum eldfjöllum frá <strong>EPOS API</strong>.
                </p>
              </>
            )}
          </section>

          <section className="about-section">
            <h3>{t('about_data_export')}</h3>
            <p>{t('about_data_export_desc')}</p>
            <button
              type="button"
              className="download-csv-button"
              onClick={() => window.open(`${API_URL}/earthquakes_csv`, "_blank", "noopener,noreferrer")}
            >
              {t('about_download_csv')}
            </button>
          </section>

          <section className="about-section">
            <h3>{t('about_contact')}</h3>
            <p>{t('about_contact_desc')}</p>
            <ul className="contact-list">
              <li><a href="mailto:mfs7@hi.is">mfs7@hi.is</a></li>
              <li><a href="mailto:jonasson@hi.is">jonasson@hi.is</a></li>
              <li><a href="mailto:esa@hi.is">esa@hi.is</a></li>
            </ul>
          </section>

          <section className="about-section">
            <h3>{t('about_credits')}</h3>
            <ul>
              <li>Muhammad Faheem Sajjad</li>
              <li>Kristján Jónasson</li>
              <li>Esa Olavi Hyytia</li>
            </ul>
          </section>

          <section className="about-section disclaimer">
            <h3>{t('about_disclaimer')}</h3>
            <p>{t('about_disclaimer_desc')}</p>
          </section>
        </div>

        <footer className="about-footer">
          <small>
            {t('about_version')} {VERSION} · © {new Date().getFullYear()} {t('about_university')}
          </small>
        </footer>
      </div>
    </div>
  );
};

export default About;
