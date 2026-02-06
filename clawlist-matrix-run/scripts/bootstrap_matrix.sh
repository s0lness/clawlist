#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SYNAPSE_DIR="$ROOT_DIR/synapse-data2"

# Local-only secrets cache (gitignored). Used to avoid Synapse login rate limits.
# Override if needed: SECRETS_ENV=/path/to/file
SECRETS_ENV="${SECRETS_ENV:-$ROOT_DIR/.local/secrets.env}"

SELLER_USER="switch_seller"
BUYER_USER="switch_buyer"
SELLER_PASS="SellerPass123!"
BUYER_PASS="BuyerPass123!"

MATRIX_PORT="${MATRIX_PORT:-18008}"
MATRIX_REUSE="${MATRIX_REUSE:-1}"
BOOTSTRAP_MODE="${BOOTSTRAP_MODE:-full}" # full|agents|up

MATRIX_RUN_ID="${MATRIX_RUN_ID:-}" # optional; used for per-run room alias

SYNAPSE_CONTAINER="${SYNAPSE_CONTAINER:-clawlist-synapse}"

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "${SYNAPSE_CONTAINER}"
}

ensure_synapse_config() {
  if [ ! -f "$SYNAPSE_DIR/homeserver.yaml" ]; then
    mkdir -p "$SYNAPSE_DIR"
    echo "[bootstrap] generating synapse config in $SYNAPSE_DIR"
    docker run --rm \
      -u "$(id -u):$(id -g)" \
      -e SYNAPSE_SERVER_NAME=localhost \
      -e SYNAPSE_REPORT_STATS=no \
      -v "$SYNAPSE_DIR:/data" \
      matrixdotorg/synapse:latest generate

    # Make registration easy for local runs
    if ! grep -q "^enable_registration:" "$SYNAPSE_DIR/homeserver.yaml"; then
      echo "enable_registration: true" >> "$SYNAPSE_DIR/homeserver.yaml"
    fi

    if ! grep -q "^enable_registration_without_verification:" "$SYNAPSE_DIR/homeserver.yaml"; then
      echo "enable_registration_without_verification: true" >> "$SYNAPSE_DIR/homeserver.yaml"
    fi
  fi
}

start_synapse_if_needed() {
  ensure_synapse_config

  if container_running; then
    if [ "$MATRIX_REUSE" = "1" ]; then
      echo "[bootstrap] synapse already running (reuse=1) container=${SYNAPSE_CONTAINER}"
      return 0
    fi
    echo "[bootstrap] replacing existing synapse container (reuse=0) container=${SYNAPSE_CONTAINER}"
    docker rm -f "${SYNAPSE_CONTAINER}" >/dev/null 2>&1 || true
  fi

  echo "[bootstrap] starting synapse on port ${MATRIX_PORT} (container=${SYNAPSE_CONTAINER})"
  docker run -d \
    --name "${SYNAPSE_CONTAINER}" \
    -p "${MATRIX_PORT}:8008" \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    -v "$SYNAPSE_DIR:/data" \
    matrixdotorg/synapse:latest >/dev/null
}

wait_for_synapse() {
  echo "[bootstrap] waiting for synapse to respond on port ${MATRIX_PORT}"
  for i in {1..60}; do
    if curl -fsS "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/versions" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "synapse did not become ready" >&2
  return 1
}

create_users() {
  echo "[bootstrap] creating users (ignore 'User ID already taken')"
  docker exec -i "${SYNAPSE_CONTAINER}" register_new_matrix_user \
    -c /data/homeserver.yaml http://127.0.0.1:8008 \
    -u "$SELLER_USER" -p "$SELLER_PASS" --no-admin || true

  docker exec -i "${SYNAPSE_CONTAINER}" register_new_matrix_user \
    -c /data/homeserver.yaml http://127.0.0.1:8008 \
    -u "$BUYER_USER" -p "$BUYER_PASS" --no-admin || true
}

