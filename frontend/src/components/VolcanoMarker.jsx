import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

const volcanoSvg = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
    <path fill="#ff3c00ff" d="M12,2L2,22h20L12,2z M12,17c-0.6,0-1-0.4-1-1s0.4-1,1-1s1,0.4,1,1S12.6,17,12,17z"/>
  </svg>`
);

const volcanoIcon = L.divIcon({
  className: "",
  html: `<img src="data:image/svg+xml;charset=UTF-8,${volcanoSvg}" width="20" height="20" style="pointer-events:auto;"/>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const VolcanoMarker = ({ volcano, onSelect }) => {
  const map = useMap();
  const markerRef = useRef(null);

  useEffect(() => {
    if (volcano.latitude == null || volcano.longitude == null) return;
    const lat = parseFloat(volcano.latitude);
    const lng = parseFloat(volcano.longitude);
    if (isNaN(lat) || isNaN(lng)) {
      console.log("Skipping volcano due to missing coordinates:", volcano.name);
      return;
    }

    const marker = L.marker([lat, lng], {
      icon: volcanoIcon,
      zIndexOffset: 5,
      title: volcano.name,
      pane: "volcano-pane",
    })
      .on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelect(volcano);
      })
      .addTo(map);

    markerRef.current = marker;
    return () => map.removeLayer(marker);
  }, [map, volcano, onSelect]);

  return null;
};

export default VolcanoMarker;
