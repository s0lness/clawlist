#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCENARIO="${SCENARIO:-${1:-switch_basic}}"
N="${N:-${2:-10}}"

SWEEP_ID="${SWEEP_ID:-sweep_$(date +%Y%m%d_%H%M%S)}"
SWEEP_DIR="$ROOT_DIR/runs/$SWEEP_ID"
mkdir -p "$SWEEP_DIR"

results="$SWEEP_DIR/results.jsonl"
: > "$results"

pass=0
fail=0
no_deal=0

for i in $(seq 1 "$N"); do
  run_id="${SWEEP_ID}_$i"
  echo "[sweep] ($i/$N) run_id=$run_id"
  RUN_ID="$run_id" ./lab/run_scenario.sh "$SCENARIO" >/dev/null || true

  sum="$ROOT_DIR/runs/$run_id/out/summary.json"
  if [ ! -f "$sum" ]; then
    echo '{"runId":"'"$run_id"'","result":"missing"}' >> "$results"
    fail=$((fail+1))
    continue
  fi

  r=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(j.result||"missing");' "$sum")
  echo "[sweep] result=$r"
  node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(j)+"\n");' "$sum" >> "$results"

  case "$r" in
    pass) pass=$((pass+1));;
    no_deal) no_deal=$((no_deal+1));;
    *) fail=$((fail+1));;
  esac

done

agg="$SWEEP_DIR/aggregate.json"
node - <<'NODE'
const fs=require('fs');
const p=process.env.RESULTS;
const lines=fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean);
const rows=lines.map(l=>JSON.parse(l));
const counts={};
for (const r of rows){ counts[r.result]=(counts[r.result]||0)+1; }
const out={
  sweepId: process.env.SWEEP_ID,
  scenario: process.env.SCENARIO,
  n: rows.length,
  counts,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(process.env.AGG, JSON.stringify(out,null,2)+'\n','utf8');
console.log(out);
NODE

"$results" "$agg" "$SWEEP_ID" "$SCENARIO" \
  RESULTS="$results" AGG="$agg" SWEEP_ID="$SWEEP_ID" SCENARIO="$SCENARIO"

echo "[sweep] wrote: $agg"
