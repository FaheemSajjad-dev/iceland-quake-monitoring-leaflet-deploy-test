# Iceland Earthquake Monitoring - Frontend

React 18 + Vite frontend for the Iceland Earthquake Monitoring Leaflet app.

## Stack

- React 18 and Vite
- react-leaflet 4, Leaflet, MapLibre GL, leaflet.heat
- OpenFreeMap map tiles, IMO terrain tiles, Esri imagery, and CARTO basemaps
- Vitest + Testing Library

## Running

```bash
npm install
npm run dev
```

The dev server opens at [http://localhost:5174](http://localhost:5174). It expects the Flask backend on port 5001.

## Testing

```bash
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
| Map | OpenFreeMap vector style rendered with MapLibre |
| Satellite | Esri World Imagery |
| Terrain | Icelandic Meteorological Office raster terrain tiles |
| Gray | CARTO light basemap |
| Heatmap | CARTO dark base with leaflet.heat density overlay |

## Live Overlays

- Earthquakes are reloaded from the backend every 3 minutes.
- Volcano metadata is reloaded every 3 minutes and is refreshed by the backend scheduler.
- Fault and fissure linework is fetched from EGDI/HIKE WFS when enabled and refreshes every 3 minutes while visible.

## Heatmap

- Gradient: transparent to dark blue, steel blue, teal, amber, orange, and red.
- Zoom-responsive radius keeps seismic belts visible across zoom levels.
- Magnitude weights: M 4-5 -> 1.15x, M 5+ -> 1.3x. Density remains the main signal.
- `leaflet.heat` requires `window.L` before import, so it is loaded dynamically after `window.L = L`.
