#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
RUN_DIR="$ROOT_DIR/runs/$RUN_ID"
OUT_DIR="$RUN_DIR/out"
mkdir -p "$OUT_DIR"

OPENCLAW="${OPENCLAW:-$(command -v openclaw || true)}"
NPM="${NPM:-$(command -v npm || true)}"
TIMEOUT_BIN="$(command -v timeout || true)"
STEPS_LOG="$OUT_DIR/steps.jsonl"

if [ -z "$OPENCLAW" ] || [ ! -x "$OPENCLAW" ]; then
  echo "openclaw not found in PATH. Set OPENCLAW=/path/to/openclaw" >&2
  exit 1
fi

if [ -z "$NPM" ] || [ ! -x "$NPM" ]; then
  echo "npm not found in PATH. Set NPM=/path/to/npm" >&2
  exit 1
fi

log_step() {
  local step="$1"
  local status="$2"
  local msg="${3:-}"
  printf '{"ts":"%s","step":"%s","status":"%s","msg":"%s"}\n' \
    "$(date -Is)" "$step" "$status" "$msg" >>"$STEPS_LOG"
}

# --- Diagnostics helpers (tight feedback loop) ---
dump_tail() {
  local label="$1"
  local path="$2"
  local n="${3:-120}"
  if [ -f "$path" ]; then
    echo "\n[diag] --- ${label} (tail -n ${n} ${path}) ---" >&2
    tail -n "$n" "$path" >&2 || true
  else
    echo "\n[diag] --- ${label} missing: ${path} ---" >&2
  fi
}

DID_DUMP_LOGS=0

dump_logs() {
  # Avoid double-dumping if multiple traps fire.
  if [ "${DID_DUMP_LOGS}" -ne 0 ]; then
    return 0
  fi
  DID_DUMP_LOGS=1

  echo "\n[diag] run failed. run_id=${RUN_ID} out_dir=${OUT_DIR}" >&2
  dump_tail "steps" "$STEPS_LOG" 200
  dump_tail "bootstrap" "$MATRIX_BOOTSTRAP_RAW" 120
  dump_tail "synapse" "$OUT_DIR/synapse.log" 120
  dump_tail "seller gateway" "$OUT_DIR/gateway_${SELLER_PROFILE}.log" 160
  dump_tail "buyer gateway" "$OUT_DIR/gateway_${BUYER_PROFILE}.log" 160
  dump_tail "seller mission cmd" "$OUT_DIR/system_event_${SELLER_PROFILE}.log" 120
  dump_tail "buyer mission cmd" "$OUT_DIR/system_event_${BUYER_PROFILE}.log" 120
  dump_tail "npm install (built-in matrix plugin)" "$OUT_DIR/npm_install_matrix_builtin.log" 120
}

run_timeout() {
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" 60s "$@"
  else
    "$@"
  fi
}

