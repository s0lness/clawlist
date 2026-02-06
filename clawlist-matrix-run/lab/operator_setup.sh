#!/usr/bin/env bash
set -euo pipefail

# Configure the operator-bot profile to accept Telegram DMs from Sylve and also join Matrix.
# Secrets:
# - Telegram bot token must be stored locally in: clawlist-matrix-run/.local/operator.telegram.token
#   (gitignored). Do NOT commit it.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="${PROFILE:-operator-bot}"
TELEGRAM_TOKEN_FILE="${TELEGRAM_TOKEN_FILE:-$ROOT_DIR/.local/operator.telegram.token}"
ALLOW_FROM_ID="${ALLOW_FROM_ID:-215094483}"

# Matrix config inputs (created by lab/bootstrap.sh)
source "$ROOT_DIR/.local/bootstrap.env"
source "$ROOT_DIR/.local/secrets.env" || true

[ -f "$TELEGRAM_TOKEN_FILE" ] || {
  echo "[operator_setup] ERROR: missing Telegram token file: $TELEGRAM_TOKEN_FILE" >&2
  echo "[operator_setup] Create it locally, e.g.:" >&2
  echo "[operator_setup]   umask 077; mkdir -p $ROOT_DIR/.local; echo '<BOT_TOKEN>' > $TELEGRAM_TOKEN_FILE; chmod 600 $TELEGRAM_TOKEN_FILE" >&2
  exit 1
}

# Telegram (DM allowlist only)
openclaw --profile "$PROFILE" config set --json 'channels.telegram' \
  "{ enabled: true, tokenFile: '${TELEGRAM_TOKEN_FILE}', dmPolicy: 'allowlist', allowFrom: ['${ALLOW_FROM_ID}'], groupPolicy: 'disabled' }" \
  >/dev/null

echo "[operator_setup] configured Telegram for profile=$PROFILE (DM allowlist=${ALLOW_FROM_ID})"

# Set model to Claude Sonnet to avoid ChatGPT rate limits
OPERATOR_MODEL="${OPERATOR_MODEL:-anthropic/claude-sonnet-4-5}"
openclaw --profile "$PROFILE" config set agents.defaults.model.primary "$OPERATOR_MODEL" >/dev/null 2>&1 || true

# Matrix: use a dedicated operator Matrix user (created via operator_matrix_setup.sh)
./lab/operator_matrix_setup.sh >/dev/null
# shellcheck disable=SC1090
source "$ROOT_DIR/.local/secrets.env"

openclaw --profile "$PROFILE" config set --json 'channels.matrix' \
  "{ enabled: true, homeserver: '${HOMESERVER}', accessToken: '${OPERATOR_TOKEN}', userId: '${OPERATOR_MXID}', encryption: false, dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open', groups: { '*': { requireMention: true }, '${ROOM_ID}': { allow: true, requireMention: true } } }" \
  >/dev/null

echo "[operator_setup] configured Matrix userId=${OPERATOR_MXID} (homeserver=${HOMESERVER}, requireMention=true)"

# Allow the operator (bound to Telegram) to post into Matrix explicitly.
# This is blocked by default to prevent cross-channel leaks.
openclaw --profile "$PROFILE" config set --json 'tools.message.crossContext' \
  '{ allowAcrossProviders: true, marker: { enabled: true, prefix: "[from {channel}] " } }' \
  >/dev/null || true

echo "[operator_setup] enabled cross-provider messaging for message tool (Telegram → Matrix)"
