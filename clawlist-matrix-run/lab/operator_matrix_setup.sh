#!/usr/bin/env bash
set -euo pipefail

# Ensure a dedicated Matrix user exists for operator-bot and cache its token locally.
# Writes/updates clawlist-matrix-run/.local/secrets.env with:
#   OPERATOR_TOKEN=...
#   OPERATOR_MXID=@operator:localhost

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/.local/bootstrap.env"

HS="${HOMESERVER:-http://127.0.0.1:18008}"
SYNAPSE_CONTAINER="${SYNAPSE_CONTAINER:-infra_synapse_1}"
SECRETS_ENV="${SECRETS_ENV:-$ROOT_DIR/.local/secrets.env}"

OP_USER_LOCALPART="${OP_USER_LOCALPART:-operator}"
OP_PASS="${OP_PASS:-OperatorPass123!}"
OPERATOR_MXID="@${OP_USER_LOCALPART}:localhost"

mkdir -p "$(dirname "$SECRETS_ENV")"
umask 077

# If cached token works, keep it.
if [ -f "$SECRETS_ENV" ]; then
  # shellcheck disable=SC1090
  source "$SECRETS_ENV" || true
fi

token_ok() {
  local token="$1"
  [ -n "${token:-}" ] || return 1
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    "$HS/_matrix/client/v3/account/whoami" || true)
  [ "$code" = "200" ]
}

if token_ok "${OPERATOR_TOKEN:-}"; then
  echo "[operator_matrix_setup] using cached OPERATOR_TOKEN from $SECRETS_ENV" >&2
  echo "[operator_matrix_setup] operator mxid=$OPERATOR_MXID" >&2
  exit 0
fi

# Create user (idempotent)
docker exec -i "${SYNAPSE_CONTAINER}" register_new_matrix_user \
  -c /data/homeserver.yaml http://127.0.0.1:8008 \
  -u "$OP_USER_LOCALPART" -p "$OP_PASS" --no-admin >/dev/null 2>&1 || true

# Login
login=$(curl -fsS -X POST "$HS/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"'"${OP_USER_LOCALPART}"'"},"password":"'"${OP_PASS}"'"}')

OPERATOR_TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.access_token||"")' "$login")
[ -n "$OPERATOR_TOKEN" ] || { echo "[operator_matrix_setup] ERROR: login did not return access_token: $login" >&2; exit 1; }

# Update secrets.env (preserve existing vars)
SECRETS_ENV="$SECRETS_ENV" OPERATOR_TOKEN="$OPERATOR_TOKEN" OPERATOR_MXID="$OPERATOR_MXID" \
node - <<'NODE'
const fs = require('fs');
const path = process.env.SECRETS_ENV;
if (!path) throw new Error('SECRETS_ENV not set');
const add = {
  OPERATOR_TOKEN: process.env.OPERATOR_TOKEN,
  OPERATOR_MXID: process.env.OPERATOR_MXID,
};
let lines = [];
if (fs.existsSync(path)) lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
const m = new Map();
for (const l of lines) {
  const i = l.indexOf('=');
  if (i > 0) m.set(l.slice(0, i), l.slice(i + 1));
}
for (const [k, v] of Object.entries(add)) if (v) m.set(k, v);
const out = [...m.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
fs.writeFileSync(path, out, 'utf8');
NODE

chmod 600 "$SECRETS_ENV" 2>/dev/null || true

# Ensure operator joins the stable market room (so Telegram→Matrix posts work without manual invites)
if [ -n "${ROOM_ID:-}" ]; then
  curl -fsS -X POST "$HS/_matrix/client/v3/rooms/${ROOM_ID}/join" \
    -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{}' >/dev/null || true
fi

echo "[operator_matrix_setup] wrote OPERATOR_TOKEN to $SECRETS_ENV (mxid=$OPERATOR_MXID)" >&2
