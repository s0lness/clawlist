#!/usr/bin/env bash
set -euo pipefail

# Create a dedicated per-run DM room and record it in runs/<runId>/out/meta.json.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/.local/bootstrap.env"
source "$ROOT_DIR/.local/secrets.env"

HS="${HOMESERVER:-http://127.0.0.1:18008}"
RUN_ID="${RUN_ID:-${1:-}}"
[ -n "$RUN_ID" ] || { echo "usage: create_dm_room.sh <runId>" >&2; exit 2; }

OUT_DIR="$ROOT_DIR/runs/$RUN_ID/out"
mkdir -p "$OUT_DIR"
META_JSON="$OUT_DIR/meta.json"

# Create a private room, invite buyer, join buyer.
create=$(curl -fsS -X POST "$HS/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "preset":"private_chat",
    "name":"dm-'"$RUN_ID"'",
    "topic":"clawlist dm run '"$RUN_ID"'",
    "invite":["'"$BUYER_MXID"'"],
    "is_direct": true
  }')

DM_ROOM_ID=$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.room_id||"")' "$create")
[ -n "$DM_ROOM_ID" ] || { echo "[create_dm_room] ERROR: failed to create room: $create" >&2; exit 1; }

# Ask buyer to join (best-effort)
curl -fsS -X POST "$HS/_matrix/client/v3/rooms/${DM_ROOM_ID}/join" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' >/dev/null || true

# Write/merge meta.json
startedAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
META_JSON="$META_JSON" RUN_ID="$RUN_ID" HS="$HS" ROOM_ID="$ROOM_ID" DM_ROOM_ID="$DM_ROOM_ID" SELLER_MXID="$SELLER_MXID" BUYER_MXID="$BUYER_MXID" STARTED_AT="$startedAt" \
node - <<'NODE'
const fs = require('fs');

const metaPath = process.env.META_JSON;
const runId = process.env.RUN_ID;
const homeserver = process.env.HS;
const marketRoomId = process.env.ROOM_ID;
const dmRoomId = process.env.DM_ROOM_ID;
const sellerMxid = process.env.SELLER_MXID;
const buyerMxid = process.env.BUYER_MXID;
const startedAt = process.env.STARTED_AT;

if (!metaPath) throw new Error('META_JSON not set');

let meta = {};
if (fs.existsSync(metaPath)) {
  try { meta = JSON.parse(fs.readFileSync(metaPath,'utf8')); } catch {}
}
meta.runId = runId;
meta.homeserver = homeserver;
meta.marketRoomId = marketRoomId;
meta.dmRoomId = dmRoomId;
meta.seller = meta.seller || {}; meta.seller.mxid = sellerMxid;
meta.buyer = meta.buyer || {}; meta.buyer.mxid = buyerMxid;
meta.startedAt = meta.startedAt || startedAt;

fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
NODE

echo "[create_dm_room] dmRoomId=$DM_ROOM_ID"
