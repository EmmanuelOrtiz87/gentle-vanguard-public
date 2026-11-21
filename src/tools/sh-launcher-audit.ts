#!/usr/bin/env node

/**
 * sh-launcher-audit.ts — los `start.sh` de apps no pueden encadenar CLIs de
 * gestor de paquetes ni bloquear la terminal.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * `audit:process-launchers` solo ve llamadas `child_process` en JS/TS. La
 * clase que quedaba ciega vive en shell:
 *
 *   · `pnpm --filter … server:dev` / `npx …` / `npm start`: el CLI del gestor
 *     se vuelve proceso hijo y relanza el script como NIETO por cmd/pnpm —
 *     consola visible, PID no atribuible (voice-studio lo hacía en `both`).
 *   · `cmd /c`, `start /B`, `powershell`: ventanas fantasma directas.
 *   · `wait` desnudo: el start.sh nunca retorna y bloquea la terminal de quien
 *     lo lanza desde Git Bash.
 *
 * La regla del stack es el proceso hijo DIRECTO (`nohup node … &`) con su
 * pidfile — el mismo patrón de archify/content-cms. Builds y tests
 * (`npm run build`, `pnpm build`) son sincrónicos en primer plano: permitidos.
 *
 * USO
 *   node --import tsx src/tools/sh-launcher-audit.ts
 *   node --import tsx src/tools/sh-launcher-audit.ts --json
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EXCLUDED = new Set(['node_modules', '.git', '.runtime', '.session', 'dist', 'build']);

export interface ShFinding {
  file: string;
  line: number;
  reason: 'package-manager-indirection' | 'visible-console-pattern' | 'blocking-wait';
  text: string;
}

const INDIRECTION_RE =
  /\b(?:pnpm\s+(?:--filter|exec|run\s+(?:start|dev|serve|preview))|npx\s|npm\s+(?:start|run\s+(?:start|dev|serve|preview)))\b/;
const VISIBLE_CONSOLE_RE = /\b(?:cmd\s+\/[ck]\b|start\s+\/B\b|powershell(?:\.exe)?\b)/i;
const BARE_WAIT_RE = /^\s*wait\s*$/;

function* shellLaunchers(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as never;
  } catch {
    return;
  }
  for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* shellLaunchers(full);
      continue;
    }
    if (!entry.name.endsWith('.sh')) continue;
    if (!/^(start|stop|run|serve|launch|dev)[.-]/.test(entry.name)) continue;
    yield full;
  }
}

export function auditShLaunchers(root = ROOT): ShFinding[] {
  const findings: ShFinding[] = [];
  for (const file of shellLaunchers(join(root, 'apps'))) {
    const rel = relative(root, file).replace(/\\/g, '/');
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    source.split('\n').forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      // Mensajes de consola («Ejecutando npm start...») no son comandos.
      if (/^echo\b/.test(line)) return;
      let reason: ShFinding['reason'] | null = null;
      if (INDIRECTION_RE.test(line)) reason = 'package-manager-indirection';
      else if (VISIBLE_CONSOLE_RE.test(line)) reason = 'visible-console-pattern';
      else if (BARE_WAIT_RE.test(line)) reason = 'blocking-wait';
      if (!reason) return;
      findings.push({ file: rel, line: index + 1, reason, text: line.slice(0, 160) });
    });
  }
  return findings;
}

function main(): void {
  const findings = auditShLaunchers();
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify({ ok: findings.length === 0, total: findings.length, findings }, null, 2),
    );
  } else {
    console.log(`[sh-launcher-audit] findings: ${findings.length}`);
    for (const f of findings) {
      console.log(`  ${f.reason}: ${f.file}:${f.line}`);
      console.log(`    ${f.text}`);
    }
    if (findings.length === 0) {
      console.log('  OK: los launchers de apps usan node directo, sin CLIs intermedios ni wait');
    }
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
