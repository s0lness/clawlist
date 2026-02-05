#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'scenario.example.json');
const LOCAL_CONFIG = path.join(ROOT, 'config', 'scenario.local.json');
const RUN_SCRIPT = path.join(ROOT, 'clawlist-matrix-run', 'run.sh');

function usage() {
  console.log([
    'Usage:',
    '  npm run scenario',
    '  node scripts/scenario.js run [--config <path>] [--minutes <n>] [--run-id <id>] [--reuse true|false]',
    '  node scripts/scenario.js print-config [--config <path>] [--no-local]',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { cmd: 'run', flags: {} };

  if (args[0] && !args[0].startsWith('--')) {
    out.cmd = args[0];
    args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      out.flags[name] = true;
      continue;
    }
    out.flags[name] = next;
    i += 1;
  }

  return out;
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over;
  const merged = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (isObject(v) && isObject(merged[k])) {
      merged[k] = deepMerge(merged[k], v);
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }
  return fallback;
}

function buildConfig(flags) {
  const configPath = flags.config ? path.resolve(ROOT, String(flags.config)) : DEFAULT_CONFIG;
  const base = readJson(configPath);
  if (!base) throw new Error(`Missing config file: ${configPath}`);

  let merged = base;
  if (!flags['no-local']) {
    const local = readJson(LOCAL_CONFIG);
    if (local) merged = deepMerge(merged, local);
  }

  if (flags.minutes) merged = deepMerge(merged, { run: { minutes: Number(flags.minutes) } });
  if (flags['run-id']) merged = deepMerge(merged, { run: { id: String(flags['run-id']) } });
  if (flags.reuse !== undefined) {
    merged = deepMerge(merged, { matrix: { reuse: toBool(flags.reuse, true) } });
  }

  return merged;
}

function envFromConfig(config) {
  return {
    RUN_MINUTES: config?.run?.minutes != null ? String(config.run.minutes) : undefined,
    RUN_ID: config?.run?.id || undefined,
    MATRIX_REUSE: config?.matrix?.reuse === undefined ? undefined : (config.matrix.reuse ? '1' : '0'),
    SYNAPSE_DIR: config?.matrix?.synapseDir || undefined,
    SELLER_GATEWAY_PORT: config?.gateway?.sellerPort != null ? String(config.gateway.sellerPort) : undefined,
    BUYER_GATEWAY_PORT: config?.gateway?.buyerPort != null ? String(config.gateway.buyerPort) : undefined,
    SELLER_GATEWAY_TOKEN: config?.gateway?.sellerToken || undefined,
    BUYER_GATEWAY_TOKEN: config?.gateway?.buyerToken || undefined,
    ROOM_ALIAS: config?.room?.alias || undefined,
  };
}

function main() {
  const { cmd, flags } = parseArgs(process.argv);

  if (cmd === 'help' || flags.help) {
    usage();
    process.exit(0);
  }

  const config = buildConfig(flags);

  if (cmd === 'print-config') {
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
  }

  if (cmd !== 'run') {
    throw new Error(`Unknown command: ${cmd}`);
  }

  const env = { ...process.env };
  for (const [k, v] of Object.entries(envFromConfig(config))) {
    if (v !== undefined) env[k] = v;
  }

  const result = spawnSync('bash', [RUN_SCRIPT], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exit(result.status == null ? 1 : result.status);
}

try {
  main();
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  console.error(`Error: ${msg}`);
  usage();
  process.exit(1);
}
