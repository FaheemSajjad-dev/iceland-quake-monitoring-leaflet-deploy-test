import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import frontendPackage from "../../package.json";
import mapComponentSource from "../components/MapComponent.jsx?raw";

const appStyles = readFileSync(resolve(cwd(), "src/App.css"), "utf8");
const mapStyles = readFileSync(resolve(cwd(), "src/components/MapComponent.css"), "utf8");

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

  it("positions mobile info cards above all six map action buttons", () => {
    expect(appStyles).toContain(
      "--action-rail-height: calc(var(--action-button-size) * 6 + var(--action-button-gap) * 5);"
    );
    expect(mapStyles).toContain(
      "bottom: calc(var(--action-rail-bottom) + var(--action-rail-height) + var(--action-card-gap));"
    );
  });
});
