#!/usr/bin/env bash
set -euo pipefail

# Spawn persistent buyer agents with different shopping behaviors
# Usage: ./lab/spawn_buyer_agents.sh [count]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NUM_BUYERS="${1:-2}"
RUN_ID="live_buyers"
export RUN_ID

OUT_DIR="$ROOT_DIR/runs/live_buyers/out"
mkdir -p "$OUT_DIR"

source "$ROOT_DIR/.local/bootstrap.env"

echo "[spawn_buyer_agents] spawning $NUM_BUYERS persistent buyer agents"

# Buyer personality templates
declare -A BEHAVIORS=(
  [bargain_hunter]="You are a BARGAIN HUNTER. Always try to negotiate at least 20% off. Ask lots of questions about condition/flaws. Start low."
  [impulse_buyer]="You are an IMPULSE BUYER. If the item interests you and price seems reasonable, buy quickly without much negotiation."
  [quality_focused]="You are QUALITY FOCUSED. Will pay asking price if condition is excellent. Ask detailed questions about condition, accessories, proof of purchase."
  [cautious]="You are CAUTIOUS. Take time to decide. Ask many questions. Need reassurance. Willing to walk away if something feels off."
)

BEHAVIOR_KEYS=(bargain_hunter impulse_buyer quality_focused cautious)

# Interests for each buyer
declare -A INTERESTS=(
  [1]="Nintendo Switch, PS5, gaming consoles"
  [2]="MacBook, iPad, Apple products"
  [3]="iPhone, AirPods, smartphones"
  [4]="Gaming PC, computer hardware"
)

for i in $(seq 1 "$NUM_BUYERS"); do
  BEHAVIOR_IDX=$(( (i - 1) % ${#BEHAVIOR_KEYS[@]} ))
  BEHAVIOR_KEY="${BEHAVIOR_KEYS[$BEHAVIOR_IDX]}"
  BEHAVIOR_DESC="${BEHAVIORS[$BEHAVIOR_KEY]}"
  
  INTEREST_IDX=$(( (i - 1) % ${#INTERESTS[@]} + 1 ))
  INTEREST="${INTERESTS[$INTEREST_IDX]}"
  
  PROFILE="live-buyer-$i"
  PORT=$((18810 + i))
  
  echo "[spawn_buyer_agents] buyer $i: interests=($INTEREST) - $BEHAVIOR_KEY"
  
  # Configure Matrix
  openclaw --profile "$PROFILE" config set gateway.mode local >/dev/null 2>&1 || true
  
  # Set model to Claude Sonnet 4.5 (cheaper than Opus, avoid ChatGPT rate limits)
  AGENT_MODEL="${AGENT_MODEL:-anthropic/claude-sonnet-4-5}"
  openclaw --profile "$PROFILE" config set agents.defaults.model.primary "$AGENT_MODEL" >/dev/null 2>&1 || true
  
  ./lab/connect_matrix.sh "$PROFILE" >/dev/null 2>&1
  
  # Set requireMention to false so they can monitor market without being mentioned
  ./lab/set_require_mention.sh "$PROFILE" "$ROOM_ID" false >/dev/null 2>&1
  
  # Spawn gateway
  PROFILE="$PROFILE" PORT="$PORT" RUN_ID="live_buyers" ./lab/spawn_gateway.sh "$PROFILE" >/dev/null 2>&1
  
  # Give mission
  MISSION="PERSISTENT BUYER MISSION:

You are interested in: $INTEREST
Your shopping style: $BEHAVIOR_DESC

Your job:
1. MONITOR #market:localhost continuously
2. When you see a NEW listing for something you're interested in:
   - Wait 30-90 seconds (don't be instant)
   - DM the seller with an opening message
   - Ask relevant questions (condition, accessories, pickup location)
   - Negotiate according to your personality
3. If you agree on a price, confirm: 'DEAL: [price]€. When can I pick it up?'
4. Don't spam - only engage with items you're genuinely interested in
5. If already negotiating with someone, don't start another negotiation simultaneously

Stay active indefinitely. Be natural and conversational."
  
  PROFILE="$PROFILE" RUN_ID="live_buyers" TEXT="$MISSION" ./lab/mission.sh "$PROFILE" >/dev/null 2>&1
  
  sleep 1
done

echo "[spawn_buyer_agents] ✓ spawned $NUM_BUYERS persistent buyers"
echo "[spawn_buyer_agents] gateway logs: $OUT_DIR/gateway_live-buyer-*.log"
echo "[spawn_buyer_agents] to stop: pkill -f 'openclaw.*live-buyer'"
