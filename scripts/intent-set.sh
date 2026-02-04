#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/intent-set.sh <phrase> [phrase...]"
  exit 1
fi

mkdir -p intent
{
  echo "# Lines in this file are matched (case-insensitive) against gossip messages."
  echo "# One phrase per line."
  echo
  for phrase in "$@"; do
    echo "$phrase"
  done
} > intent/intent.txt

echo "Updated intent/intent.txt"
