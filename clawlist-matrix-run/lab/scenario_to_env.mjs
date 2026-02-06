import fs from 'node:fs';

const scenPath = process.argv[2];
if (!scenPath) {
  console.error('usage: node lab/scenario_to_env.mjs <scenario.json>');
  process.exit(2);
}

const s = JSON.parse(fs.readFileSync(scenPath, 'utf8'));

function out(k, v) {
  if (v === undefined || v === null) return;
  process.stdout.write(`${k}=${v}\n`);
}

out('SCEN_DURATION_SEC', s.durationSec ?? 120);
out('SELLER_PROFILE', s.seller?.profile ?? 'switch-seller');
out('BUYER_PROFILE', s.buyer?.profile ?? 'switch-buyer');
out('SELLER_ANCHOR', s.seller?.anchorPrice ?? 200);
out('SELLER_FLOOR', s.seller?.floorPrice ?? 150);
out('BUYER_START', s.buyer?.startOffer ?? 120);
out('BUYER_CEIL', s.buyer?.ceilingPrice ?? 150);
{
  const tmpl =
    s.seed?.bodyTemplate ?? 'RUN_ID:{RUN_ID} SELLING: nintendo switch — asking 200€ (can negotiate). DM me.';
  // Quote + escape so it can be safely `source`d in bash.
  const esc = String(tmpl).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  process.stdout.write(`SEED_TEMPLATE="${esc}"\n`);
}
