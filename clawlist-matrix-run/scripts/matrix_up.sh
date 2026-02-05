#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TIMEOUT_BIN="$(command -v timeout || true)"
run_timeout() {
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" 60s "$@"
  else
    "$@"
  fi
}

# Keep defaults aligned with bootstrap scripts.
SYNAPSE_DIR="${SYNAPSE_DIR:-$ROOT_DIR/synapse-data2}"
MATRIX_PORT="${MATRIX_PORT:-18008}"

# Generate synapse config once
if [ ! -f "$SYNAPSE_DIR/homeserver.yaml" ]; then
  mkdir -p "$SYNAPSE_DIR"
  echo "[matrix_up] generating synapse config in $SYNAPSE_DIR" >&2
  run_timeout docker run --rm \
    -u "$(id -u):$(id -g)" \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    -v "$SYNAPSE_DIR:/data" \
    matrixdotorg/synapse:latest generate

  if ! grep -q "^enable_registration:" "$SYNAPSE_DIR/homeserver.yaml"; then
    echo "enable_registration: true" >> "$SYNAPSE_DIR/homeserver.yaml"
  fi
  if ! grep -q "^enable_registration_without_verification:" "$SYNAPSE_DIR/homeserver.yaml"; then
    echo "enable_registration_without_verification: true" >> "$SYNAPSE_DIR/homeserver.yaml"
  fi
fi

# Ensure Synapse container can read/write its data directory
run_timeout docker run --rm \
  -v "$SYNAPSE_DIR:/data" \
  --entrypoint /bin/sh \
  matrixdotorg/synapse:latest -c "chown -R 991:991 /data" >/dev/null

if docker ps --format '{{.Names}}' | grep -qx 'clawlist-synapse'; then
  echo "[matrix_up] synapse already running" >&2
else
  echo "[matrix_up] starting synapse on port ${MATRIX_PORT}" >&2
  docker rm -f clawlist-synapse >/dev/null 2>&1 || true
  run_timeout docker run -d \
    --name clawlist-synapse \
    -p "${MATRIX_PORT}:8008" \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    -v "$SYNAPSE_DIR:/data" \
    matrixdotorg/synapse:latest >/dev/null
fi

# Wait for readiness (two consecutive successes)
stable=0
for i in {1..120}; do
  if curl -fsS --max-time 5 "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/versions" >/dev/null; then
    stable=$((stable + 1))
    if [ "$stable" -ge 2 ]; then
      break
    fi
  else
    stable=0
  fi
  sleep 1
  if [ "$i" -eq 120 ]; then
    echo "[matrix_up] synapse did not become ready" >&2
    exit 1
  fi
done

echo "[matrix_up] ready" >&2

echo "MATRIX_PORT=$MATRIX_PORT"
echo "HOMESERVER=http://127.0.0.1:${MATRIX_PORT}"
