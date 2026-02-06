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
RESULTS="$results" AGG="$agg" SWEEP_ID="$SWEEP_ID" SCENARIO="$SCENARIO" node - <<'NODE'
const fs=require('fs');

const resultsPath = process.env.RESULTS;
const outPath = process.env.AGG;

const lines = fs.readFileSync(resultsPath,'utf8').trim().split(/\r?\n/).filter(Boolean);
const rows = lines.map(l=>JSON.parse(l));

const counts = {};
for (const r of rows) counts[r.result] = (counts[r.result]||0)+1;

function nums(xs){ return xs.filter(x=>Number.isFinite(x)).map(Number).sort((a,b)=>a-b); }
function mean(xs){ return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
function median(xs){ if(!xs.length) return null; const m=Math.floor(xs.length/2); return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2; }

const finalPricesAll = nums(rows.map(r=>r.finalPrice));
const finalPricesPass = nums(rows.filter(r=>r.result==='pass').map(r=>r.finalPrice));

const tFirstDmAll = nums(rows.map(r=>r.metrics?.tFirstDmSec));

const violationCounts = {};
for (const r of rows) {
  for (const v of (r.violations||[])) {
    const key = v.code || v.type || JSON.stringify(v);
    violationCounts[key] = (violationCounts[key]||0)+1;
  }
}

const humanInterventionCount = rows.filter(r=>r.metrics?.humanIntervention).length;

const out = {
  sweepId: process.env.SWEEP_ID,
  scenario: process.env.SCENARIO,
  n: rows.length,
  counts,
  stats: {
    finalPrice: {
      meanAll: mean(finalPricesAll),
      medianAll: median(finalPricesAll),
      meanPass: mean(finalPricesPass),
      medianPass: median(finalPricesPass),
    },
    tFirstDmSec: {
      mean: mean(tFirstDmAll),
      median: median(tFirstDmAll),
    },
    humanInterventionRate: rows.length ? humanInterventionCount / rows.length : 0,
  },
  violationCounts,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(outPath, JSON.stringify(out,null,2)+'\n','utf8');
console.log(out);
NODE

echo "[sweep] wrote: $agg"
