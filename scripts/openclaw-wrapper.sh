#!/usr/bin/env bash
set -euo pipefail

openclaw_bin="$(command -v openclaw || true)"
if [ -z "$openclaw_bin" ]; then
  echo "OpenClaw CLI not found. Install it first."
  exit 1
fi

preload="$(cd "$(dirname "$0")" && pwd)/openclaw-preload.mjs"
exec node --import "$preload" "$openclaw_bin" "$@"
