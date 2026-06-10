import { createContext, useContext, useState } from "react";

const LangContext = createContext(null);

const T = {
  en: {
    // App
    app_title: "Iceland MPGV Earthquake Map",
    about: "About",
    // LeftPanel controls
    show_controls: "Show controls",
    hide_controls: "Hide controls",
    marker_colour: "Marker colour",
    timeline: "Timeline",
    magnitude: "Magnitude",
    overlays: "Overlays",
    volcanoes: "Volcanoes",
    lat_long_grid: "Lat-long grid",
    faults: "Faults",
    reload_page: "Reload page",
    default_location: "Default map view",
    // Map types
    map_map: "Map",
    map_satellite: "Satellite",
    map_terrain: "Terrain",
    map_gray: "Gray",
    map_heatmap: "Heatmap",
    // Info cards
    info_earthquake: "Earthquake",
    info_depth: "Depth",
    info_time: "Time",
    info_lat: "Lat",
    info_lon: "Lon",
    info_elevation: "Elevation",
    info_unknown: "Unknown",
    info_view_shakemap: "View ShakeMap ↗",
    // Right panel
    // About dialog
    about_title: "Iceland MPGV Earthquake Map",
    about_close: "Close About window",
    about_overview: "Overview",
    about_data_export: "Data export",
    about_data_export_desc: "You can download the curated earthquake catalogue used in this map as a CSV file (all merged events from June 2020 onward, Mw ≥ 3.0).",
    about_download_csv: "Download CSV",
    about_contact: "Contact",
    about_contact_desc: "For feedback, collaboration, or support:",
    about_credits: "Credits",
    about_disclaimer: "Disclaimer",
    about_disclaimer_desc: "Optimized for desktop browsers; mobile support is limited.",
    about_version: "Version",
    about_university: "University of Iceland",
    // Heatmap legend
    heatmap_density: "Earthquake density",
    heatmap_low: "Low",
    heatmap_high: "High",
    // Map loading
    loading_map: "Loading map…",
    // Faults legend
    tec_legend_title: "Faults / Fissures",
    tec_legend_rift: "Volcanic rift zone",
    tec_legend_fault: "Transform fault",
    tec_legend_flank: "Off-rift flank belt",
    tec_legend_ridge: "Submarine ridge",
    // Faults tooltip labels
    tec_motion: "Motion:",
    tec_spreading: "Spreading:",
  },
  is: {
    // App
    app_title: "MPGV Jarðskjálftakort Íslands",
    about: "Um",
    // LeftPanel controls
    show_controls: "Sýna stýringar",
    hide_controls: "Fela stýringar",
    marker_colour: "Litur merkja",
    timeline: "Tímalína",
    magnitude: "Stærð",
    overlays: "Yfirlag",
    volcanoes: "Eldfjöll",
    lat_long_grid: "Hnitanet",
    faults: "Misgengi",
    reload_page: "Endurhlaða",
    default_location: "Sjálfgefin kortasýn",
    // Map types
    map_map: "Map",
    map_satellite: "Gervihnöttur",
    map_terrain: "Landslag",
    map_gray: "Grátt",
    map_heatmap: "Hitakort",
    // Info cards
    info_earthquake: "Jarðskjálfti",
    info_depth: "Dýpt",
    info_time: "Tími",
    info_lat: "Breidd",
    info_lon: "Lengd",
    info_elevation: "Hæð",
    info_unknown: "Óþekkt",
    info_view_shakemap: "Skoða ShakeMap ↗",
    // Right panel
    // About dialog
    about_title: "MPGV Jarðskjálftakort Íslands",
    about_close: "Loka Um glugga",
    about_overview: "Yfirlit",
    about_data_export: "Niðurhal gagna",
    about_data_export_desc: "Hægt er að hlaða niður jarðskjálftaskrá þessa korts sem CSV-skrá (öll sameinuð atvik frá júní 2020, Mw ≥ 3.0).",
    about_download_csv: "Hlaða niður CSV",
    about_contact: "Tengiliður",
    about_contact_desc: "Fyrir endurgjöf, samstarf eða stuðning:",
    about_credits: "Þakkarorð",
    about_disclaimer: "Fyrirvari",
    about_disclaimer_desc: "Fínstillt fyrir skjáborðsvafra; stuðningur við farsíma er takmarkaður.",
    about_version: "Útgáfa",
    about_university: "Háskóli Íslands",
    // Heatmap legend
    heatmap_density: "Þéttleiki jarðskjálfta",
    heatmap_low: "Lágur",
    heatmap_high: "Hár",
    // Map loading
    loading_map: "Hleður kort…",
    // Faults legend
    tec_legend_title: "Jarðtektóníkbeltjar",
    tec_legend_rift: "Gosbelt / gjábelti",
    tec_legend_fault: "Umbreytingarbrot",
    tec_legend_flank: "Hlið-gosbelt",
    tec_legend_ridge: "Neðansjávarhryggjur",
    // Faults tooltip labels
    tec_motion: "Hreyfing:",
    tec_spreading: "Breiðsla:",
  },
};

export const LangProvider = ({ children }) => {
  const [lang, setLang] = useState("en");
  const toggleLang = () => setLang(l => l === "en" ? "is" : "en");
  return (
    <LangContext.Provider value={{ lang, toggleLang }}>
      {children}
    </LangContext.Provider>
  );
};

export const useLang = () => useContext(LangContext);

export const useT = () => {
  const { lang } = useLang();
  return key => T[lang]?.[key] ?? T.en[key] ?? key;
};
