#!/usr/bin/env bash
set -euo pipefail

npm run build

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
for f in gossip.log dm.log listings.jsonl approvals.jsonl deals.jsonl; do
  : > "$LOG_DIR/$f"
done

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

SESSION_ID="matrix-marketplace-$(date -u +%Y%m%dT%H%M%S)"
node dist/agent.js bridge --config config/agent_b.json --session "$SESSION_ID" --room both &
BRIDGE_PID=$!

OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"
SENT_LISTING=0
if command -v "$OPENCLAW_CMD" >/dev/null 2>&1; then
  echo "Pinging OpenClaw session..."
  "$OPENCLAW_CMD" agent --session-id "$SESSION_ID" --message "Reply with PONG." || true
  echo "Pause 3s so you can confirm in OpenClaw UI..."
  sleep 3
  "$OPENCLAW_CMD" agent --session-id "$SESSION_ID" --message "You are the buyer. You will receive prompts that start with 'GOSSIP MESSAGE' or 'DM MESSAGE'. Follow these rules: If you should create a listing, ask up to 3 clarifying questions first (condition, accessories, location/shipping). After you have enough detail, respond with one line in this format: GOSSIP: INTENT {\"id\":\"lst_buyer_001\",\"side\":\"buy\",\"category\":\"console\",\"tags\":[\"nintendo\",\"switch\"],\"region\":\"EU\",\"detail\":\"Nintendo Switch, good condition\",\"price\":120,\"currency\":\"EUR\",\"condition\":\"good\",\"ship\":\"included\",\"location\":\"EU\",\"notes\":\"looking for good condition, full working\"}. If a gossip message is about selling a Nintendo handheld/switch, respond with one line 'DM: <message>' showing interest and asking key questions. If DM messages arrive, negotiate to 150 USD shipped with tracked signature; if the counterparty asks for more than 160 USD, respond with 'DM: Let me confirm and get back to you.'. After a Deal Summary, reply with 'DM: Confirmed'. If you should not respond, reply exactly 'SKIP'. Always output exactly one line in the required format." >/dev/null 2>&1 || true

  echo "Requesting buyer listing from OpenClaw..."
  listing_reply="$("$OPENCLAW_CMD" agent --session-id "$SESSION_ID" --message "Create your BUY intent now. Respond with one line starting with 'GOSSIP:'." || true)"
  listing_line="$(echo "$listing_reply" | tail -n 1 | tr -d '\r')"
  if echo "$listing_line" | rg -q "^GOSSIP:.*(INTENT|LISTING_CREATE)"; then
    listing_body="$(echo "$listing_line" | sed 's/^GOSSIP:[[:space:]]*//')"
    node dist/agent.js send --config config/agent_b.json --room gossip --text "$listing_body" || true
    SENT_LISTING=1
  else
    echo "OpenClaw did not return a listing. Sending fallback listing."
    node dist/agent.js send --config config/agent_b.json --room gossip --text \
      'INTENT {"id":"lst_buyer_fallback","side":"buy","category":"console","tags":["nintendo","switch"],"region":"EU","detail":"Nintendo Switch, good condition","price":120,"currency":"EUR","condition":"good","ship":"included","location":"EU"}' || true
    SENT_LISTING=1
  fi
fi

if [ "$SENT_LISTING" -eq 0 ]; then
  echo "OpenClaw not available. Sending fallback listing."
  node dist/agent.js send --config config/agent_b.json --room gossip --text \
    'INTENT {"id":"lst_buyer_fallback","side":"buy","category":"console","tags":["nintendo","switch"],"region":"EU","detail":"Nintendo Switch, good condition","price":120,"currency":"EUR","condition":"good","ship":"included","location":"EU"}' || true
fi

DM_LOG="$LOG_DIR/dm.log"
touch "$DM_LOG"
DM_REPLY_TIMEOUT="${DM_REPLY_TIMEOUT:-90}"
DM_APPROVAL_TIMEOUT="${DM_APPROVAL_TIMEOUT:-120}"

