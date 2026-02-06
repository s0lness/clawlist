#!/usr/bin/env bash
set -euo pipefail

# Minimal orchestrator for the stable #market:localhost room.
# Phase 3 MVP: spawn seller+buyer gateways, connect to matrix, inject missions, seed listing.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
export RUN_ID

# Ensure matrix bootstrap artifacts exist
[ -f "$ROOT_DIR/.local/bootstrap.env" ] || { echo "[run_scenario_basic] missing .local/bootstrap.env; run lab/bootstrap.sh" >&2; exit 1; }
[ -f "$ROOT_DIR/.local/secrets.env" ] || { echo "[run_scenario_basic] missing .local/secrets.env; run lab/bootstrap.sh" >&2; exit 1; }

mkdir -p "$ROOT_DIR/runs/$RUN_ID/out"

# Prepare profiles
openclaw --profile switch-seller config set gateway.mode local >/dev/null 2>&1 || true
openclaw --profile switch-buyer  config set gateway.mode local >/dev/null 2>&1 || true
openclaw --profile switch-seller plugins enable matrix >/dev/null 2>&1 || true
openclaw --profile switch-buyer  plugins enable matrix >/dev/null 2>&1 || true

# Connect Matrix
./lab/connect_matrix.sh switch-seller
./lab/connect_matrix.sh switch-buyer

# Spawn gateways (explicit ports to avoid collisions with the main gateway on 18789)
PORT=18791 TOKEN=token-switch-seller ./lab/spawn_gateway.sh switch-seller
PORT=18793 TOKEN=token-switch-buyer  ./lab/spawn_gateway.sh switch-buyer

# Inject missions
./lab/mission.sh switch-seller "MISSION: You are SWITCH_SELLER. You are selling a Nintendo Switch. Anchor price: 200€. Absolute floor: 150€. Post ONE listing in the market room now. When contacted in DM, negotiate for up to 8 turns. Be concise. Run id: ${RUN_ID}."
./lab/mission.sh switch-buyer "MISSION: You are SWITCH_BUYER. You want to buy a Nintendo Switch. Max budget: 150€. Start offer: 120€. You can go up to 150€. Watch the market room; when you see a Switch listing, DM the seller within 1 minute. Negotiate for up to 8 turns. Ask condition + accessories + pickup/shipping. Be concise. Run id: ${RUN_ID}."

# Seed listing
./lab/seed_market.sh

echo "[run_scenario_basic] started run_id=$RUN_ID"

echo "[run_scenario_basic] tip: open Element and join #market:localhost"