login() {
  local base="http://127.0.0.1:${MATRIX_PORT}"

  # Load cached tokens if present
  if [ -f "$SECRETS_ENV" ]; then
    # shellcheck disable=SC1090
    source "$SECRETS_ENV" || true
  fi

  token_ok() {
    local token="$1"
    [ -n "${token:-}" ] || return 1
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer ${token}" \
      "${base}/_matrix/client/v3/account/whoami" || true)
    [ "$code" = "200" ]
  }

  if token_ok "${SELLER_TOKEN:-}" && token_ok "${BUYER_TOKEN:-}"; then
    echo "[bootstrap] using cached matrix tokens from $SECRETS_ENV" >&2
    export SELLER_TOKEN BUYER_TOKEN
    return 0
  fi

  echo "[bootstrap] logging in" >&2

  # Synapse can rate-limit rapid repeated logins during dev runs.
  # Handle 429 with exponential backoff.
  login_one() {
    local user="$1" pass="$2" label="$3"
    local payload
    payload='{"type":"m.login.password","identifier":{"type":"m.id.user","user":"'"${user}"'"},"password":"'"${pass}"'"}'

    local attempt=1 max_attempts=8 sleep_s=1
    local tmp
    tmp="$(mktemp)"
    while [ "$attempt" -le "$max_attempts" ]; do
      local code
      code=$(curl -sS -o "$tmp" -w "%{http_code}" -X POST "${base}/_matrix/client/v3/login" \
        -H 'Content-Type: application/json' \
        -d "$payload" || true)

      if [ "$code" = "200" ]; then
        cat "$tmp"
        rm -f "$tmp"
        return 0
      fi

      if [ "$code" = "429" ]; then
        local ra
        ra=$(node -e 'try{const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.retry_after_ms||""))}catch{process.stdout.write("")}' "$(cat "$tmp")" 2>/dev/null || true)
        if [ -n "$ra" ]; then
          # cap to 60s so we don't hang forever in dev; user can rerun later
          local ra_s=$(( (ra + 999) / 1000 ))
          if [ "$ra_s" -gt 60 ]; then ra_s=60; fi
          sleep_s="$ra_s"
        fi
        echo "[bootstrap] ${label} login rate-limited (429). retrying in ${sleep_s}s (attempt ${attempt}/${max_attempts})" >&2
        sleep "$sleep_s"
        # backoff after the server hint too
        sleep_s=$((sleep_s * 2))
        if [ "$sleep_s" -gt 60 ]; then sleep_s=60; fi
        attempt=$((attempt + 1))
        continue
      fi

      echo "[bootstrap] ${label} login failed (http ${code}). body:" >&2
      cat "$tmp" >&2 || true
      rm -f "$tmp"
      return 1
    done

    echo "[bootstrap] ${label} login failed after ${max_attempts} attempts" >&2
    cat "$tmp" >&2 || true
    rm -f "$tmp"
    return 1
  }

  local seller_login buyer_login
  seller_login="$(login_one "$SELLER_USER" "$SELLER_PASS" seller)"
  buyer_login="$(login_one "$BUYER_USER" "$BUYER_PASS" buyer)"

  SELLER_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.access_token||"")' "$seller_login")
  BUYER_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.access_token||"")' "$buyer_login")

  if [ -z "${SELLER_TOKEN:-}" ] || [ -z "${BUYER_TOKEN:-}" ]; then
    echo "failed to get access tokens" >&2
    exit 1
  fi

  # Cache for next runs
  mkdir -p "$(dirname "$SECRETS_ENV")"
  umask 077
  {
    echo "SELLER_TOKEN=$SELLER_TOKEN"
    echo "BUYER_TOKEN=$BUYER_TOKEN"
  } >"$SECRETS_ENV"
  chmod 600 "$SECRETS_ENV" 2>/dev/null || true

  export SELLER_TOKEN BUYER_TOKEN
}

ensure_room() {
  local room_alias room_name room_alias_name

  if [ -n "$MATRIX_RUN_ID" ]; then
    room_alias="#market-${MATRIX_RUN_ID}:localhost"
    room_name="market-${MATRIX_RUN_ID}"
    room_alias_name="market-${MATRIX_RUN_ID}"
  else
    room_alias="#market:localhost"
    room_name="market"
    room_alias_name="market"
  fi

  echo "[bootstrap] creating (or reusing) market room alias=${room_alias}"

  local create_room room_id encoded_alias resolve
  create_room=$(curl -fsS -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/createRoom" \
    -H "Authorization: Bearer $SELLER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{
      "preset":"public_chat",
      "name":"'"$room_name"'",
      "room_alias_name":"'"$room_alias_name"'",
      "topic":"clawlist market run",
      "visibility":"public"
    }' || true)

  room_id=$(node -e 'try{const x=JSON.parse(process.argv[1]); process.stdout.write(x.room_id||"")}catch{process.stdout.write("")}' "$create_room")

  if [ -z "$room_id" ]; then
    encoded_alias=$(node -p 'encodeURIComponent(process.argv[1])' "$room_alias")
    resolve=$(curl -fsS "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/directory/room/${encoded_alias}")
    room_id=$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.room_id||"")' "$resolve")
  fi

  if [ -z "$room_id" ]; then
    echo "failed to create/resolve market room" >&2
    echo "$create_room" >&2
    exit 1
  fi

  ROOM_ID="$room_id"
  ROOM_ALIAS="$room_alias"
  export ROOM_ID ROOM_ALIAS
}

ensure_membership() {
  echo "[bootstrap] inviting/joining buyer"
  BUYER_MXID="@${BUYER_USER}:localhost"
  SELLER_MXID="@${SELLER_USER}:localhost"
  export BUYER_MXID SELLER_MXID

  curl -fsS -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/rooms/${ROOM_ID}/invite" \
    -H "Authorization: Bearer $SELLER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"user_id":"'"$BUYER_MXID"'"}' >/dev/null || true

  curl -fsS -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/rooms/${ROOM_ID}/join" \
    -H "Authorization: Bearer $BUYER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{}' >/dev/null || true
}

if [ "$BOOTSTRAP_MODE" = "up" ]; then
  start_synapse_if_needed
  wait_for_synapse
  echo "MATRIX_PORT=$MATRIX_PORT"
  echo "HOMESERVER=http://127.0.0.1:${MATRIX_PORT}"
  exit 0
fi

if [ "$BOOTSTRAP_MODE" = "agents" ]; then
  # Assume synapse is already running and reachable.
  wait_for_synapse
  create_users
  login
  ensure_room
  ensure_membership
else
  start_synapse_if_needed
  wait_for_synapse
  create_users
  login
  ensure_room
  ensure_membership
fi

# Print shell-friendly exports for the caller (run.sh)
echo "MATRIX_PORT=$MATRIX_PORT"
echo "HOMESERVER=http://127.0.0.1:${MATRIX_PORT}"
echo "ROOM_ID=$ROOM_ID"
echo "ROOM_ALIAS=$ROOM_ALIAS"
echo "SELLER_TOKEN=$SELLER_TOKEN"
echo "BUYER_TOKEN=$BUYER_TOKEN"
echo "SELLER_MXID=@${SELLER_USER}:localhost"
echo "BUYER_MXID=@${BUYER_USER}:localhost"
