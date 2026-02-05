#!/usr/bin/env bash
set -euo pipefail

# Wrapper around run.sh that assumes Synapse is already running.
# It still creates a fresh per-run room, logs in to get tokens, and then only tests agent behavior.

export MATRIX_REUSE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
export MATRIX_RUN_ID="$RUN_ID"

# Use the session-only bootstrap (no synapse restart)
export BOOTSTRAP_SCRIPT_OVERRIDE="./scripts/bootstrap_matrix_session.sh"

# run.sh doesn't support override directly; we provide it via env and a tiny shim:
# If the main bootstrap script exists, temporarily swap via env var.

# Call a copy of run.sh logic but swap the bootstrap command via BASH_ENV is messy;
# simplest: rely on bootstrap_matrix.sh with reuse mode, but that still restarts if not running.
# So we re-implement only the first part: generate bootstrap.env + secrets.env, then exec run.sh

# Prepare run directories consistent with run.sh
RUN_DIR="$ROOT_DIR/runs/$RUN_ID"
OUT_DIR="$RUN_DIR/out"
mkdir -p "$OUT_DIR"

MATRIX_BOOTSTRAP_OUT="$OUT_DIR/bootstrap.env"
MATRIX_BOOTSTRAP_RAW="$OUT_DIR/bootstrap.raw"
SECRETS_FILE="$OUT_DIR/secrets.env"

# Run the session bootstrap
BOOTSTRAP_SECRETS_FILE="$SECRETS_FILE" "$ROOT_DIR/scripts/bootstrap_matrix_session.sh" 2>&1 | tee "$MATRIX_BOOTSTRAP_RAW" >/dev/null
chmod 600 "$MATRIX_BOOTSTRAP_RAW" "$SECRETS_FILE" || true
grep -E '^[A-Z0-9_]+=.*$' "$MATRIX_BOOTSTRAP_RAW" > "$MATRIX_BOOTSTRAP_OUT"

# Now run the normal harness, but skip its internal bootstrap by exporting the precomputed env.
# We do this by setting MATRIX_BOOTSTRAP_PRESET=1 and pointing run.sh at our files.
export MATRIX_BOOTSTRAP_PRESET=1
export MATRIX_BOOTSTRAP_OUT_PRESET="$MATRIX_BOOTSTRAP_OUT"
export MATRIX_SECRETS_FILE_PRESET="$SECRETS_FILE"
export RUN_ID

exec "$ROOT_DIR/run.sh"
