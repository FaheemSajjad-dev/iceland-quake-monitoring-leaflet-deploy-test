import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLang } from "../i18n";

/*
  Fault and fissure linework from EGDI/HIKE. We fetch the source WFS features
  instead of the WMS image layer so the map can keep only Iceland onshore data.
*/

const HIKE_WFS_URL = "https://maps.europe-geology.eu/wfs/";
const HIKE_METADATA_URL = "https://metadata.europe-geology.eu/record/basic/604a286d-bab0-46be-9e9e-46940a010833";
const ICELAND_BBOX = "-24.8,63.0,-13.0,66.7";
const FAULTS_PANE = "faultsPane";

const buildWfsUrl = () => {
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typename: "hike_detail_layer",
    outputformat: "geojson",
    bbox: ICELAND_BBOX,
  });
  return `${HIKE_WFS_URL}?${params.toString()}`;
};

const isOnshoreIcelandFeature = (feature) => {
  const props = feature?.properties ?? {};
  return props.country_cd === "IS" && props.observ_meth !== "sonar survey";
};

const faultStyle = (feature) => {
  const type = String(feature?.properties?.fault_type ?? "").toLowerCase();
  const isFissure = type.includes("fissure");

  return {
    color: isFissure ? "#b8322c" : "#8f1f1f",
    weight: isFissure ? 1.2 : 1.4,
    opacity: 0.92,
    dashArray: isFissure ? "3 4" : null,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  };
};

const getLegendHtml = (lang) => {
  const title = lang === "is" ? "Misgengi / sprungur" : "Faults / Fissures";
  const official = lang === "is" ? "Kortlogd HIKE/EGDI linugogn" : "Mapped HIKE/EGDI linework";
  const source = lang === "is" ? "Heimild: EGDI/HIKE, ISOR" : "Source: EGDI/HIKE, ISOR";
  return `
    <div class="tectonic-legend">
      <div class="tectonic-legend__title">${title}</div>
      <div class="tectonic-legend__row"><span class="tec-swatch tec-swatch--official"></span><span>${official}</span></div>
      <a class="tectonic-legend__source" href="${HIKE_METADATA_URL}" target="_blank" rel="noreferrer">${source}</a>
    </div>`;
};

export default function FaultsOverlay({ show }) {
  const map = useMap();
  const { lang } = useLang();
  const langRef = useRef(lang);
  const layerRef = useRef(null);
  const legendRef = useRef(null);
  const legendElRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { langRef.current = lang; }, [lang]);

  useEffect(() => {
    if (!map.getPane(FAULTS_PANE)) {
      const pane = map.createPane(FAULTS_PANE);
      pane.style.zIndex = "430";
      pane.style.pointerEvents = "none";
    }

    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "faults-legend-control");
      div.innerHTML = getLegendHtml(langRef.current);
      L.DomEvent.disableClickPropagation(div);
      legendElRef.current = div;
      return div;
    };
    legendRef.current = legend;

    return () => {
      abortRef.current?.abort();
      if (layerRef.current) layerRef.current.remove();
      legend.remove();
      layerRef.current = null;
      legendRef.current = null;
      legendElRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (legendElRef.current) legendElRef.current.innerHTML = getLegendHtml(lang);
  }, [lang]);

  useEffect(() => {
    const legend = legendRef.current;
    if (!legend) return;

    if (!show) {
      abortRef.current?.abort();
      if (layerRef.current) layerRef.current.remove();
      legend.remove();
      return;
    }

    legend.addTo(map);

    if (layerRef.current) {
      layerRef.current.addTo(map);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(buildWfsUrl(), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Faults WFS request failed: ${response.status}`);
        return response.json();
      })
      .then((geojson) => {
        if (controller.signal.aborted) return;
        const filtered = {
          ...geojson,
          features: (geojson.features ?? []).filter(isOnshoreIcelandFeature),
        };
        const layer = L.geoJSON(filtered, {
          pane: FAULTS_PANE,
          style: faultStyle,
          interactive: false,
          attribution: `Faults/fissures: <a href="${HIKE_METADATA_URL}" target="_blank" rel="noreferrer">EGDI/HIKE, ISOR</a>`,
        });
        layerRef.current = layer;
        layer.addTo(map);
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      });

    return () => controller.abort();
  }, [show, map]);

  return null;
}