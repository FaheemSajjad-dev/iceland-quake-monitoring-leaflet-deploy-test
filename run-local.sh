#!/usr/bin/env bash
# Run the app locally as the current user.
#
# Defaults:
#   frontend: http://127.0.0.1:5174
#   backend:  http://127.0.0.1:5001
#
# The backend scheduler is disabled by default for faster UI testing. Set
# DISABLE_SCHEDULER=0 when you explicitly want local background refresh jobs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOCAL_DIR="$ROOT_DIR/.local"
VENV_DIR="$BACKEND_DIR/venv"
BACKEND_PORT="${BACKEND_PORT:-5001}"
FRONTEND_PORT="${FRONTEND_PORT:-5174}"
DISABLE_SCHEDULER="${DISABLE_SCHEDULER:-1}"
RATE_LIMIT_ENABLED="${RATE_LIMIT_ENABLED:-false}"

mkdir -p "$LOCAL_DIR"

if command -v python3.12 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.12)"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
else
  echo "ERROR: python3.12 or python3 is required." >&2
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating backend virtualenv..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "==> Installing backend dependencies if needed..."
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "==> Installing frontend dependencies..."
  npm ci --prefix "$FRONTEND_DIR"
fi

if [ -f "$LOCAL_DIR/backend.pid" ]; then
  OLD_PID="$(cat "$LOCAL_DIR/backend.pid")"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "==> Stopping previous local backend (PID $OLD_PID)..."
    kill "$OLD_PID"
    sleep 1
  fi
  rm -f "$LOCAL_DIR/backend.pid"
fi

echo "==> Starting backend on http://127.0.0.1:$BACKEND_PORT ..."
(
  cd "$ROOT_DIR"
  FRONTEND_PORT="$FRONTEND_PORT" \
  BACKEND_PORT="$BACKEND_PORT" \
  DISABLE_SCHEDULER="$DISABLE_SCHEDULER" \
  RATE_LIMIT_ENABLED="$RATE_LIMIT_ENABLED" \
  "$VENV_DIR/bin/python" "$BACKEND_DIR/app.py"
) > "$LOCAL_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$LOCAL_DIR/backend.pid"

cleanup() {
  if kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  rm -f "$LOCAL_DIR/backend.pid"
}
trap cleanup EXIT INT TERM

echo "==> Backend log: $LOCAL_DIR/backend.log"
echo "==> Starting frontend on http://127.0.0.1:$FRONTEND_PORT ..."
echo "==> Press Ctrl-C to stop both processes."

cd "$FRONTEND_DIR"
npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT"
