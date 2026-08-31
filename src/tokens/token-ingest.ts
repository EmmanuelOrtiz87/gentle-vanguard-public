#!/usr/bin/env node
/**
 * Token Ingest — daemon de ingesta AGNÓSTICA de tokens reales.
 *
 * Lee los datos de uso que CADA herramienta persiste en disco (sin depender
 * de plugins de ninguna tool) y los consolida en el stack:
 *   - opencode : SQLite  ~/.local/share/opencode/opencode.db  (tabla `session`)
 *   - zcode    : JSONL   ~/.zcode/cli/rollout/model-io-sess_*.jsonl (usage por request)
 *   - codex    : JSONL   ~/.codex/sessions/ (rollout-*.jsonl anidados por fecha, eventos token_count)
 *   - minimax  : SQLite  ~/.minimax/v2/sqlite/runtime-state.sqlite (tabla local_runtime_token_usage)
 *   - Claude   : JSONL   ~/.claude/projects (pendiente)
 *   - Cursor   : SQLite/JSON local (pendiente)
 *
 * Escribe:
 *   - Nexus DB `token_usage` (persistencia real, vía better-sqlite3 directo)
 *   - .session/token-usage.json          (canonical del stack)
 *   - .session/session-current.json      (actualiza totales de la sesión viva)
 *   - reports/stack-live-observability-latest.json (report REAL, reemplaza el stale)
 *   - .runtime/token-ingest.log          (historial append-only)
 *
 * Uso:
 *   npx tsx src/tokens/token-ingest.ts --once            # una pasada
 *   npx tsx src/tokens/token-ingest.ts --watch [secs]    # bucle cada N segundos
 *   npx tsx src/tokens/token-ingest.ts --session <id>    # solo una sesión (debug)
 */

import { pathToFileURL } from 'url';
import { generateTraceabilityReport, ingestOnce, log, watch } from './token-ingest/index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--watch')) {
    const idx = args.indexOf('--watch');
    const secs = idx + 1 < args.length ? parseInt(args[idx + 1], 10) : 30;
    await watch(isNaN(secs) ? 30 : secs);
  } else if (args.includes('--report')) {
    console.log(generateTraceabilityReport());
  } else {
    const r = ingestOnce();
    console.log(JSON.stringify(r, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
