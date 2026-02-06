#!/usr/bin/env bash
set -euo pipefail

# Spawn multiple persistent seller agents with different behaviors
# Usage: ./lab/spawn_seller_agents.sh [count]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NUM_SELLERS="${1:-3}"
RUN_ID="live_$(date +%Y%m%d_%H%M%S)"
export RUN_ID

OUT_DIR="$ROOT_DIR/runs/live_sellers/out"
mkdir -p "$OUT_DIR"

source "$ROOT_DIR/.local/bootstrap.env"

echo "[spawn_seller_agents] spawning $NUM_SELLERS persistent seller agents"

# Seller personality templates
declare -A ITEMS=(
  [1]="Nintendo Switch"
  [2]="iPhone 13"
  [3]="PS5"
  [4]="MacBook Air M1"
  [5]="iPad Pro"
  [6]="AirPods Pro"
  [7]="Gaming PC"
  [8]="Mountain Bike"
)

declare -A PRICES=(
  [1]="150"
  [2]="400"
  [3]="450"
  [4]="800"
  [5]="500"
  [6]="150"
  [7]="1200"
  [8]="200"
)

declare -A BEHAVIORS=(
  [firm]="You are a FIRM seller. Never negotiate more than 10% below asking price. Be polite but inflexible."
  [flexible]="You are a FLEXIBLE seller. You want to sell quickly. Willing to negotiate down to 60% of asking price if buyer seems serious."
  [aggressive]="You are an AGGRESSIVE seller. Start high, defend your price strongly. Only drop 5% max. Push buyer to decide quickly."
  [friendly]="You are a FRIENDLY seller. Chatty, helpful, transparent about condition. Willing to negotiate reasonably (down to 70% of asking)."
  [suspicious]="You are a SUSPICIOUS seller. Ask lots of questions about buyer's intent. Slow to commit. Need reassurance before agreeing."
)

BEHAVIOR_KEYS=(firm flexible aggressive friendly suspicious)

for i in $(seq 1 "$NUM_SELLERS"); do
  ITEM_IDX=$(( (i - 1) % ${#ITEMS[@]} + 1 ))
  ITEM="${ITEMS[$ITEM_IDX]}"
  PRICE="${PRICES[$ITEM_IDX]}"
  
  BEHAVIOR_IDX=$(( (i - 1) % ${#BEHAVIOR_KEYS[@]} ))
  BEHAVIOR_KEY="${BEHAVIOR_KEYS[$BEHAVIOR_IDX]}"
  BEHAVIOR_DESC="${BEHAVIORS[$BEHAVIOR_KEY]}"
  
  PROFILE="live-seller-$i"
  PORT=$((18800 + i))
  
  echo "[spawn_seller_agents] seller $i: $ITEM (${PRICE}€) - $BEHAVIOR_KEY"
  
  # Configure Matrix for this profile (all live sellers share @switch_seller:localhost for now)
  openclaw --profile "$PROFILE" config set gateway.mode local >/dev/null 2>&1 || true
  
  # Set model to Claude Sonnet 4.5 (cheaper than Opus, avoid ChatGPT rate limits)
  AGENT_MODEL="${AGENT_MODEL:-anthropic/claude-sonnet-4-5}"
  openclaw --profile "$PROFILE" config set agents.defaults.model.primary "$AGENT_MODEL" >/dev/null 2>&1 || true
  
  # Copy auth profiles from main agent (needed for API keys)
  MAIN_AUTH_FILE="$HOME/.openclaw/agents/main/agent/auth-profiles.json"
  AGENT_AUTH_DIR="$HOME/.openclaw-${PROFILE}/agents/main/agent"
  mkdir -p "$AGENT_AUTH_DIR"
  [ -f "$MAIN_AUTH_FILE" ] && cp "$MAIN_AUTH_FILE" "$AGENT_AUTH_DIR/auth-profiles.json" 2>/dev/null || true
  
  # Enable Matrix plugin
  openclaw --profile "$PROFILE" config set plugins.entries.matrix.enabled true >/dev/null 2>&1
  
  # Configure Matrix channel directly (all live sellers share @switch_seller:localhost for now)
  openclaw --profile "$PROFILE" config set --json 'channels.matrix' \
    "{ enabled: true, homeserver: '${HOMESERVER}', accessToken: '${SELLER_TOKEN}', userId: '${SELLER_MXID}', encryption: false, dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open', groups: { '*': { requireMention: false }, '${ROOM_ID}': { allow: true, requireMention: false } } }" \
    >/dev/null 2>&1
  
  # Note: requireMention already set to false in Matrix config above, no need for separate call
  
  # Spawn gateway
  PROFILE="$PROFILE" PORT="$PORT" RUN_ID="live_sellers" ./lab/spawn_gateway.sh "$PROFILE" >/dev/null 2>&1
  
  # Give mission
  MISSION="PERSISTENT SELLER MISSION:

You are selling: $ITEM
Your asking price: ${PRICE}€
Your personality: $BEHAVIOR_DESC

Your job:
1. Post ONE listing in #market:localhost NOW with format: 'SELLING: $ITEM. Price: ${PRICE}€. [add 1-sentence description]. DM me.'
2. Then MONITOR your DMs. When someone DMs you about this item:
   - Respond within 1 minute
   - Negotiate according to your personality
   - Ask/answer questions about condition, accessories, pickup
   - Try to close a deal or politely decline if price is too low
3. If you successfully agree on a price, confirm: 'DEAL: [price]€. Let me know your pickup time.'
4. Stay active indefinitely - this is a persistent marketplace presence.

Be concise. Use natural language. Don't break character."
  
  PROFILE="$PROFILE" RUN_ID="live_sellers" TEXT="$MISSION" ./lab/mission.sh "$PROFILE" >/dev/null 2>&1
  
  sleep 1
done

echo "[spawn_seller_agents] ✓ spawned $NUM_SELLERS persistent sellers"
echo "[spawn_seller_agents] gateway logs: $OUT_DIR/gateway_live-seller-*.log"
echo "[spawn_seller_agents] to stop: pkill -f 'openclaw.*live-seller'"
