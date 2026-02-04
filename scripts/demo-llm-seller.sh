#!/usr/bin/env bash
set -euo pipefail

npm run build

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

node dist/agent.js bridge --config config/agent_a.json --session matrix-marketplace --room both &
BRIDGE_PID=$!

node dist/agent.js scripted --config config/agent_b.json --room dm --script scripts/agent_b.script

sleep 1
kill "$BRIDGE_PID" 2>/dev/null || true
