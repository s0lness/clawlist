#!/usr/bin/env bash
set -euo pipefail

# Configure the Matrix channel for a profile using tokens from .local/bootstrap.env/.local/secrets.env.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${PROFILE:-${1:-}}"
[ -n "$PROFILE" ] || { echo "usage: connect_matrix.sh <profile>" >&2; exit 2; }

source "$ROOT_DIR/.local/bootstrap.env"
source "$ROOT_DIR/.local/secrets.env"

HOMESERVER="${HOMESERVER:-http://127.0.0.1:18008}"
ROOM_ID="${ROOM_ID:?missing ROOM_ID}"

case "$PROFILE" in
  switch-seller)
    ACCESS_TOKEN="$SELLER_TOKEN"; USER_ID="$SELLER_MXID";;
  switch-buyer)
    ACCESS_TOKEN="$BUYER_TOKEN"; USER_ID="$BUYER_MXID";;
  *)
    echo "[connect_matrix] ERROR: unknown profile '$PROFILE' (expected switch-seller or switch-buyer)" >&2
    exit 1;;
esac

# Mention-gating defaults: off for now; we can tighten later.
openclaw --profile "$PROFILE" config set --json 'channels.matrix' \
  "{ enabled: true, homeserver: '${HOMESERVER}', accessToken: '${ACCESS_TOKEN}', userId: '${USER_ID}', encryption: false, dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open', groups: { '*': { requireMention: false }, '${ROOM_ID}': { allow: true, requireMention: false } } }" \
  >/dev/null

echo "[connect_matrix] configured profile=$PROFILE user=$USER_ID room=$ROOM_ID"
