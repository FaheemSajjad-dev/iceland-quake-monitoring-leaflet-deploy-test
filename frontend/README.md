# Iceland Earthquake Monitoring - Frontend

React 18 + Vite frontend for the Iceland Earthquake Monitoring Leaflet app.

## Stack

- React 18 and Vite
- react-leaflet 4, Leaflet, MapLibre GL, leaflet.heat
- OpenFreeMap Positron, CARTO heatmap tiles, IMO terrain tiles, Esri imagery, and MapLibre label overlays
- Vitest + Testing Library

## Running

Preferred local development from the repository root:

```bash
npm run dev
```

Frontend-only development from this directory:

```bash
npm install
npm run dev
```

The dev server opens at `http://localhost:5174`. It expects the Flask backend on port 5001.

For the live Pluto deployment, the built frontend is served by Flask/Gunicorn through `http://pluto.cs.hi.is/mpgv/`. Gunicorn listens locally on port `6000`; the frontend and API are same-origin under `/mpgv/`.

## Testing

```bash
npm test
```

Recommended local quality gate:

```bash
npm audit --audit-level=low
npm run lint
npm run build
npm test
```

## Structure

```text
src/
|-- components/         # Map, overlays, panels, slider, scale, markers
|-- api.js              # API helpers pointing to localhost in dev and same-origin in production
`-- __tests__/          # Vitest component tests
```

## Map Layers

| Name | Provider |
|---|---|
| Map | OpenFreeMap Positron vector basemap |
| Satellite | Esri World Imagery |
| Terrain | Icelandic Meteorological Office raster terrain tiles |
| Gray | CARTO light basemap |
| Heatmap | CARTO dark base with leaflet.heat density overlay |

The default **Map** layer uses the OpenFreeMap Positron vector style through MapLibre GL. MapLibre GL is also used for label overlays on some non-default layers, so Chrome, Safari, or Edge should allow WebGL/hardware graphics for those overlays.

## Live Overlays

- Earthquakes are reloaded from the backend every 3 minutes.
- Volcano metadata is reloaded every 3 minutes and is refreshed by the backend scheduler.
- Fault and fissure linework is fetched from EGDI/HIKE WFS on first use and cached for later toggles.

## Current Map UI

- Earthquake points use SVG Leaflet `L.circleMarker` rendering with separate invisible hit targets for easier selection.
- The base layer label is **Map**.
- The right-side volcano panel shifts the About button and bottom-right Leaflet controls so the scale and fault legend stay visible.
- The faults legend shows solid red faults and dotted red fissures.
- The lat/lon grid uses Iceland-focused spacing, one-decimal degree labels, fixed latitude label anchoring, and unlabeled latitude midlines.
- Lat/lon labels become slightly stronger while the faults overlay is visible.
- The bottom-right attribution is compact and reflects the active basemap plus EGDI/HIKE when faults are visible.
- Earthquake and volcano info cards open at the upper-left map work area.

## Heatmap

- Gradient: transparent to dark blue, steel blue, teal, amber, orange, and red.
- Zoom-responsive radius keeps seismic belts visible across zoom levels.
- Magnitude weights: M 3-4 -> 0.20, M 4-5 -> 0.30, M 5+ -> 0.45. Density remains the main signal.
- `leaflet.heat` requires `window.L` before import, so it is loaded dynamically after `window.L = L`.
