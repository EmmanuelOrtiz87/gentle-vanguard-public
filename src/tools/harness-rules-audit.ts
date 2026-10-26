#!/usr/bin/env node
/**
 * harness-rules-audit.ts — Inventario de que reglas del stack son medibles.
 *
 * El bucle solo puede medir el cumplimiento de una regla que dice QUE TOKEN
 * LITERAL escribir. Esta auditoria (estatica, sin modelo) dice que parte de la
 * superficie es medible hoy y que parte es discurso.
 *
 *   npx tsx src/tools/harness-rules-audit.ts [--json] [--limit N]
 */

import { resolve } from 'node:path';

import { GV_SURFACE, readSurfaceTree } from '../core/harness-surface.js';
import { auditRules, renderRulesAudit } from '../eval/rules-audit.js';

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');

function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

const tree = readSurfaceTree(GV_SURFACE, ROOT);
const audit = auditRules(tree);

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
} else {
  process.stdout.write(`${renderRulesAudit(audit)}\n`);
}

const limit = Number(arg('limit') ?? '0');
if (limit > 0 && audit.unmeasurable.length > limit) {
  process.stderr.write(
    `\n(${audit.unmeasurable.length} reglas con obligacion sin token literal; usa --json para el detalle)\n`
  );
}

// El auditor no falla: es un inventario, no un gate. El gate es el doctor.
process.exit(0);
