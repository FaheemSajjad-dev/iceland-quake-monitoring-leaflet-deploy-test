import { describe, expect, it } from "vitest";
import frontendPackage from "../../package.json";
import mapComponentSource from "../components/MapComponent.jsx?raw";

const REMOVED_LEAFLET_PACKAGES = [
  "@maplibre/maplibre-gl-leaflet",
  "esri-leaflet",
  "leaflet",
  "leaflet.heat",
  "react-leaflet",
];

describe("active map architecture", () => {
  it("uses MapLibre and deck.gl without Leaflet compatibility dependencies", () => {
    const dependencies = frontendPackage.dependencies ?? {};

    for (const packageName of REMOVED_LEAFLET_PACKAGES) {
      expect(dependencies).not.toHaveProperty(packageName);
    }

    expect(dependencies).toHaveProperty("maplibre-gl");
    expect(dependencies).toHaveProperty("react-map-gl");
    expect(dependencies).toHaveProperty("@deck.gl/mapbox");
  });

  it("contains no legacy Leaflet map path or imports", () => {
    expect(mapComponentSource).not.toMatch(/leaflet_heatmap_legacy/i);
    expect(mapComponentSource).not.toMatch(/react-leaflet|leaflet\.heat|maplibre-gl-leaflet/i);
    expect(mapComponentSource).toContain("MapLibreEarthquakeMap");
    expect(mapComponentSource).toContain("MapboxOverlay");
  });
});
