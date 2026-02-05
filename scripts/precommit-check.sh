#!/usr/bin/env bash
set -euo pipefail

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"
if [ -z "$staged_files" ]; then
  exit 0
fi

blocked=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    logs/*|runs/*|clawlist-matrix-run/runs/*|clawlist-matrix-run/out/*|clawlist-matrix-run/synapse-data/*|clawlist-matrix-run/synapse-data2/*|config/agent_*.json|config/scenario.local.json|*.env|*.env.*|*secrets.env)
      blocked+=("$f")
      ;;
  esac
done <<< "$staged_files"

if [ "${#blocked[@]}" -gt 0 ]; then
  echo "Blocked commit: local/internal artifacts are staged:" >&2
  for f in "${blocked[@]}"; do
    echo "  - $f" >&2
  done
  echo "Use tracked templates (e.g. config/*.example.json) and keep runtime outputs untracked." >&2
  exit 1
fi

# Scan added lines only to reduce false positives (skip diff metadata lines like "+++ b/file").
added_lines="$(git diff --cached --unified=0 --no-color | rg '^\+[^+]' || true)"

# Allow known placeholders used in docs/templates.
filtered_lines="$(printf '%s\n' "$added_lines" | rg -vi '(changeme|your_token|token-switch-seller|token-switch-buyer|example_token|dummy_token)' || true)"

secret_hits="$(
  printf '%s\n' "$filtered_lines" | rg -n \
    "Authorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._-]{16,}|syt_[A-Za-z0-9._=-]{16,}|(SELLER_TOKEN|BUYER_TOKEN|access_token|openclaw_token|password)[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9._=-]{16,}" \
    || true
)"

if [ -n "$secret_hits" ]; then
  echo "Blocked commit: possible secret/token content in staged diff:" >&2
  printf '%s\n' "$secret_hits" >&2
  echo "If this is intentional test data, replace with placeholders like 'changeme'." >&2
  exit 1
fi

exit 0