curl_retry() {
  local url="$1"
  local method="${2:-GET}"
  local data="${3:-}"
  local token="${4:-}"

  for i in {1..5}; do
    # Always include Authorization when a token is provided (even for GET with no body).
    if [ -n "$token" ] && [ -n "$data" ]; then
      if curl -fsS --max-time 20 -X "$method" "$url" \
        -H "Authorization: Bearer $token" \
        -H 'Content-Type: application/json' \
        -d "$data" >/dev/null; then
        return 0
      fi
    elif [ -n "$token" ]; then
      if curl -fsS --max-time 20 -X "$method" "$url" \
        -H "Authorization: Bearer $token" >/dev/null; then
        return 0
      fi
    elif [ -n "$data" ]; then
      if curl -fsS --max-time 20 -X "$method" "$url" \
        -H 'Content-Type: application/json' \
        -d "$data" >/dev/null; then
        return 0
      fi
    else
      if curl -fsS --max-time 20 -X "$method" "$url" >/dev/null; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

wait_port() {
  local host="$1"
  local port="$2"
  local tries=30
  for i in $(seq 1 "$tries"); do
    if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Where Synapse persists its state for this run.
# You can reuse a run by reusing RUN_ID.
export SYNAPSE_DIR="${SYNAPSE_DIR:-$RUN_DIR/synapse-data}"

RUN_MINUTES="${RUN_MINUTES:-5}"

SELLER_PROFILE="switch-seller"
BUYER_PROFILE="switch-buyer"

SELLER_GATEWAY_PORT="${SELLER_GATEWAY_PORT:-28791}"
BUYER_GATEWAY_PORT="${BUYER_GATEWAY_PORT:-28792}"

# Auto-select free ports to avoid collisions with already-running gateways.
port_in_use() {
  local port="$1"
  ss -ltnH 2>/dev/null | grep -Eq "[:\]]${port}\\b"
}

pick_free_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

SELLER_GATEWAY_PORT="$(pick_free_port "$SELLER_GATEWAY_PORT")"
if [ "$BUYER_GATEWAY_PORT" -eq "$SELLER_GATEWAY_PORT" ]; then
  BUYER_GATEWAY_PORT=$((SELLER_GATEWAY_PORT + 1))
fi
BUYER_GATEWAY_PORT="$(pick_free_port "$BUYER_GATEWAY_PORT")"

echo "[run] using gateway ports: seller=${SELLER_GATEWAY_PORT} buyer=${BUYER_GATEWAY_PORT}" >&2

SELLER_GATEWAY_TOKEN="${SELLER_GATEWAY_TOKEN:-token-switch-seller}"
BUYER_GATEWAY_TOKEN="${BUYER_GATEWAY_TOKEN:-token-switch-buyer}"

MATRIX_BOOTSTRAP_OUT="$OUT_DIR/bootstrap.env"
MATRIX_BOOTSTRAP_RAW="$OUT_DIR/bootstrap.raw"
SECRETS_FILE="$OUT_DIR/secrets.env"

# 1) Matrix up + room + tokens
# Reuse Synapse across runs by default to reduce flakes and focus on agent behavior.
export MATRIX_REUSE="${MATRIX_REUSE:-1}"
export MATRIX_RUN_ID="$RUN_ID"

if [ "${MATRIX_BOOTSTRAP_PRESET:-0}" = "1" ]; then
  MATRIX_BOOTSTRAP_OUT="${MATRIX_BOOTSTRAP_OUT_PRESET:?MATRIX_BOOTSTRAP_OUT_PRESET required}"
  SECRETS_FILE="${MATRIX_SECRETS_FILE_PRESET:?MATRIX_SECRETS_FILE_PRESET required}"
  echo "[run] using preset matrix bootstrap env: ${MATRIX_BOOTSTRAP_OUT}" >&2
  log_step "bootstrap_matrix" "ok" "preset"
else
  echo "[run] bootstrapping matrix (reuse=${MATRIX_REUSE})" >&2
  log_step "bootstrap_matrix" "start"
  BOOTSTRAP_SECRETS_FILE="$SECRETS_FILE" ./scripts/bootstrap_matrix.sh 2>&1 | tee "$MATRIX_BOOTSTRAP_RAW" >/dev/null
  chmod 600 "$MATRIX_BOOTSTRAP_RAW" "$SECRETS_FILE" || true
  # Keep only KEY=VALUE lines for sourcing
  grep -E '^[A-Z0-9_]+=.*$' "$MATRIX_BOOTSTRAP_RAW" > "$MATRIX_BOOTSTRAP_OUT"
  log_step "bootstrap_matrix" "ok"
fi

# Capture Synapse logs for this run (best effort)
if docker ps --format '{{.Names}}' | grep -qx 'clawlist-synapse'; then
  docker logs -f clawlist-synapse >"$OUT_DIR/synapse.log" 2>&1 &
  SYNAPSE_LOG_PID=$!
else
  SYNAPSE_LOG_PID=""
fi

# shellcheck disable=SC1090
source "$MATRIX_BOOTSTRAP_OUT"
if [ -f "$SECRETS_FILE" ]; then
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
fi

# Sanity-check secrets early; missing tokens causes confusing Matrix 401s later.
if [ -z "${SELLER_TOKEN:-}" ] || [ -z "${BUYER_TOKEN:-}" ]; then
  log_step "bootstrap_matrix" "error" "missing SELLER_TOKEN/BUYER_TOKEN in secrets.env"
  echo "[run] ERROR: missing SELLER_TOKEN/BUYER_TOKEN (check $SECRETS_FILE)" >&2
  exit 1
fi

MATRIX_PORT="${MATRIX_PORT:-18008}"
HOMESERVER="http://127.0.0.1:${MATRIX_PORT}"
MARKET_ROOM_ID="$ROOM_ID"

# --- Fast-fail correctness checks (tight feedback loop) ---
echo "[run] validating matrix tokens"
log_step "validate_tokens" "start"
if ! curl_retry "${HOMESERVER}/_matrix/client/v3/account/whoami" "GET" "" "${SELLER_TOKEN}"; then
  log_step "validate_tokens" "error" "seller token invalid"
  echo "[run] ERROR: seller token invalid (whoami failed)" >&2
  exit 1
fi
if ! curl_retry "${HOMESERVER}/_matrix/client/v3/account/whoami" "GET" "" "${BUYER_TOKEN}"; then
  log_step "validate_tokens" "error" "buyer token invalid"
  echo "[run] ERROR: buyer token invalid (whoami failed)" >&2
  exit 1
fi
log_step "validate_tokens" "ok"

echo "[run] validating market room membership"
log_step "validate_room" "start"
# Check each user can see their membership state in the market room.
SELLER_MXID_ENC=$(node -p 'encodeURIComponent(process.argv[1])' "$SELLER_MXID")
BUYER_MXID_ENC=$(node -p 'encodeURIComponent(process.argv[1])' "$BUYER_MXID")

if ! curl_retry "${HOMESERVER}/_matrix/client/v3/rooms/${MARKET_ROOM_ID}/state/m.room.member/${SELLER_MXID_ENC}" "GET" "" "${SELLER_TOKEN}"; then
  log_step "validate_room" "error" "seller not joined to market room"
  echo "[run] ERROR: seller not joined to market room ${MARKET_ROOM_ID}" >&2
  exit 1
fi
if ! curl_retry "${HOMESERVER}/_matrix/client/v3/rooms/${MARKET_ROOM_ID}/state/m.room.member/${BUYER_MXID_ENC}" "GET" "" "${BUYER_TOKEN}"; then
  log_step "validate_room" "error" "buyer not joined to market room"
  echo "[run] ERROR: buyer not joined to market room ${MARKET_ROOM_ID}" >&2
  exit 1
fi
log_step "validate_room" "ok"

# 2) Ensure profiles are runnable (gateway.mode, plugin install+deps, plugin enabled)

ensure_profile_ready() {
  local profile="$1"

  # Gateways require explicit local mode (or --allow-unconfigured).
  run_timeout "$OPENCLAW" --profile "$profile" config set gateway.mode local >/dev/null 2>&1 || true

  # OpenClaw ships with a built-in Matrix plugin (openclaw/extensions/matrix), but depending on
  # install method its npm deps may not be present. Ensure deps are installed once.
  local openclaw_pkg_dir
  # Resolve the global OpenClaw install dir reliably (don't rely on Node module resolution).
  # Under nvm this is typically: $(npm root -g)/openclaw
  openclaw_pkg_dir="$($NPM root -g 2>/dev/null)/openclaw"
  local global_matrix_ext="${openclaw_pkg_dir}/extensions/matrix"
  if [ -n "$openclaw_pkg_dir" ] && [ -d "$global_matrix_ext" ]; then
    if [ ! -d "$global_matrix_ext/node_modules/@vector-im/matrix-bot-sdk" ]; then
      echo "[run] installing deps for built-in matrix plugin (${global_matrix_ext})" >&2

      # Strip devDependencies (may include openclaw: workspace:* which breaks npm install outside a workspace)
      EXT_DIR="$global_matrix_ext" node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const extDir = process.env.EXT_DIR;
if (!extDir) throw new Error('EXT_DIR not set');

const pkgPath = path.join(extDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

delete pkg.devDependencies;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
NODE

      local npm_log="$OUT_DIR/npm_install_matrix_builtin.log"
      echo "[run] npm install log: $npm_log" >&2
      (cd "$global_matrix_ext" && "$NPM" install --omit=dev) >>"$npm_log" 2>&1
    fi
  fi

  # Ensure plugin is enabled in config (separate from channels.matrix.enabled).
  run_timeout "$OPENCLAW" --profile "$profile" plugins enable matrix >/dev/null 2>&1 || true
}

echo "[run] preparing profiles"
log_step "prepare_profiles" "start"
ensure_profile_ready "$SELLER_PROFILE"
ensure_profile_ready "$BUYER_PROFILE"
log_step "prepare_profiles" "ok"

# 3) Configure Matrix channel for each profile

configure_matrix() {
  local profile="$1"
  local token="$2"
  local mxid="$3"

  run_timeout $OPENCLAW --profile "$profile" config set --json 'channels.matrix' "{ enabled: true, homeserver: '${HOMESERVER}', accessToken: '${token}', userId: '${mxid}', encryption: false, dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open', groups: { '*': { requireMention: false }, '${MARKET_ROOM_ID}': { allow: true, requireMention: false } } }" >/dev/null
}

echo "[run] configuring matrix channel"
log_step "configure_matrix" "start"
configure_matrix "$SELLER_PROFILE" "$SELLER_TOKEN" "$SELLER_MXID"
configure_matrix "$BUYER_PROFILE" "$BUYER_TOKEN" "$BUYER_MXID"
log_step "configure_matrix" "ok"

# 4) Stop/disable supervised gateway services (so the harness owns ports)
#
# If a gateway is installed as a user service (systemd/launchd), it may pin a port
# (often 18789 via OPENCLAW_GATEWAY_PORT) and/or race with the harness.
# For these scenario runs we want the gateway to be ephemeral and bound to the
# run-selected ports (SELLER_GATEWAY_PORT / BUYER_GATEWAY_PORT).

disable_gateway_service() {
  local profile="$1"

  # Best-effort stop via OpenClaw CLI (works across service managers).
  run_timeout "$OPENCLAW" --profile "$profile" gateway stop >/dev/null 2>&1 || true

  # Best-effort stop+disable systemd user units if present.
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user stop "openclaw-gateway-${profile}.service" >/dev/null 2>&1 || true
    systemctl --user disable "openclaw-gateway-${profile}.service" >/dev/null 2>&1 || true
  fi
}

echo "[run] disabling supervised gateway services (if any)"
disable_gateway_service "$SELLER_PROFILE"
disable_gateway_service "$BUYER_PROFILE"

# Also try the generic unit name (older installs).
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop openclaw-gateway.service >/dev/null 2>&1 || true
  systemctl --user disable openclaw-gateway.service >/dev/null 2>&1 || true
fi

# 5) Start gateways (foreground processes we manage)

echo "[run] starting openclaw gateways"
log_step "start_gateways" "start"
# NOTE: OPENCLAW_GATEWAY_PORT appears to override the CLI --port option in practice.
# To ensure the gateway binds to the run-selected port, set the env var explicitly.
env OPENCLAW_GATEWAY_PORT="$SELLER_GATEWAY_PORT" \
  "$OPENCLAW" --profile "$SELLER_PROFILE" gateway run \
  --port "$SELLER_GATEWAY_PORT" --token "$SELLER_GATEWAY_TOKEN" \
  --force --compact --allow-unconfigured \
  >"$OUT_DIR/gateway_${SELLER_PROFILE}.log" 2>&1 &
SELLER_PID=$!

env OPENCLAW_GATEWAY_PORT="$BUYER_GATEWAY_PORT" \
  "$OPENCLAW" --profile "$BUYER_PROFILE" gateway run \
  --port "$BUYER_GATEWAY_PORT" --token "$BUYER_GATEWAY_TOKEN" \
  --force --compact --allow-unconfigured \
  >"$OUT_DIR/gateway_${BUYER_PROFILE}.log" 2>&1 &
BUYER_PID=$!

cleanup() {
  echo "[run] stopping gateways"
  kill "$SELLER_PID" "$BUYER_PID" >/dev/null 2>&1 || true

  echo "[run] stopping synapse"
  if [ -n "${SYNAPSE_LOG_PID:-}" ]; then
    kill "$SYNAPSE_LOG_PID" >/dev/null 2>&1 || true
  fi
  if [ "${MATRIX_REUSE:-0}" = "1" ]; then
    echo "[run] MATRIX_REUSE=1 → keeping synapse running" >&2
  else
    docker rm -f clawlist-synapse >/dev/null 2>&1 || true
  fi
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    dump_logs
  fi
  cleanup
  exit "$rc"
}
trap on_exit EXIT

# Give them time to connect to Matrix
if ! wait_port 127.0.0.1 "$SELLER_GATEWAY_PORT"; then
  log_step "start_gateways" "error" "seller gateway not ready"
  echo "seller gateway not ready" >&2
  exit 1
fi
if ! wait_port 127.0.0.1 "$BUYER_GATEWAY_PORT"; then
  log_step "start_gateways" "error" "buyer gateway not ready"
  echo "buyer gateway not ready" >&2
  exit 1
fi
log_step "start_gateways" "ok"

# 5) Inject missions

echo "[run] injecting missions"
log_step "inject_missions" "start"
SELLER_MISSION_LOG="$OUT_DIR/system_event_${SELLER_PROFILE}.log"
BUYER_MISSION_LOG="$OUT_DIR/system_event_${BUYER_PROFILE}.log"

inject_mission() {
  local profile="$1"
  local url="$2"
  local token="$3"
  local text="$4"
  local out_log="$5"

  : >"$out_log" || true
  for attempt in {1..5}; do
    echo "[run] mission inject attempt ${attempt} profile=${profile}" >>"$out_log"
    if run_timeout env -u OPENCLAW_GATEWAY_PORT "$OPENCLAW" --profile "$profile" system event \
      --url "$url" \
      --token "$token" \
      --mode now \
      --text "$text" \
      >>"$out_log" 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ROOM_ALIAS="${ROOM_ALIAS:-#market:localhost}"

SELLER_MISSION_TEXT="MISSION: You are SWITCH_SELLER. You are selling a Nintendo Switch. Anchor price: 200€. Absolute floor: 150€. You may negotiate down, but never below 150€.\n\nIMPORTANT: This is a fresh run. Ignore any room ids / context from previous runs.\nPOST TARGET (market room): ${MARKET_ROOM_ID} (room id), alias ${ROOM_ALIAS}.\nAction now: Post ONE listing message in that market room id (${MARKET_ROOM_ID}).\nFormat requirement: your listing MUST start with exactly: LISTING: \nWhen contacted in DM, negotiate for up to 8 turns. Be concise, no roleplay fluff."

# IMPORTANT: Matrix targets must be a room id/alias or a full MXID (e.g. @user:server).
# Give the buyer the seller's exact MXID and the market room id so routing can't guess wrong.
BUYER_MISSION_TEXT="MISSION: You are SWITCH_BUYER. You want to buy a Nintendo Switch. Max budget: 150€. Start offer: 120€. You can go up to 150€.\n\nIMPORTANT: This is a fresh run. Ignore any room ids / context from previous runs.\nMARKET ROOM (watch here): ${MARKET_ROOM_ID} (room id), alias ${ROOM_ALIAS}.\nWhen you see a Switch listing in that market room, DM the seller within 1 minute.\nDM TARGET: ${SELLER_MXID} (use exactly this MXID).\nNegotiate for up to 8 turns. Ask condition + accessories + pickup/shipping. Be concise."

if ! inject_mission "$SELLER_PROFILE" "ws://127.0.0.1:${SELLER_GATEWAY_PORT}" "$SELLER_GATEWAY_TOKEN" "$SELLER_MISSION_TEXT" "$SELLER_MISSION_LOG"; then
  log_step "inject_missions" "error" "seller mission injection failed"
  echo "[run] seller mission injection failed; see $SELLER_MISSION_LOG" >&2
  exit 1
fi

if ! inject_mission "$BUYER_PROFILE" "ws://127.0.0.1:${BUYER_GATEWAY_PORT}" "$BUYER_GATEWAY_TOKEN" "$BUYER_MISSION_TEXT" "$BUYER_MISSION_LOG"; then
  log_step "inject_missions" "error" "buyer mission injection failed"
  echo "[run] buyer mission injection failed; see $BUYER_MISSION_LOG" >&2
  exit 1
fi

log_step "inject_missions" "ok"

# 6) Seed market message as a deterministic kick (helps ensure the run starts).
# Use a distinct marker so we can tell it apart from the agent's own listing.

echo "[run] seeding market listing"
log_step "seed_market" "start"
curl_retry "${HOMESERVER}/_matrix/client/v3/rooms/${MARKET_ROOM_ID}/send/m.room.message/txn$(date +%s)" \
  "PUT" \
  '{"msgtype":"m.text","body":"SEED: (harness) market is open."}' \
  "${BUYER_TOKEN}"
log_step "seed_market" "ok"

# 7) Verify agent activity quickly (tight feedback loop)

echo "[run] verifying market activity"
log_step "verify_market" "start"
verify_seller_listing() {
  local deadline=$(( $(date +%s) + 120 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    # Fetch recent messages and check for a *non-seed* seller listing.
    local msgs
    msgs=$(curl -fsS --max-time 10 \
      -H "Authorization: Bearer ${SELLER_TOKEN}" \
      "${HOMESERVER}/_matrix/client/v3/rooms/${MARKET_ROOM_ID}/messages?dir=b&limit=30" 2>/dev/null || true)

    if node -e 'const j=JSON.parse(process.argv[1]||"{}");
      const chunk=j.chunk||[];
      const mxid=process.env.SELLER_MXID;
      const ok=chunk.some(ev=>{
        if (!ev || ev.type!=="m.room.message" || ev.sender!==mxid) return false;
        const body=ev.content && typeof ev.content.body==="string" ? ev.content.body : "";
        if (!body) return false;
        if (/^SEED:/i.test(body)) return false;
        return /^LISTING:/i.test(body);
      });
      process.exit(ok?0:1);' "$msgs"; then
      return 0
    fi

    sleep 2
  done
  return 1
}

if ! verify_seller_listing; then
  log_step "verify_market" "error" "no seller LISTING: message found within 120s"
  echo "[run] verify failed: seller did not post a LISTING: message within 120s" >&2
  exit 1
fi
log_step "verify_market" "ok"

# 7b) Verify buyer opened a DM with seller (ensures negotiation can happen)

echo "[run] verifying DM activity"
log_step "verify_dm" "start"
verify_dm_opened() {
  local deadline=$(( $(date +%s) + 90 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local joined
    joined=$(curl -fsS --max-time 10 \
      -H "Authorization: Bearer ${SELLER_TOKEN}" \
      "${HOMESERVER}/_matrix/client/v3/joined_rooms" 2>/dev/null || true)

    # Expect at least market room + 1 DM room
    if node -e 'const j=JSON.parse(process.argv[1]||"{}");
      const n=(j.joined_rooms||[]).length;
      process.exit(n>=2?0:1);' "$joined"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if ! verify_dm_opened; then
  log_step "verify_dm" "error" "no DM room opened within 90s"
  echo "[run] verify failed: no DM room opened within 90s" >&2
  exit 1
fi
log_step "verify_dm" "ok"

# 8) Let them run

echo "[run] running for ${RUN_MINUTES} minutes"
sleep "$((RUN_MINUTES * 60))"

# 8) Export transcripts

echo "[run] exporting transcripts"
log_step "export_transcripts" "start"
cat >"$OUT_DIR/meta.json" <<META
{
  "homeserver": "${HOMESERVER}",
  "marketRoomId": "${MARKET_ROOM_ID}",
  "seller": { "profile": "${SELLER_PROFILE}", "mxid": "${SELLER_MXID}" },
  "buyer": { "profile": "${BUYER_PROFILE}", "mxid": "${BUYER_MXID}" },
  "runMinutes": ${RUN_MINUTES}
}
META

node ./scripts/export_transcripts.mjs "$OUT_DIR" "$OUT_DIR/meta.json"
log_step "export_transcripts" "ok"

echo "[run] done. outputs in $OUT_DIR"
echo "[run] run id: $RUN_ID"
