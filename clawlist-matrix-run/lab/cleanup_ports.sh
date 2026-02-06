#!/usr/bin/env bash
set -euo pipefail

# Kill any openclaw-gateway processes listening on the common clawlist harness ports.
# Safe-ish: targets by port, not by name.

PORTS="${PORTS:-18791,18793,18795}"

kill_pid() {
  local pid="$1" port="$2"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[cleanup_ports] killing pid=$pid on port=$port"
    kill "$pid" || true
  fi
}

IFS=',' read -ra arr <<<"$PORTS"
for port in "${arr[@]}"; do
  pid=$(ss -ltnp 2>/dev/null | sed -n "s/.*[:\]]${port} .*pid=\([0-9]\+\).*/\1/p" | head -n 1)
  if [ -z "$pid" ]; then
    echo "[cleanup_ports] port $port: free"
    continue
  fi
  kill_pid "$pid" "$port"
done

sleep 0.5

# Report
for port in "${arr[@]}"; do
  if ss -ltnH 2>/dev/null | grep -Eq "[:\]]${port}\\b"; then
    echo "[cleanup_ports] WARN: port $port still in use"
  else
    echo "[cleanup_ports] port $port: free"
  fi
done
