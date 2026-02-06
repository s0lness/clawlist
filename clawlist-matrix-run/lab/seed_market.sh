#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/.local/bootstrap.env"
source "$ROOT_DIR/.local/secrets.env"

HS="${HOMESERVER:-http://127.0.0.1:18008}"
ROOM_ID="${ROOM_ID:?missing ROOM_ID}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
BODY="${BODY:-RUN_ID:${RUN_ID} SELLING: nintendo switch — asking 200€ (can negotiate). DM me.}"

curl -fsS -X PUT "$HS/_matrix/client/v3/rooms/${ROOM_ID}/send/m.room.message/txn${RUN_ID}" \
  -H "Authorization: Bearer ${SELLER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"msgtype":"m.text","body":"'"$BODY"'"}' \
  >/dev/null

echo "[seed_market] posted to $ROOM_ID"
