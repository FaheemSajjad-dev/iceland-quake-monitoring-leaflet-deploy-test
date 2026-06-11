# Deployment Overview

This document records how this project is deployed, how the live service behaves, and how to monitor it.

## Current Live Deployment

- Platform: University server on Pluto
- Live URL: `http://pluto.cs.hi.is/mpgv/`
- SSH host: `pluto.cs.hi.is`
- SSH user: `mfs7`
- Server project path: `~/iceland-quake`
- Backend port: `6000`
- Source repo: `FaheemSajjad-dev/iceland-quake-monitoring-leaflet-deploy-test`

The deploy project at `F:\iceland-quake-monitoring-leaflet-deploy-test` is the local source used for Pluto uploads.

## Pluto Deployment Model

- Flask backend runs from `backend/app.py`.
- React frontend is built from `frontend/`.
- Flask serves the built frontend from `frontend/dist`.
- API and frontend are served from the same origin under the Pluto site.
- `deploy.sh` installs dependencies, builds the frontend, stops the existing Gunicorn process, and starts Gunicorn on port 6000.
- `stop.sh` stops the running server using `server.pid`.

## Standard Update Flow

1. Apply and verify changes in the main F project.
2. Copy the same relevant changes to the deploy F project.
3. Mirror changed files to the G recovery folders.
4. Run backend and frontend tests locally.
5. Build both frontends locally.
6. Commit and push both F repositories.
7. Upload changed deploy files to Pluto.
8. On Pluto:

```bash
cd ~/iceland-quake
./deploy.sh
```

When root-level deploy files change, upload only the root files that changed. When frontend or backend files change, upload the matching frontend/backend files or directories while excluding `node_modules`.

## Pluto Runtime Files

- `server.pid` stores the running Gunicorn PID.
- `server.log` stores runtime logs.
- `deploy.sh` restarts the app.
- `stop.sh` stops the app.

## Health Checks

Check:

- `http://pluto.cs.hi.is/mpgv/`
- `http://pluto.cs.hi.is/mpgv/health` if routed by the server configuration
- `~/iceland-quake/server.log` on Pluto

## Legacy Render Notes

This repository still contains Render configuration files for the earlier single-service Render deployment:

- `render.yaml`
- `RENDER_DEPLOY.md`
- `backend/requirements-render.txt`

Those files are kept as deployment reference material, but Pluto is the current active deployment target.

## Production Considerations

- The app uses SQLite; consider PostgreSQL for true high-concurrency production use.
- Review tile-provider licensing before formal public or institutional deployment.
- Consider nginx/static caching for built assets, tiles, sprites, and fonts.
- Consider rate limiting before wider public exposure.
- MapLibre GL requires browser WebGL support for the vector Map layer.