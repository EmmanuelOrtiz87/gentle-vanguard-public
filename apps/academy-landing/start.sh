#!/usr/bin/env bash
# Compatibility alias: the public website now includes /academy/.
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
exec node --import tsx apps/corporate-web/scripts/lifecycle.ts start
