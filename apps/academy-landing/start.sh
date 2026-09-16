#!/usr/bin/env bash
# academy-landing — start nativo (estático, python http.server :4174). Idempotente.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/apps/academy-landing"
RUN="$ROOT/.runtime"
PIDFILE="$RUN/app-academy-landing-http.pid"
NAME="academy-landing"
mkdir -p "$RUN"

if netstat -ano | grep ":4174 " | grep -q LISTENING; then
  echo "[$NAME] puerto 4174 ya en escucha — nada que hacer"
  exit 0
fi
if [ -f "$PIDFILE" ]; then
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$PIDFILE"
fi

(
  cd "$APP" || exit 1
  nohup python -m http.server 4174 --bind 127.0.0.1 -d . >>"$RUN/app-academy-landing-http.log" 2>&1 &
  mpid=$!
  wpid=$(cat "/proc/$mpid/winpid" 2>/dev/null || echo "$mpid")
  printf '%s\n' "$wpid" > "$PIDFILE"
)
echo "[$NAME] iniciado (pid $(cat "$PIDFILE" 2>/dev/null)) — http://127.0.0.1:4174"
