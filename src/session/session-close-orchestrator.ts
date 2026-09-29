#!/usr/bin/env node
/**
 * Session Close Orchestrator
 *
 * Orquesta el protocolo completo de cierre de sesión en 6 fases:
 *   PRE-CLOSE → PERSIST → BACKUP → AUDIT → CLEANUP → VERIFY
 *
 * 100% autónomo. Se ejecuta automáticamente al detectar fin de sesión
 * o a demanda vía CLI.
 *
 * Uso:
 *   npx tsx src/session/session-close-orchestrator.ts
 *   npx tsx src/session/session-close-orchestrator.ts --reason "maintenance"
 *   npx tsx src/session/session-close-orchestrator.ts --verify
 *   npx tsx src/session/session-close-orchestrator.ts --validate --deep
 *   npx tsx src/session/session-close-orchestrator.ts --validate --full --auto-fix
 */

import { pathToFileURL } from 'url';
import { LOG } from './session-close/helpers.js';
import { main } from './session-close/index.js';

export { runCloseOrchestrator } from './session-close/index.js';
export type { CloseReport } from './session-close/index.js';

// ─── CLI ────────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    LOG.error('FATAL: ' + e.message);
    process.exit(1);
  });
}
