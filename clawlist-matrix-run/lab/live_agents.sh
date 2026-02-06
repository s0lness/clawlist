#!/usr/bin/env bash
set -euo pipefail

# Manage live marketplace agents
# Usage: ./lab/live_agents.sh [start|stop|status|restart] [sellers=N] [buyers=N]
# Env: AGENT_MODEL=anthropic/claude-sonnet-4-5 (default)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ACTION="${1:-status}"
NUM_SELLERS="${2:-3}"
NUM_BUYERS="${3:-2}"
export AGENT_MODEL="${AGENT_MODEL:-anthropic/claude-sonnet-4-5}"

case "$ACTION" in
  start)
    echo "[live_agents] starting marketplace agents (sellers=$NUM_SELLERS, buyers=$NUM_BUYERS)"
    ./lab/spawn_seller_agents.sh "$NUM_SELLERS"
    ./lab/spawn_buyer_agents.sh "$NUM_BUYERS"
    echo "[live_agents] ✓ agents are running"
    ;;
    
  stop)
    echo "[live_agents] stopping all live agents..."
    pkill -f 'openclaw.*live-seller' || echo "[live_agents] no seller agents running"
    pkill -f 'openclaw.*live-buyer' || echo "[live_agents] no buyer agents running"
    echo "[live_agents] ✓ agents stopped"
    ;;
    
  restart)
    "$0" stop
    sleep 2
    "$0" start "$NUM_SELLERS" "$NUM_BUYERS"
    ;;
    
  status)
    echo "=== Live Marketplace Agents ==="
    echo
    
    if pgrep -f 'openclaw.*live-seller' >/dev/null 2>&1; then
      SELLER_COUNT=$(pgrep -c 'openclaw.*live-seller')
      echo "✓ Sellers: $SELLER_COUNT running"
    else
      echo "✗ Sellers: not running"
    fi
    
    echo
    
    if pgrep -f 'openclaw.*live-buyer' >/dev/null 2>&1; then
      BUYER_COUNT=$(pgrep -c 'openclaw.*live-buyer')
      echo "✓ Buyers: $BUYER_COUNT running"
    else
      echo "✗ Buyers: not running"
    fi
    
    echo
    echo "Start:   ./lab/live_agents.sh start [sellers=3] [buyers=2]"
    echo "Stop:    ./lab/live_agents.sh stop"
    echo "Restart: ./lab/live_agents.sh restart"
    ;;
    
  *)
    echo "usage: $0 [start|stop|status|restart] [num_sellers] [num_buyers]" >&2
    exit 1
    ;;
esac
