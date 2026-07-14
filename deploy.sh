#!/bin/bash
# Deploy Iceland Earthquake Monitor.
# Usage:
#   bash deploy.sh
#   bash deploy.sh --port 6000
#   bash deploy.sh --base-url /
#   bash deploy.sh --base-url /mpgv/
#   bash deploy.sh --base-url https://example.org/mpgv/
set -e
umask 077

PORT=6000
BASE_URL="/mpgv/"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
VENV_PY_MARKER="$VENV_DIR/.python-path"
LOG_FILE="$REPO_DIR/server.log"
PID_FILE="$REPO_DIR/server.pid"
PRIVATE_ENV_FILE="${PRIVATE_ENV_FILE:-$REPO_DIR/private.env}"

usage() {
    cat <<EOF
Usage: bash deploy.sh [--port PORT] [--base-url URL_OR_PATH]

Options:
  --port PORT          Port for gunicorn to bind to. Default: 6000
  --base-url VALUE     Frontend base path or full public URL.
                       Examples: /, /mpgv/, https://example.org/mpgv/
  -h, --help           Show this help

Notes:
  - Gunicorn itself serves plain HTTP.
  - Use an https:// base URL only when TLS is terminated by a reverse proxy
    such as nginx or Apache in front of gunicorn.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --port)
            PORT="${2:-}"
            shift 2
            ;;
        --base-url)
            BASE_URL="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: $1"
            usage
            exit 1
            ;;
    esac
done

if [ -z "$PORT" ] || ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$'; then
    echo "ERROR: --port must be a numeric port."
    exit 1
fi

if [ -z "$BASE_URL" ]; then
    echo "ERROR: --base-url cannot be empty."
    exit 1
fi

BASE_PATH="$BASE_URL"
if printf '%s' "$BASE_PATH" | grep -Eq '^[a-zA-Z][a-zA-Z0-9+.-]*://'; then
    BASE_PATH="${BASE_PATH#*://}"
    BASE_PATH="/${BASE_PATH#*/}"
fi

case "$BASE_PATH" in
    /*) ;;
    *)
        BASE_PATH="/$BASE_PATH"
        ;;
esac

if [ "$BASE_PATH" != "/" ]; then
    BASE_PATH="${BASE_PATH%/}/"
fi

if command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3.12)"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
else
    echo "ERROR: No suitable Python interpreter found. Install python3.12 or python3."
    exit 1
fi

echo "==> Project root: $REPO_DIR"
echo "==> Using Python: $PYTHON_BIN ($("$PYTHON_BIN" --version 2>&1))"
echo "==> Frontend base path: $BASE_PATH"
echo "==> Gunicorn port: $PORT"

if [ -f "$PRIVATE_ENV_FILE" ]; then
    if command -v stat >/dev/null 2>&1; then
        ENV_MODE="$(stat -c '%a' "$PRIVATE_ENV_FILE" 2>/dev/null || true)"
        if [ "$ENV_MODE" != "600" ]; then
            echo "ERROR: $PRIVATE_ENV_FILE must have mode 600."
            echo "Run: chmod 600 '$PRIVATE_ENV_FILE'"
            exit 1
        fi
    fi
    echo "==> Loading private environment from $PRIVATE_ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    . "$PRIVATE_ENV_FILE"
    set +a
else
    echo "WARNING: $PRIVATE_ENV_FILE not found; ADMIN_TOKEN-dependent maintenance routes will be disabled."
fi

export APP_ENV="${APP_ENV:-production}"
export RATE_LIMIT_STORAGE="${RATE_LIMIT_STORAGE:-memory://}"
export RUNTIME_DIR="${RUNTIME_DIR:-$REPO_DIR/runtime}"
export TRUSTED_PROXY_COUNT="${TRUSTED_PROXY_COUNT:-0}"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR" 2>/dev/null || true

if [ -z "${ADMIN_TOKEN:-}" ]; then
    echo "WARNING: ADMIN_TOKEN is not set; maintenance routes will be disabled."
fi

if [ "$TRUSTED_PROXY_COUNT" = "1" ]; then
    echo "==> Trusting exactly one reverse proxy for forwarded client IP headers."
else
    echo "==> Not trusting forwarded client IP headers. Set TRUSTED_PROXY_COUNT=1 only after nginx topology is confirmed."
fi

SELECTED_PY_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

if [ -d "$VENV_DIR" ]; then
    RECREATE_VENV=0
    if [ -x "$VENV_DIR/bin/python" ]; then
        VENV_PY_VERSION="$("$VENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
        if [ "$VENV_PY_VERSION" != "$SELECTED_PY_VERSION" ]; then
            echo "==> Recreating virtualenv because Python version changed:"
            echo "    old: $VENV_PY_VERSION"
            echo "    new: $SELECTED_PY_VERSION"
            RECREATE_VENV=1
        fi
    elif [ -f "$VENV_PY_MARKER" ]; then
        EXISTING_PYTHON="$(cat "$VENV_PY_MARKER")"
        if [ "$EXISTING_PYTHON" != "$PYTHON_BIN" ]; then
            echo "==> Recreating virtualenv because Python changed:"
            echo "    old: $EXISTING_PYTHON"
            echo "    new: $PYTHON_BIN"
            RECREATE_VENV=1
        fi
    fi

    if [ "$RECREATE_VENV" -eq 1 ]; then
        rm -rf "$VENV_DIR"
    fi
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "==> Creating Python virtualenv..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    printf '%s\n' "$PYTHON_BIN" > "$VENV_PY_MARKER"
fi
source "$VENV_DIR/bin/activate"

echo "==> Installing Python dependencies..."
python -m pip install --quiet --upgrade pip
pip install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "==> Installing Node dependencies..."
npm ci --prefix "$FRONTEND_DIR"

echo "==> Building frontend..."
VITE_BASE_PATH="$BASE_PATH" npm run build --prefix "$FRONTEND_DIR"

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
    --bind "127.0.0.1:$PORT" \
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
if [ "$BASE_PATH" = "/" ]; then
    echo "==> Test locally:  http://127.0.0.1:$PORT/"
else
    echo "==> Test via proxy: <your-public-origin>$BASE_PATH"
fi
echo "==> API health:    http://127.0.0.1:$PORT/health"