last_buyer_body() {
  tail -n 50 "$DM_LOG" | rg "@agent_b:localhost" | tail -n 1 | awk '{ $1=""; $2=""; $3=""; sub(/^ +/,""); print }'
}

has_buyer_deal_summary() {
  tail -n 50 "$DM_LOG" | rg -q "@agent_b:localhost .*DEAL_SUMMARY"
}

buyer_requests_approval() {
  local body
  body="$(last_buyer_body)"
  echo "$body" | rg -qi "approval|approve|let me confirm|APPROVAL_REQUEST"
}

wait_for_buyer_reply() {
  local start_size
  start_size="$(wc -c <"$DM_LOG")"
  local waited=0
  local timeout="${1:-$DM_REPLY_TIMEOUT}"
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

prompt_buyer_opener() {
  local reply
  local line
  local body
  reply="$("$OPENCLAW_CMD" agent --session-id "$SESSION_ID" --message "Send the first DM to the seller (one line in format: DM: <message>). If you should not send, reply SKIP." || true)"
  line="$(echo "$reply" | tail -n 1 | tr -d '\r')"
  if echo "$line" | rg -q "^DM:"; then
    body="$(echo "$line" | sed 's/^DM:[[:space:]]*//')"
    node dist/agent.js send --config config/agent_b.json --room dm --text "$body" || true
    return 0
  fi
  return 1
}

wait_for_deal_summary() {
  local waited=0
  local timeout=30
  while [ "$waited" -lt "$timeout" ]; do
    if tail -n 10 "$DM_LOG" | rg -q "Deal Summary:|DEAL_SUMMARY"; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "Warning: no deal summary detected within ${timeout}s."
  return 1
}

wait_for_confirmed() {
  local waited=0
  local timeout=30
  while [ "$waited" -lt "$timeout" ]; do
    if tail -n 10 "$DM_LOG" | rg -q "^Confirmed$|^CONFIRMED$"; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "Warning: no Confirmed detected within ${timeout}s."
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
    if [ "$room" = "dm" ]; then
      wait_for_buyer_reply || true
      if has_buyer_deal_summary; then
        echo "Buyer sent DEAL_SUMMARY; stopping scripted seller lines."
        break
      fi
      if buyer_requests_approval; then
        echo "Buyer requested approval; waiting for follow-up..."
        wait_for_buyer_reply "$DM_APPROVAL_TIMEOUT" || true
        if buyer_requests_approval; then
          echo "Still awaiting approval follow-up; stopping scripted seller lines."
          break
        fi
      fi
    fi
    sleep 1
  done < "$script_path"
}

run_script_line_by_line gossip scripts/agent_a_gossip.script
wait_for_buyer_reply || true

if ! tail -n 10 "$DM_LOG" | rg -q "@agent_b:localhost"; then
  if command -v "$OPENCLAW_CMD" >/dev/null 2>&1; then
    if ! prompt_buyer_opener; then
      node dist/agent.js send --config config/agent_b.json --room dm --text "Hi! I'm interested in your listing. Is it still available and in good condition?" || true
    fi
  fi
fi
run_script_line_by_line dm scripts/agent_a_dm.script
if ! rg -q "@agent_a:localhost" "$DM_LOG"; then
  echo "Warning: no seller DM detected; sending fallback seller reply."
  node dist/agent.js send --config config/agent_a.json --room dm --text "Yes, still available. It comes with the charger and original case. Any questions?" || true
fi

if wait_for_deal_summary; then
  wait_for_confirmed || true
  if ! tail -n 10 "$DM_LOG" | rg -q "^Confirmed$|^CONFIRMED$"; then
    node dist/agent.js send --config config/agent_b.json --room dm --text "Confirmed" || true
  fi
fi

sleep 2
kill "$BRIDGE_PID" 2>/dev/null || true
