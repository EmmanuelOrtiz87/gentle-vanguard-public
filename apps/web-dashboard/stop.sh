#!/usr/bin/env bash
# web-dashboard — stop nativo. Delega en src/ops/dashboard-stop.ts (mata watchdogs primero).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT" || exit 1
node --import tsx src/ops/dashboard-stop.ts
sleep 1
for port in 5173 8080; do
  for pid in $(netstat -ano | grep ":$port " | grep LISTENING | awk '{print $5}' | sort -u); do
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 && echo "[dashboard] fallback puerto $port: terminado pid $pid"
  done
done
echo "[dashboard] stop completado"
