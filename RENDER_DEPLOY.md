# Render Deploy

This repo is configured for a single Render web service that serves both:

- the Flask API from `backend/app.py`
- the built React frontend from `frontend/dist`

## What Render uses

- Config file: `render.yaml`
- Python deps: `backend/requirements-render.txt`
- Start command: `gunicorn --chdir backend app:app --bind 0.0.0.0:$PORT --workers 1`

## Deploy steps

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
