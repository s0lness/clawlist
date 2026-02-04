#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --network container:synapse \
  -v "$REPO_ROOT:/app" \
  -w /app \
  node:20 npm run demo
