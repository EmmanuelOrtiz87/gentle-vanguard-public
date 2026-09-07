#!/usr/bin/env bash
# web-dashboard — start nativo. Delega en src/ops/dashboard-start.ts (WS watchdog + Vite).
# Puertos: WS dinámico (.runtime/dashboard-ports.json, default 8080) + Vite 5173.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="$ROOT/.runtime"

ws_port() {
  node -e "try{console.log(JSON.parse(require('fs').readFileSync('$RUN/dashboard-ports.json','utf8')).wsPort??8080)}catch{console.log(8080)}"
}

WP="$(ws_port)"
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$WP/api/health"; then
  echo "[dashboard] WS ya responde en puerto $WP — nada que hacer"
  exit 0
fi
cd "$ROOT" || exit 1
node --import tsx src/ops/dashboard-start.ts --no-browser
