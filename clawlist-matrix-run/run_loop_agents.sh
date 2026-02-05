#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ATTEMPTS="${ATTEMPTS:-50}"
RUN_MINUTES="${RUN_MINUTES:-2}"
MATRIX_PORT="${MATRIX_PORT:-18008}"

summarize() {
  local out_dir="$1"
  local steps="$out_dir/steps.jsonl"

  echo "--- recap ---"
  echo "out_dir=$out_dir"

  if [ -f "$steps" ]; then
    local last
    last=$(tail -n 1 "$steps" || true)
    echo "last_step=$last"

    # show last error line if any
    local err
    err=$(grep -n '"status":"error"' "$steps" | tail -n 1 || true)
    if [ -n "$err" ]; then
      echo "error=$err"
    fi
  else
    echo "no steps.jsonl"
  fi

  # very small, high-signal tails
  for f in "$out_dir/gateway_switch-seller.log" "$out_dir/gateway_switch-buyer.log" "$out_dir/synapse.log"; do
    if [ -f "$f" ]; then
      echo "tail: $f"
      tail -n 12 "$f" | sed 's/^/  /'
    fi
  done

  # suggestion heuristic
  if [ -f "$steps" ] && grep -q '"step":"validate_tokens".*"status":"error"' "$steps"; then
    echo "suggestion: token check failed → inspect secrets.env, and ensure whoami is called with Authorization header."
  elif [ -f "$steps" ] && grep -q '"step":"verify_market".*"status":"error"' "$steps"; then
    echo "suggestion: seller not posting LISTING: fast enough → strengthen seller mission or have harness post fallback listing."
  elif [ -f "$steps" ] && grep -q '"step":"verify_dm".*"status":"error"' "$steps"; then
    echo "suggestion: DM not detected → replace heuristic with m.direct / room member check and/or message count."
  else
    echo "suggestion: check the last failing step and corresponding log tail above."
  fi
}

# 1) Ensure synapse is up once
RUN_ID="matrix_up_$(date +%Y%m%d_%H%M%S)"
./scripts/matrix_up.sh >/dev/null

for i in $(seq 1 "$ATTEMPTS"); do
  echo "=== ATTEMPT $i/$ATTEMPTS ==="
  export RUN_ID="$(date +%Y%m%d_%H%M%S)_a${i}"

  set +e
  MATRIX_REUSE=1 RUN_MINUTES="$RUN_MINUTES" ./run_agents_only.sh
  rc=$?
  set -e

  out_dir="$ROOT_DIR/runs/$RUN_ID/out"
  summarize "$out_dir"

  if [ "$rc" -eq 0 ]; then
    echo "GREEN on attempt $i"
    exit 0
  fi

  echo "attempt $i failed (rc=$rc)"
  sleep 1

done

echo "gave up after $ATTEMPTS"
exit 1
