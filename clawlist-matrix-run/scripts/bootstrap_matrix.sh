#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Where Synapse persists its state.
# Set SYNAPSE_DIR to isolate runs (recommended), e.g. runs/<run_id>/synapse-data
SYNAPSE_DIR="${SYNAPSE_DIR:-$ROOT_DIR/synapse-data2}"
# docker-compose is not required; we use plain `docker run`.

SELLER_USER="switch_seller"
BUYER_USER="switch_buyer"
SELLER_PASS="SellerPass123!"
BUYER_PASS="BuyerPass123!"

TIMEOUT_BIN="$(command -v timeout || true)"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
CURL_RETRIES="${CURL_RETRIES:-10}"

curl_retry() {
  local args=("$@")
  local attempt=1
  while [ "$attempt" -le "$CURL_RETRIES" ]; do
    if curl -fsS --max-time "$CURL_MAX_TIME" "${args[@]}"; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

run_timeout() {
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" 60s "$@"
  else
    "$@"
  fi
}

# Generate synapse config once
if [ ! -f "$SYNAPSE_DIR/homeserver.yaml" ]; then
  mkdir -p "$SYNAPSE_DIR"
  echo "[bootstrap] generating synapse config in $SYNAPSE_DIR"
  run_timeout docker run --rm \
    -u "$(id -u):$(id -g)" \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    -v "$SYNAPSE_DIR:/data" \
    matrixdotorg/synapse:latest generate

  # Make registration easy for local runs
  # (Synapse image uses YAML; keep it minimal)
  if ! grep -q "^enable_registration:" "$SYNAPSE_DIR/homeserver.yaml"; then
    echo "enable_registration: true" >> "$SYNAPSE_DIR/homeserver.yaml"
  fi

  # Loosen CAPTCHA / 3PID requirements for local
  if ! grep -q "^enable_registration_without_verification:" "$SYNAPSE_DIR/homeserver.yaml"; then
    echo "enable_registration_without_verification: true" >> "$SYNAPSE_DIR/homeserver.yaml"
  fi
fi

# Ensure Synapse container can read/write its data directory
echo "[bootstrap] fixing synapse data permissions"
run_timeout docker run --rm \
  -v "$SYNAPSE_DIR:/data" \
  --entrypoint /bin/sh \
  matrixdotorg/synapse:latest -c "chown -R 991:991 /data"

MATRIX_PORT="${MATRIX_PORT:-18008}"

# Start (or reuse) synapse

echo "[bootstrap] starting synapse"
MATRIX_REUSE="${MATRIX_REUSE:-0}"

if [ "$MATRIX_REUSE" = "1" ] && docker ps --format '{{.Names}}' | grep -qx 'clawlist-synapse'; then
  echo "[bootstrap] reusing existing synapse container" >&2
else
  # If an old container exists, replace it (local-only, safe)
  docker rm -f clawlist-synapse >/dev/null 2>&1 || true

  run_timeout docker run -d \
    --name clawlist-synapse \
    -p "${MATRIX_PORT}:8008" \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    -v "$SYNAPSE_DIR:/data" \
    matrixdotorg/synapse:latest >/dev/null
fi

# Wait for HTTP

echo "[bootstrap] waiting for synapse to respond on port ${MATRIX_PORT}"
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
    echo "synapse did not become ready" >&2
    exit 1
  fi
done

# Create users (idempotent-ish)

echo "[bootstrap] creating users (ignore 'User ID already taken')"
# NOTE: don't pass -i here. In some environments (WSL/VS Code terminals) `docker exec -i`
# can end up in a stopped state, hanging the whole bootstrap.
run_timeout docker exec clawlist-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://127.0.0.1:8008 \
  -u "$SELLER_USER" -p "$SELLER_PASS" --no-admin || true

run_timeout docker exec clawlist-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://127.0.0.1:8008 \
  -u "$BUYER_USER" -p "$BUYER_PASS" --no-admin || true

# Login and create room

echo "[bootstrap] waiting for synapse (post-user creation)"
stable=0
for i in {1..60}; do
  if curl -fsS --max-time 5 "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/versions" >/dev/null; then
    stable=$((stable + 1))
    if [ "$stable" -ge 2 ]; then
      break
    fi
  else
    stable=0
  fi
  sleep 1
done

echo "[bootstrap] logging in"
SELLER_LOGIN=$(curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"'"$SELLER_USER"'"},"password":"'"$SELLER_PASS"'"}')
BUYER_LOGIN=$(curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"'"$BUYER_USER"'"},"password":"'"$BUYER_PASS"'"}')

