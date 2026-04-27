#!/usr/bin/env bash
# Deploy Iceland Earthquake Monitor on pluto.cs.hi.is (port 6000)
# Usage: bash deploy.sh
set -e

PORT=6000
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
LOG_FILE="$REPO_DIR/server.log"
PID_FILE="$REPO_DIR/server.pid"

echo "==> Project root: $REPO_DIR"

if [ ! -d "$VENV_DIR" ]; then
    echo "==> Creating Python virtualenv..."
    python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

echo "==> Installing Python dependencies..."
pip install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "==> Installing Node dependencies..."
npm ci --prefix "$FRONTEND_DIR"

echo "==> Building frontend..."
VITE_BASE_PATH=/mpgv/ npm run build --prefix "$FRONTEND_DIR"

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "==> Stopping existing server (PID $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
    fi
    rm -f "$PID_FILE"
fi

# 1 worker + 8 threads: handles concurrent users without spawning multiple
# APScheduler instances, which would race on the SQLite database.
echo "==> Starting gunicorn on port $PORT..."
PORT=$PORT nohup "$VENV_DIR/bin/gunicorn" \
    --chdir "$BACKEND_DIR" \
    app:app \
    --bind "0.0.0.0:$PORT" \
    --workers 1 \
    --threads 8 \
    --worker-class gthread \
    --timeout 120 \
    --keep-alive 5 \
    --log-level info \
    >> "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
echo "==> Server started (PID $(cat $PID_FILE)), listening on port $PORT"
echo "==> Logs: $LOG_FILE"
echo "==> Stop with: kill \$(cat $PID_FILE)"
