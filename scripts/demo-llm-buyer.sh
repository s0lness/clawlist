#!/usr/bin/env bash
set -euo pipefail

npm run build

mkdir -p logs
: > logs/gossip.log
: > logs/dm.log

if ! curl -s "http://localhost:8008/_matrix/client/versions" >/dev/null; then
  if command -v docker >/dev/null; then
    if ! docker ps -a --format '{{.Names}}' | grep -qx synapse; then
      echo "Creating Synapse container..."
      docker run -it --rm \
        --mount type=volume,src=synapse-data,dst=/data \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        matrixdotorg/synapse:latest generate
      docker run -d --name synapse \
        --mount type=volume,src=synapse-data,dst=/data \
        -p 8008:8008 \
        matrixdotorg/synapse:latest >/dev/null
      sleep 3
    else
      echo "Starting Synapse container..."
      docker start synapse >/dev/null
      sleep 3
    fi
  fi
fi

if ! curl -s "http://localhost:8008/_matrix/client/versions" >/dev/null; then
  echo "Matrix homeserver not reachable at http://localhost:8008."
  echo "Start Synapse per SETUP.md, then retry."
  exit 1
fi

if command -v docker >/dev/null; then
  if docker ps --format '{{.Names}}' | grep -qx synapse; then
    if ! docker exec -i synapse sh -c "grep -q '^registration_shared_secret:' /data/homeserver.yaml"; then
      docker exec -i synapse sh -c "printf '\nregistration_shared_secret: \"devsecret\"\n' >> /data/homeserver.yaml"
      docker restart synapse >/dev/null
      sleep 3
    fi

    docker exec -i synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u agent_a -p agent_a_pw --no-admin --exists-ok >/dev/null
    docker exec -i synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u agent_b -p agent_b_pw --no-admin --exists-ok >/dev/null
  fi
fi

if ! node -e "const a=require('./config/agent_a.json'); const b=require('./config/agent_b.json'); if(a.gossipRoomId && a.dmRoomId && b.gossipRoomId && b.dmRoomId){process.exit(0);} process.exit(1);"; then
  node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json
fi

node dist/agent.js bridge --config config/agent_b.json --session matrix-marketplace --room both &
BRIDGE_PID=$!

OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"
if command -v "$OPENCLAW_CMD" >/dev/null 2>&1; then
  echo "Pinging OpenClaw session..."
  "$OPENCLAW_CMD" agent --session-id matrix-marketplace --message "Reply with PONG." || true
  echo "Pause 3s so you can confirm in OpenClaw UI..."
  sleep 3
  "$OPENCLAW_CMD" agent --session-id matrix-marketplace --message "You are the buyer. You will receive prompts that start with 'GOSSIP MESSAGE' or 'DM MESSAGE'. Follow these rules: If a gossip message is about selling a Nintendo handheld/switch, respond with one line 'DM: <message>' showing interest and asking key questions. If DM messages arrive, negotiate to 150 USD shipped with tracked signature; after a Deal Summary, reply with 'DM: Confirmed'. If you should not respond, reply exactly 'SKIP'. Always output exactly one line in the required format." >/dev/null 2>&1 || true
fi

LOG_DIR="logs"
DM_LOG="$LOG_DIR/dm.log"
mkdir -p "$LOG_DIR"
touch "$DM_LOG"

wait_for_buyer_reply() {
  local start_size
  start_size="$(wc -c <"$DM_LOG")"
  local waited=0
  local timeout=30
  while [ "$waited" -lt "$timeout" ]; do
    if [ "$(wc -c <"$DM_LOG")" -gt "$start_size" ]; then
      if tail -n 5 "$DM_LOG" | rg -q "@agent_b:localhost"; then
        return 0
      fi
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "Warning: no buyer reply detected within ${timeout}s."
  return 1
}

run_script_line_by_line() {
  local room="$1"
  local script_path="$2"
  while IFS= read -r line || [ -n "$line" ]; do
    local trimmed
    trimmed="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [ -z "$trimmed" ] || [[ "$trimmed" == \#* ]]; then
      continue
    fi
    if [[ "$trimmed" == sleep* ]]; then
      local ms
      ms="$(echo "$trimmed" | sed 's/^sleep[[:space:]]*//')"
      if [[ "$ms" =~ ^[0-9]+$ ]]; then
        sleep "$(awk "BEGIN {print $ms/1000}")"
      fi
      continue
    fi
    node dist/agent.js send --config config/agent_a.json --room "$room" --text "$trimmed"
    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")"
    local room_id
    if [ "$room" = "gossip" ]; then
      room_id="$(node -e "const c=require('./config/agent_a.json'); console.log(c.gossipRoomId||'');")"
      printf "%s %s %s %s\n" "$ts" "@agent_a:localhost" "$room_id" "$trimmed" >> "$LOG_DIR/gossip.log"
    else
      room_id="$(node -e "const c=require('./config/agent_a.json'); console.log(c.dmRoomId||'');")"
      printf "%s %s %s %s\n" "$ts" "@agent_a:localhost" "$room_id" "$trimmed" >> "$LOG_DIR/dm.log"
    fi
    if [ "$room" = "dm" ]; then
      wait_for_buyer_reply || true
    fi
    sleep 1
  done < "$script_path"
}

run_script_line_by_line gossip scripts/agent_a_gossip.script
wait_for_buyer_reply || true
run_script_line_by_line dm scripts/agent_a_dm.script

sleep 2
kill "$BRIDGE_PID" 2>/dev/null || true
