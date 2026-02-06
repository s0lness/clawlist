#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${PROFILE:-${1:-}}"
TEXT="${TEXT:-${2:-}}"
[ -n "$PROFILE" ] || { echo "usage: mission.sh <profile> <text>" >&2; exit 2; }
[ -n "$TEXT" ] || { echo "usage: mission.sh <profile> <text>" >&2; exit 2; }

RUN_ID="${RUN_ID:-dev}"
PORT_FILE="$ROOT_DIR/runs/${RUN_ID}/out/gateway_${PROFILE}.port"
[ -f "$PORT_FILE" ] || { echo "[mission] ERROR: missing $PORT_FILE (run spawn_gateway first)" >&2; exit 1; }
PORT=$(cat "$PORT_FILE")
TOKEN="${TOKEN:-token-${PROFILE}}"

openclaw --profile "$PROFILE" system event \
  --url "ws://127.0.0.1:${PORT}" \
  --token "$TOKEN" \
  --mode now \
  --text "$TEXT" \
  >/dev/null

echo "[mission] sent to profile=$PROFILE port=$PORT"
