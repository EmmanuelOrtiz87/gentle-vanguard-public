#!/usr/bin/env bash
# academy-landing — stop nativo (pidfile + fallback por puerto). Idempotente.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="$ROOT/.runtime"
PIDFILE="$RUN/app-academy-landing-http.pid"
NAME="academy-landing"

pid="$(cat "$PIDFILE" 2>/dev/null || true)"
if [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1; then
  echo "[$NAME] terminado pid $pid"
fi
rm -f "$PIDFILE"

for p in $(netstat -ano | grep ":4174 " | grep LISTENING | awk '{print $5}' | sort -u); do
  if taskkill //F //T //PID "$p" >/dev/null 2>&1; then
    echo "[$NAME] fallback puerto 4174: terminado pid $p"
  fi
done

if netstat -ano | grep ":4174 " | grep -q LISTENING; then
  echo "[$NAME] ADVERTENCIA: puerto 4174 sigue ocupado" >&2
else
  echo "[$NAME] puerto 4174 libre"
fi
