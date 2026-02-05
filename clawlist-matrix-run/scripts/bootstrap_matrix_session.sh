#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SELLER_USER="switch_seller"
BUYER_USER="switch_buyer"
SELLER_PASS="SellerPass123!"
BUYER_PASS="BuyerPass123!"

TIMEOUT_BIN="$(command -v timeout || true)"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
CURL_RETRIES="${CURL_RETRIES:-10}"

run_timeout() {
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" 60s "$@"
  else
    "$@"
  fi
}

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

MATRIX_PORT="${MATRIX_PORT:-18008}"

# Require synapse up
if ! curl -fsS --max-time 3 "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/versions" >/dev/null; then
  echo "[bootstrap_session] synapse not reachable on port ${MATRIX_PORT}. Run scripts/matrix_up.sh first." >&2
  exit 1
fi

# Ensure users exist (idempotent-ish)
run_timeout docker exec clawlist-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://127.0.0.1:8008 \
  -u "$SELLER_USER" -p "$SELLER_PASS" --no-admin >/dev/null 2>&1 || true

run_timeout docker exec clawlist-synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://127.0.0.1:8008 \
  -u "$BUYER_USER" -p "$BUYER_PASS" --no-admin >/dev/null 2>&1 || true

# Login
SELLER_LOGIN=$(curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"'"$SELLER_USER"'"},"password":"'"$SELLER_PASS"'"}')
BUYER_LOGIN=$(curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"'"$BUYER_USER"'"},"password":"'"$BUYER_PASS"'"}')

SELLER_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.access_token||"")' "$SELLER_LOGIN")
BUYER_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.access_token||"")' "$BUYER_LOGIN")

if [ -z "$SELLER_TOKEN" ] || [ -z "$BUYER_TOKEN" ]; then
  echo "[bootstrap_session] failed to get access tokens" >&2
  echo "SELLER_LOGIN=$SELLER_LOGIN" >&2
  echo "BUYER_LOGIN=$BUYER_LOGIN" >&2
  exit 1
fi

# Per-run room alias
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

# Create room (best-effort)
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
  echo "[bootstrap_session] failed to create/resolve market room" >&2
  echo "$CREATE_ROOM" >&2
  exit 1
fi

# Invite/join buyer (idempotent-ish)
BUYER_MXID="@${BUYER_USER}:localhost"
curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/rooms/${ROOM_ID}/invite" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"'"$BUYER_MXID"'"}' >/dev/null || true

curl_retry -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/rooms/${ROOM_ID}/join" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' >/dev/null || true

# Emit shell-friendly exports
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
