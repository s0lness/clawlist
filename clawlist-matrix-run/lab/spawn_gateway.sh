#!/usr/bin/env bash
set -euo pipefail

# Spawn an OpenClaw gateway for a given profile on a specified port (or pick a free one).
# Writes logs to runs/<runId>/out/.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${PROFILE:-${1:-}}"
[ -n "$PROFILE" ] || { echo "usage: spawn_gateway.sh <profile>" >&2; exit 2; }

RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
OUT_DIR="$ROOT_DIR/runs/$RUN_ID/out"
mkdir -p "$OUT_DIR"

PORT="${PORT:-}"
TOKEN="${TOKEN:-token-${PROFILE}}"

port_in_use() {
  local port="$1"
  ss -ltnH 2>/dev/null | grep -Eq "[:\]]${port}\\b" && return 0
  return 1
}

pick_free_port() {
  local port="$1"
  while port_in_use "$port"; do port=$((port+1)); done
  echo "$port"
}

if [ -z "$PORT" ]; then
  PORT=$(pick_free_port 18791)
else
  if port_in_use "$PORT"; then
    echo "[spawn_gateway] ERROR: requested port $PORT is already in use. Stop the existing gateway or omit PORT to auto-pick." >&2
    exit 1
  fi
fi

LOG="$OUT_DIR/gateway_${PROFILE}.log"
PID_FILE="$OUT_DIR/gateway_${PROFILE}.pid"

echo "[spawn_gateway] profile=$PROFILE run_id=$RUN_ID port=$PORT log=$LOG"

OPENCLAW_GATEWAY_PORT="$PORT" OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  openclaw --profile "$PROFILE" gateway run --port "$PORT" --token "$TOKEN" --force --compact --allow-unconfigured >"$LOG" 2>&1 &
PID=$!

echo "$PORT" >"$OUT_DIR/gateway_${PROFILE}.port"

echo "[spawn_gateway] pid=$PID"

# Wait briefly for the port to bind; if it doesn't, surface the log and fail.
for i in {1..50}; do
  if port_in_use "$PORT"; then
    echo "$PID" >"$PID_FILE"
    exit 0
  fi
  sleep 0.2
done

echo "[spawn_gateway] ERROR: gateway did not bind port $PORT (see $LOG)" >&2
# best-effort cleanup
kill "$PID" >/dev/null 2>&1 || true
exit 1
