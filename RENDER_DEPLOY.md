# Render Deploy Reference

This file documents the earlier Render setup. Pluto is currently the active deployment target for the live app.

## Render Model

The repo can be configured for a single Render web service that serves both:

- the Flask API from `backend/app.py`
- the built React frontend from `frontend/dist`

## What Render Uses

- Config file: `render.yaml`
- Python deps: `backend/requirements-render.txt`
- Start command: `gunicorn --chdir backend app:app --bind 0.0.0.0:$PORT --workers 1`

## Render Deploy Steps

1. Push this repo to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Connect the repo and deploy.
4. Wait for the build to finish.
5. Open the Render URL.

## Notes

- Free Render web services spin down after inactivity and wake on first request.
- This app uses SQLite at `backend/data/earthquakes.db`.
- Render free web services do not provide persistent disk storage, so database contents can reset on redeploy/restart.
- The scheduler stays enabled in deployment and runs inside the single Gunicorn worker.

## Current Active Deployment

Use Pluto for the current live version:

```bash
ssh mfs7@pluto.cs.hi.is
cd ~/iceland-quake
./deploy.sh
```