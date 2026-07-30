# MPGV Monitor architecture explorer

This folder contains an isolated, read-only architecture documentation tool for the MPGV Monitor repository. It does not import code into the production frontend or backend and adds no application runtime dependency.

## Open the explorer

From the repository root:

```powershell
python -m http.server 8090 --directory project-architecture
```

Then open <http://127.0.0.1:8090/>.

The page uses only local HTML, CSS, JavaScript, SVG, and JSON. No CDN or internet connection is required. A local HTTP server is necessary because browsers normally block `fetch()` of a neighbouring JSON file from a `file://` page.

## Regenerate the dataset

```powershell
python project-architecture/generate_architecture.py
```

Check that the committed JSON is current:

```powershell
python project-architecture/generate_architecture.py --check
```

The generator:

- walks supported repository source and documentation files in a deterministic order;
- prunes dependencies, builds, caches, virtual environments, binary assets, runtime databases, logs, PID files, and package-lock internals;
- extracts Python and JavaScript imports, public symbols, Flask route decorators, and environment-variable names;
- resolves local JavaScript imports to repository-relative paths;
- adds curated descriptions and relationships for runtime imports, HTTP calls, props, rendering, data flow, database access, deployment, and tests;
- validates every file node, edge, view, and flow before writing `architecture-data.json`;
- scans generated documentation for common secret-token patterns.

## Files

| File | Purpose |
|---|---|
| `index.html` | Accessible explorer shell and controls |
| `styles.css` | Responsive light/dark presentation and graph styles |
| `app.js` | Offline SVG graph, filtering, navigation, highlighting, details, and data-flow interactions |
| `architecture-data.json` | Generated architecture model consumed by the explorer |
| `generate_architecture.py` | Static analysis, curation, validation, and JSON generation |
| `PROJECT_FILE_GUIDE.md` | Narrative architecture and feature-tracing guide |

## Interaction

- Use the view selector for frontend, backend, ingestion, Insights, map, database, deployment, or test-focused graphs.
- Search paths, purposes, routes, and symbol names.
- Filter categories and importance levels.
- Scroll to zoom, drag the background to pan, and drag individual nodes to untangle a local view.
- Select a node to see why it exists, what it uses, what uses it, routes, tables, configuration names, tests, and change risk.
- Toggle direct dependencies and incoming dependents to control selection emphasis.
- Use the flow selector to trace a major operation end to end.

## Maintenance rule

Static imports are detected automatically, but architecture meaning is curated deliberately. When a core responsibility, runtime call, route, database table, or cross-layer flow changes, update the corresponding `MANUAL`, `CURATED_EDGES`, `FLOWS`, or `VIEWS` entry in `generate_architecture.py`, then regenerate and validate the JSON.
