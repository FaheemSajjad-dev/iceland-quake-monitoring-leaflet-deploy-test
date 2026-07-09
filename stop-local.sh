#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.local/backend.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No local backend PID file found."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped local backend (PID $PID)."
else
  echo "Local backend process $PID is not running."
fi

rm -f "$PID_FILE"
