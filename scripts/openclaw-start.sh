#!/usr/bin/env bash
set -euo pipefail

openclaw_cmd="${OPENCLAW_CMD:-$(cd "$(dirname "$0")" && pwd)/openclaw-wrapper.sh}"
if [ ! -x "$openclaw_cmd" ]; then
  openclaw_cmd="openclaw"
fi

if ! command -v "$openclaw_cmd" >/dev/null 2>&1; then
  echo "OpenClaw CLI not found. Install it first."
  exit 1
fi

if "$openclaw_cmd" gateway status >/dev/null 2>&1; then
  echo "OpenClaw gateway already running."
  exit 0
fi

echo "Starting OpenClaw gateway..."
if "$openclaw_cmd" gateway start --daemon >/dev/null 2>&1; then
  :
else
  nohup "$openclaw_cmd" gateway >/tmp/openclaw-gateway.log 2>&1 &
fi

sleep 2

if "$openclaw_cmd" gateway status >/dev/null 2>&1; then
  echo "OpenClaw gateway started."
else
  echo "OpenClaw gateway did not start. Check /tmp/openclaw-gateway.log"
  exit 1
fi
