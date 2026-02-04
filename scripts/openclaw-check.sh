#!/usr/bin/env bash
set -euo pipefail

fail=0

if command -v node >/dev/null; then
  node_ver="$(node -v | sed 's/^v//')"
  node_major="${node_ver%%.*}"
  if [ "${node_major}" -lt 22 ]; then
    echo "Node: v${node_ver} (warning: OpenClaw recommends Node 22+)"
  else
    echo "Node: v${node_ver}"
  fi
else
  echo "Node: not found"
  fail=1
fi

openclaw_cmd="${OPENCLAW_CMD:-$(cd "$(dirname "$0")" && pwd)/openclaw-wrapper.sh}"
if [ ! -x "$openclaw_cmd" ]; then
  openclaw_cmd="openclaw"
fi

if command -v "$openclaw_cmd" >/dev/null 2>&1; then
  echo "OpenClaw CLI: found"
else
  echo "OpenClaw CLI: not found"
  fail=1
fi

if command -v "$openclaw_cmd" >/dev/null 2>&1; then
  if "$openclaw_cmd" status >/dev/null 2>&1; then
    echo "OpenClaw status: ok"
  else
    echo "OpenClaw status: unavailable (run 'openclaw status' manually)"
  fi

  if "$openclaw_cmd" gateway status >/dev/null 2>&1; then
    echo "OpenClaw gateway: running"
  else
    echo "OpenClaw gateway: not running"
    fail=1
  fi
fi

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Telegram bot token: set via TELEGRAM_BOT_TOKEN"
else
  echo "Telegram bot token: not set (optional)"
fi

if command -v "$openclaw_cmd" >/dev/null 2>&1; then
  if "$openclaw_cmd" channels status >/dev/null 2>&1; then
    echo "OpenClaw channels: available"
  else
    echo "OpenClaw channels: unavailable (run 'openclaw channels status' manually)"
  fi
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
