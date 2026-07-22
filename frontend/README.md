# Iceland Earthquake Monitoring - Frontend

React 18 + Vite frontend for the MPGV Monitor map and Insights page.

## Stack

- React 18 and Vite
- MapLibre GL and deck.gl
- OpenFreeMap Positron/dark styles, IMO terrain tiles, and Esri imagery
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
|-- analysis/           # Insights filters, summaries, charts, tables, and CSV export
|-- components/         # Map, overlays, panels, slider, scale, markers
|-- api.js              # API helpers pointing to localhost in dev and same-origin in production
`-- __tests__/          # Vitest component tests
```

## Insights

The separate `/analysis` route (served as `/mpgv/analysis` on Pluto) is linked from the map and can return selected table events to the map. It analyzes the same merged earthquake catalogue and provides:

- Date, magnitude, depth, depth-quality, data-category, and time-grouping filters.
- Dynamic magnitude and policy-specific depth bounds from `GET /insights/limits`; numeric entries are clamped to catalogue bounds and invalid ranges are rejected.
- Summary cards plus five Recharts visualizations: magnitude distribution, depth distribution, magnitude versus depth, average magnitude over time, and category counts over time.
- Desktop tooltips, touch interaction for the magnitude-versus-depth scatter plot, and range brushes on both time-series charts.
- Recent and strongest tables with sorting, five rows per page, pagination, and **View on map** actions.
- Filtered CSV export and print/PDF output.

Depth analysis defaults to matched IMO Quakes API depths. Raw MPGV-only depths can be included explicitly as unverified values; the interface preserves and labels those values rather than correcting them.

## Map Layers

| Name | Provider |
|---|---|
| Map | OpenFreeMap Positron vector basemap |
| Satellite | Esri World Imagery |
| Terrain | Icelandic Meteorological Office raster terrain tiles |
| Heatmap | OpenFreeMap dark style with a MapLibre density layer |

All current map views use MapLibre GL. The default **Map** layer uses the OpenFreeMap Positron vector style; Satellite and Terrain use raster sources with MapLibre labels. Current browsers must allow WebGL.

## Live Overlays

- Earthquakes are reloaded from the backend every 3 minutes.
- Volcano metadata is reloaded every 3 minutes and is refreshed by the backend scheduler.
- Fault and fissure linework is fetched from EGDI/HIKE WFS on first use and cached for later toggles.

## Current Map UI

- Earthquake points use deck.gl scatterplot layers with separate invisible hit targets for easier selection.
- The base layer label is **Map**.
- The right-side volcano panel shifts map controls so the scale and fault legend stay visible.
- The faults legend shows solid red faults and dotted red fissures.
- The lat/lon grid uses Iceland-focused spacing, one-decimal degree labels, fixed latitude label anchoring, and unlabeled latitude midlines.
- Lat/lon labels become slightly stronger while the faults overlay is visible.
- The bottom-right attribution is compact and reflects the active basemap plus EGDI/HIKE when faults are visible.
- Earthquake and volcano info cards open at the upper-left map work area.
- Recent Selections records the latest ten unique earthquake marker selections and can return to a selected event without changing filters or overlays.
- The responsive layout supports desktop and mobile controls and information cards.

## Heatmap

- Gradient: transparent to dark blue, steel blue, teal, amber, orange, and red.
- Zoom-responsive radius keeps seismic belts visible across zoom levels.
- Magnitude weights: M 3-4 -> 0.20, M 4-5 -> 0.30, M 5+ -> 0.45. Density remains the main signal.
- Heatmap is rendered by MapLibre and intentionally provides no individual marker selection or Recent Selections control.
