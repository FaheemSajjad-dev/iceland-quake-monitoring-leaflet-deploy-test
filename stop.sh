#!/usr/bin/env bash
PID_FILE="$(cd "$(dirname "$0")" && pwd)/server.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" && echo "Stopped server (PID $PID)"
    else
        echo "Process $PID not running"
    fi
    rm -f "$PID_FILE"
else
    echo "No PID file found"
fi
