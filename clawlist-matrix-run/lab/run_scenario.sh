#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCENARIO="${SCENARIO:-${1:-}}"
[ -n "$SCENARIO" ] || { echo "usage: run_scenario.sh <scenarioName>" >&2; exit 2; }

SCEN_PATH="$ROOT_DIR/scenarios/${SCENARIO}.json"
[ -f "$SCEN_PATH" ] || { echo "[run_scenario] ERROR: missing $SCEN_PATH" >&2; exit 1; }

RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
export RUN_ID

# Read scenario fields (no jq dependency)
node "$ROOT_DIR/lab/scenario_to_env.mjs" "$SCEN_PATH" >"$ROOT_DIR/.local/scenario.env"

# shellcheck disable=SC1090
source "$ROOT_DIR/.local/scenario.env"

# Respect explicit env override of DURATION_SEC if provided.
DURATION_SEC="${DURATION_SEC:-${SCEN_DURATION_SEC:-120}}"

# Cleanup + bootstrap
./lab/cleanup_ports.sh >/dev/null || true
./lab/bootstrap.sh >/dev/null

# Ensure seller/buyer profiles are ready and connected to matrix (mention gated)
openclaw --profile "$SELLER_PROFILE" config set gateway.mode local >/dev/null 2>&1 || true
openclaw --profile "$BUYER_PROFILE"  config set gateway.mode local >/dev/null 2>&1 || true
openclaw --profile "$SELLER_PROFILE" plugins enable matrix >/dev/null 2>&1 || true
openclaw --profile "$BUYER_PROFILE"  plugins enable matrix >/dev/null 2>&1 || true

# connect_matrix currently assumes switch-seller/switch-buyer; keep for now
./lab/connect_matrix.sh "$SELLER_PROFILE"
./lab/connect_matrix.sh "$BUYER_PROFILE"

# Spawn gateways
PORT=18791 TOKEN=token-switch-seller ./lab/spawn_gateway.sh "$SELLER_PROFILE"
PORT=18793 TOKEN=token-switch-buyer  ./lab/spawn_gateway.sh "$BUYER_PROFILE"

# Create per-run DM room
./lab/create_dm_room.sh "$RUN_ID"
DM_ROOM_ID=$(node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(m.dmRoomId||"")' "$ROOT_DIR/runs/$RUN_ID/out/meta.json" 2>/dev/null || true)

# Missions
./lab/mission.sh "$SELLER_PROFILE" "MISSION: You are SWITCH_SELLER. You are selling a Nintendo Switch. Anchor price: ${SELLER_ANCHOR}€. Absolute floor: ${SELLER_FLOOR}€. You may negotiate down, but never below ${SELLER_FLOOR}€. Post ONE listing in the market room now. When contacted in DM, negotiate for up to 8 turns. Be concise. Run id: ${RUN_ID}. DM room id: ${DM_ROOM_ID}"
./lab/mission.sh "$BUYER_PROFILE" "MISSION: You are SWITCH_BUYER. You want to buy a Nintendo Switch. Max budget: ${BUYER_CEIL}€. Start offer: ${BUYER_START}€. You can go up to ${BUYER_CEIL}€. Watch the market room; when you see a Switch listing, DM the seller within 1 minute. Negotiate for up to 8 turns. Ask condition + accessories + pickup/shipping. Be concise. Run id: ${RUN_ID}. DM room id: ${DM_ROOM_ID}"

# Nudge buyer (mention-gating safe)
./lab/mission.sh "$BUYER_PROFILE" "NUDGE: Go to #market:localhost now, find the latest listing with RUN_ID:${RUN_ID}, and DM the seller immediately." || true

# Seed listing
BODY=$(echo "$SEED_TEMPLATE" | sed "s/{RUN_ID}/${RUN_ID}/g")
RUN_ID="$RUN_ID" BODY="$BODY" ./lab/seed_market.sh

# Let them run
sleep "$DURATION_SEC" || true

# Stop
./lab/stop_gateway.sh "$SELLER_PROFILE" "$RUN_ID" || true
./lab/stop_gateway.sh "$BUYER_PROFILE" "$RUN_ID" || true

# Export + score
./lab/export_run.sh "$RUN_ID" || true
./lab/score.sh "$RUN_ID" || true

echo "[run_scenario] done: scenario=$SCENARIO run_id=$RUN_ID"
echo "[run_scenario] summary: $ROOT_DIR/runs/$RUN_ID/out/summary.json"
