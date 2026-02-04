#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker rm -f element-web synapse >/dev/null 2>&1 || true
docker volume rm synapse-data >/dev/null 2>&1 || true
rm -rf logs || true

cat > config/agent_a.json <<'JSON'
{
  "baseUrl": "http://localhost:8008",
  "userId": "@agent_a:localhost",
  "password": "agent_a_pw",
  "deviceId": "agent_a_dev",
  "gossipRoomAlias": "#gossip:localhost",
  "gossipRoomId": "",
  "dmRoomId": "",
  "logDir": "logs",
  "accessToken": ""
}
JSON

cat > config/agent_b.json <<'JSON'
{
  "baseUrl": "http://localhost:8008",
  "userId": "@agent_b:localhost",
  "password": "agent_b_pw",
  "deviceId": "agent_b_dev",
  "gossipRoomAlias": "#gossip:localhost",
  "gossipRoomId": "",
  "dmRoomId": "",
  "logDir": "logs",
  "accessToken": ""
}
JSON

docker run --rm --mount type=volume,src=synapse-data,dst=/data \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:latest generate

docker run -d --name synapse \
  --mount type=volume,src=synapse-data,dst=/data \
  -p 8008:8008 \
  matrixdotorg/synapse:latest

echo "Waiting for Synapse..."
wait_secs=0
until docker exec synapse sh -c "python - <<'PY'\nimport urllib.request\nurllib.request.urlopen('http://localhost:8008/_matrix/client/versions').read()\nPY" >/dev/null 2>&1; do
  sleep 1
  wait_secs=$((wait_secs + 1))
  if [ $((wait_secs % 5)) -eq 0 ]; then
    echo "  still waiting... ${wait_secs}s"
  fi
done

docker exec synapse register_new_matrix_user http://localhost:8008 \
  -c /data/homeserver.yaml -u agent_a -p agent_a_pw -a --exists-ok
docker exec synapse register_new_matrix_user http://localhost:8008 \
  -c /data/homeserver.yaml -u agent_b -p agent_b_pw --no-admin --exists-ok

docker network create matrix-local >/dev/null 2>&1 || true
docker network connect matrix-local synapse >/dev/null 2>&1 || true

docker run -d --name element-web --network matrix-local -p 8080:80 \
  -v "$REPO_ROOT/element-config.json:/app/config.json:ro" \
  vectorim/element-web:latest

if [ ! -d "$REPO_ROOT/node_modules" ]; then
  docker run --rm -v "$REPO_ROOT:/app" -w /app \
    --user "$(id -u):$(id -g)" \
    node:20 npm install
fi

docker run --rm -v "$REPO_ROOT:/app" -w /app \
  --user "$(id -u):$(id -g)" \
  node:20 npm run build

docker run --rm --network container:synapse -v "$REPO_ROOT:/app" \
  -w /app --user "$(id -u):$(id -g)" \
  node:20 node dist/agent.js setup --config-a config/agent_a.json --config-b config/agent_b.json

mkdir -p logs
if ! pgrep -f "node scripts/ui-server.js" >/dev/null 2>&1; then
  nohup node scripts/ui-server.js > logs/ui.log 2>&1 &
  sleep 0.5
fi

echo "UI: http://localhost:8090"
echo "Element: http://localhost:8080"
echo "Running demo..."

docker run --rm --network container:synapse -v "$(pwd)":/app \
  -w /app --user "$(id -u):$(id -g)" \
  node:20 npm run demo:inner
