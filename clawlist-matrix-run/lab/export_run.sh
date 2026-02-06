#!/usr/bin/env bash
set -euo pipefail

# Export market + dm transcripts for a run into runs/<runId>/out/{market.jsonl,dm.jsonl}.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-${1:-}}"
[ -n "$RUN_ID" ] || { echo "usage: export_run.sh <runId>" >&2; exit 2; }

source "$ROOT_DIR/.local/secrets.env"

OUT_DIR="$ROOT_DIR/runs/$RUN_ID/out"
META_JSON="$OUT_DIR/meta.json"
SECRETS_ENV="$OUT_DIR/secrets.env"

[ -f "$META_JSON" ] || { echo "[export_run] ERROR: missing $META_JSON (run create_dm_room.sh first)" >&2; exit 1; }

# Avoid writing any secrets into meta; pass tokens via secrets.env
umask 077
{
  echo "SELLER_TOKEN=$SELLER_TOKEN"
  echo "BUYER_TOKEN=$BUYER_TOKEN"
} >"$SECRETS_ENV"
chmod 600 "$SECRETS_ENV" 2>/dev/null || true

node "$ROOT_DIR/scripts/export_transcripts.mjs" "$OUT_DIR" "$META_JSON" "$SECRETS_ENV"

echo "[export_run] wrote $OUT_DIR/market.jsonl and $OUT_DIR/dm.jsonl"