SELLER_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.access_token||"")' "$SELLER_LOGIN")
BUYER_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.access_token||"")' "$BUYER_LOGIN")

if [ -z "$SELLER_TOKEN" ] || [ -z "$BUYER_TOKEN" ]; then
  echo "failed to get access tokens" >&2
  echo "SELLER_LOGIN=$SELLER_LOGIN" >&2
  echo "BUYER_LOGIN=$BUYER_LOGIN" >&2
  exit 1
fi

# Create market room (seller creates)

echo "[bootstrap] creating (or reusing) market room"
# Try to find an existing room by alias; if not, create and set alias.
ROOM_SUFFIX="${MATRIX_RUN_ID:-}"
if [ -n "$ROOM_SUFFIX" ]; then
  ROOM_ALIAS="#market-${ROOM_SUFFIX}:localhost"
  ROOM_ALIAS_NAME="market-${ROOM_SUFFIX}"
  ROOM_NAME="market-${ROOM_SUFFIX}"
else
  ROOM_ALIAS="#market:localhost"
  ROOM_ALIAS_NAME="market"
  ROOM_NAME="market"
fi

# Create room (best-effort; will fall back to alias resolution)
CREATE_ROOM=$(curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "preset":"public_chat",
    "name":"'"$ROOM_NAME"'",
    "room_alias_name":"'"$ROOM_ALIAS_NAME"'",
    "topic":"clawlist market run '"${ROOM_SUFFIX:-}"'",
    "visibility":"public"
  }' || true)

ROOM_ID=$(node -e 'try{const x=JSON.parse(process.argv[1]); console.log(x.room_id||"")}catch{console.log("")}' "$CREATE_ROOM")

# If create failed (already exists), resolve alias
if [ -z "$ROOM_ID" ]; then
  ENCODED_ALIAS=$(node -p 'encodeURIComponent(process.argv[1])' "$ROOM_ALIAS")
  RESOLVE=$(curl_retry "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/directory/room/${ENCODED_ALIAS}")
  ROOM_ID=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.room_id||"")' "$RESOLVE")
fi

if [ -z "$ROOM_ID" ]; then
  echo "failed to create/resolve market room" >&2
  echo "$CREATE_ROOM" >&2
  exit 1
fi

# Invite buyer

echo "[bootstrap] inviting buyer to market room"
BUYER_MXID="@${BUYER_USER}:localhost"
curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/rooms/${ROOM_ID}/invite" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"'"$BUYER_MXID"'"}' >/dev/null || true

# Buyer join
curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/rooms/${ROOM_ID}/join" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' >/dev/null || true

# Emit meta to stdout as JSON
node - <<'NODE'
const fs = require('fs');
const meta = {
  homeserver: 'http://127.0.0.1:8008',
  serverName: 'localhost',
  roomAlias: '#market:localhost',
  // values are injected by bash via env in run.sh; here just a placeholder
};
console.log(JSON.stringify(meta));
NODE

# And also print shell-friendly exports
echo "ROOM_ID=$ROOM_ID"
echo "ROOM_ALIAS=$ROOM_ALIAS"
echo "SELLER_MXID=@${SELLER_USER}:localhost"
echo "BUYER_MXID=@${BUYER_USER}:localhost"

if [ -n "${BOOTSTRAP_SECRETS_FILE:-}" ]; then
  cat >"$BOOTSTRAP_SECRETS_FILE" <<EOF
SELLER_TOKEN=$SELLER_TOKEN
BUYER_TOKEN=$BUYER_TOKEN
EOF
  chmod 600 "$BOOTSTRAP_SECRETS_FILE"
fi
