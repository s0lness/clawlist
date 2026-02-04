#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p logs
if ! pgrep -f "node scripts/ui-server.js" >/dev/null 2>&1; then
  nohup node scripts/ui-server.js > logs/ui.log 2>&1 &
  sleep 0.5
fi

echo "UI: http://localhost:8090"
echo "Running demo..."

docker run --rm --network container:synapse \
  -v "$REPO_ROOT:/app" \
  -w /app \
  node:20 npm run demo
