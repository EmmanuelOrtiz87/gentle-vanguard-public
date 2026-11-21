/**
 * sh-launcher-audit.test.ts — el detector de CLIs intermedios y `wait`
 * bloqueante en los `start.sh` de apps.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * `audit:process-launchers` solo ve `child_process` en JS/TS. voice-studio
 * lanzaba la API/UI con `pnpm --filter … &: el CLI se vuelve hijo y relanza el
 * script como nieto por cmd/pnpm (consola visible, PID no atribuible), y un
 * `wait` desnudo bloqueaba la terminal. El detector tiene que VER esas dos
 * clases y NO confundir mensajes `echo` ni builds sincrónicos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditShLaunchers } from '../../src/tools/sh-launcher-audit.ts';

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), `gv-sh-launcher-${Date.now()}-`));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return root;
}

test.after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test('VE la indirección por CLI de gestor de paquetes', () => {
  const root = makeRoot({
    'apps/probe/start.sh':
      '#!/usr/bin/env bash\npnpm --filter @x/probe server:dev &\nnpx some-server\n',
  });
  const findings = auditShLaunchers(root);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.reason === 'package-manager-indirection'));
});

test('VE el wait desnudo que bloquea la terminal', () => {
  const root = makeRoot({
    'apps/probe/start.sh': '#!/usr/bin/env bash\nnode --import tsx server.ts &\nwait\n',
  });
  const findings = auditShLaunchers(root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].reason, 'blocking-wait');
});

test('VE cmd /c y start /B', () => {
  const root = makeRoot({
    'apps/probe/start.sh': '#!/usr/bin/env bash\ncmd /c node server.js\nstart /B node x.js\n',
  });
  const findings = auditShLaunchers(root);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.reason === 'visible-console-pattern'));
});

test('NO ve errores falsos: comentarios, echo y builds', () => {
  const root = makeRoot({
    'apps/probe/start.sh': [
      '#!/usr/bin/env bash',
      '# pnpm --filter @x/probe dev',
      'echo "Ejecutando npm start..."',
      '(cd "$APP" && npm run build) || exit 1',
      'nohup node --import tsx server.ts >>"$LOG" 2>&1 &',
      'wait $PID',
    ].join('\n'),
  });
  const findings = auditShLaunchers(root);
  assert.deepEqual(findings, [], 'comentario, echo, build y wait dirigido no se auditan');
});

test('el repo real no tiene launchers con CLIs intermedios ni wait bloqueante', () => {
  const findings = auditShLaunchers();
  assert.equal(
    findings.length,
    0,
    `hallazgos:\n${findings.map((f) => `  · ${f.file}:${f.line} ${f.reason} → ${f.text}`).join('\n')}`,
  );
});
