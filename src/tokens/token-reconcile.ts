#!/usr/bin/env node
/**
 * Token Reconcile — repara los agregados `token_usage` desde `token_transactions`.
 *
 * El ingest incremental (codex/zcode/minimax/claude) sobrescribía el agregado
 * por sesión con la última ventana, sub-reportando el uso real que consumen
 * el guard de presupuesto y `token:status`. Este comando eleva cada agregado
 * al mínimo real dictado por sus transacciones (idempotente, monotónico).
 *
 * Uso:
 *   npm run token:reconcile
 */

import { pathToFileURL } from 'url';
import { reconcileTokenUsage } from './token-ingest/nexus.js';

function main(): void {
  console.log(JSON.stringify(reconcileTokenUsage(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
