/**
 * declaration-audit.test.ts — contrato del auditor de declaraciones.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * Un auditor que nadie testea se pudre como todo lo demás: este archivo fija
 * el comportamiento que el gate transversal depende.
 *
 *   D1 · Toda ruta derivada que el código lee está declarada, y si es
 *        derivada tiene generador REAL (el script existe en package.json).
 *   D2 · Todo gate del catálogo con `enforced: true` tiene un ejecutor real
 *        (el token aparece en .lefthook.yml o en el composite de pre-push).
 *        Un gate aspiracional (`enforced: false`) es legítimo, pero tiene que
 *        decirlo con una nota.
 *   D3 · Todo control que afirma "hecho" tiene un test de contrato que
 *        menciona su identificador.
 *
 * Además: el auditor tiene que poder REPARAR (regenerar un derivado ausente
 * con su generador) y no puede inventar hallazgos (los falsos positivos son
 * tan dañinos como los falsos negativos: entrenan al operador a ignorar el
 * gate).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditDeclarations,
  covers,
  discoverReadPaths,
  loadLedger,
  stripYamlComments,
  type DeclarationLedger,
} from '../../src/tools/declaration-audit.ts';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `gv-decl-${Date.now()}-`));
  roots.push(root);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  // El auditor sólo exige declarar las rutas que NO viajan en el clon: el gris
  // es lo gitignored. El repo de prueba imita eso (git init + .gitignore).
  writeFileSync(
    join(root, '.gitignore'),
    ['.atl/', '.runtime/', '.session/', '.logs/', '.codegraph/', '.codex/', ''].join('\n'),
  );
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  } catch {
    // sin git no hay check-ignore: el test lo resuelve igual (ver abajo)
  }
  return root;
}

function writeLedger(root: string, ledger: Partial<DeclarationLedger>): void {
  const full: DeclarationLedger = {
    version: 1,
    derivedArtifacts: [],
    gates: [],
    controls: [],
    ...ledger,
  };
  writeFileSync(join(root, 'config', 'declarations.json'), JSON.stringify(full, null, 2));
}

function writeCatalogue(root: string, gates: Array<Record<string, unknown>>): void {
  writeFileSync(
    join(root, 'config', 'quality-gates.json'),
    JSON.stringify({ version: 1, gates }, null, 2),
  );
}

function writePackage(root: string, scripts: Record<string, string>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tmp', scripts }, null, 2));
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

// ── D1 · rutas derivadas ────────────────────────────────────────────────────

test('D1 · el repo real no tiene rutas derivadas leidas sin declarar', () => {
  const report = auditDeclarations();
  const errors = report.findings.filter((f) => f.severity === 'error');
  assert.equal(
    errors.length,
    0,
    `declaraciones pendientes:\n${errors.map((e) => `  · ${e.rule} ${e.subject}: ${e.message}`).join('\n')}`,
  );
  assert.ok(report.discoveredArtifacts > 0, 'el auditor tiene que descubrir rutas de verdad');
});

test('D1 · una ruta derivada leida y no declarada se reporta como error', () => {
  const root = makeRoot();
  writeLedger(root, {});
  writeCatalogue(root, []);
  writePackage(root, {});
  writeFileSync(join(root, 'src', 'reader.ts'), "export const p = '.atl/secreto.json';\n");

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/undeclared-artifact');
  assert.ok(finding, 'la ruta leida y no declarada tiene que aparecer');
  assert.equal(finding?.severity, 'error');
  assert.equal(finding?.subject, '.atl/secreto.json');
});

test('D1 · la raiz derivada se cubre con sus hijos declarados', () => {
  const declarations = [
    { path: '.atl/skill-registry.md', kind: 'derived' as const, generator: 'x' },
  ];
  assert.equal(covers(declarations, '.atl'), true, 'la raiz se cubre si hay hijos declarados');
  assert.equal(covers(declarations, '.atl/skill-registry.md'), true);
  assert.equal(
    covers(declarations, '.atl/otro.json'),
    false,
    'un hermano sin declarar no se cubre',
  );
  assert.equal(covers(declarations, '.runtime'), false);
});

test('D1 · el descubrimiento no inventa rutas (falsos positivos)', () => {
  const root = makeRoot();
  writeFileSync(
    join(root, 'src', 'x.ts'),
    [
      "const a = '#session';",
      "const b = '@opencode/codegraph';",
      "const c = 'opencode';",
      "const d = 'codex';",
      "const e = '.atl/real.json';",
    ].join('\n'),
  );
  const found = [...discoverReadPaths(root).keys()];
  assert.deepEqual(found, ['.atl/real.json'], `rutas descubiertas: ${found.join(', ')}`);
});

test('D1 · un derivado sin generador real se reporta como error', () => {
  const root = makeRoot();
  writeLedger(root, {
    derivedArtifacts: [{ path: '.atl/x.md', kind: 'derived', generator: 'no-existe' }],
  });
  writeCatalogue(root, []);
  writePackage(root, {});

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/missing-generator');
  assert.ok(finding, 'un generador inexistente tiene que ser error');
  assert.equal(finding?.severity, 'error');
});

test('D1 · --repair regenera el derivado ausente con su generador', () => {
  const root = makeRoot();
  writeFileSync(
    join(root, 'gen.js'),
    "require('fs').mkdirSync('.atl', { recursive: true });\n" +
      "require('fs').writeFileSync('.atl/x.md', 'generado\\n');\n",
  );
  writePackage(root, { gen: 'node gen.js' });
  writeCatalogue(root, []);
  writeLedger(root, {
    derivedArtifacts: [{ path: '.atl/x.md', kind: 'derived', generator: 'gen', required: true }],
  });

  const before = auditDeclarations({ root });
  assert.equal(before.errors, 1, 'sin reparar, el derivado ausente es error');

  const after = auditDeclarations({ root, repair: true });
  assert.equal(after.errors, 0, `hallazgos tras reparar: ${JSON.stringify(after.findings)}`);
  assert.deepEqual(after.repaired, ['.atl/x.md']);
  assert.ok(
    existsSync(join(root, '.atl', 'x.md')),
    'el generador tiene que haber escrito el archivo',
  );
});

// ── D2 · gates ──────────────────────────────────────────────────────────────

test('D2 · un gate enforced:true sin ejecutor es error (guardrail de mentira)', () => {
  const root = makeRoot();
  writeCatalogue(root, [{ id: 'g-falso', stage: 'pre-commit', enforced: true }]);
  writeLedger(root, { gates: [{ id: 'g-falso', executor: 'none', note: 'nota' }] });
  writePackage(root, {});

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/gate-without-executor');
  assert.ok(finding, 'el gate sin ejecutor tiene que ser error');
  assert.equal(finding?.severity, 'error');
});

test('D2 · un gate aspiracional (enforced:false) con nota NO es error', () => {
  const root = makeRoot();
  writeCatalogue(root, [{ id: 'g-asp', stage: 'pre-commit', enforced: false }]);
  writeLedger(root, { gates: [{ id: 'g-asp', executor: 'none', note: 'cubre otra cosa' }] });
  writePackage(root, {});

  const report = auditDeclarations({ root });
  assert.equal(report.errors, 0, JSON.stringify(report.findings));
});

test('D2 · un gate local cuyo comando no aparece en los hooks es error', () => {
  const root = makeRoot();
  writeCatalogue(root, [{ id: 'g-local', stage: 'pre-commit', enforced: true }]);
  writeLedger(root, {
    gates: [{ id: 'g-local', executor: 'local', command: 'token-inexistente' }],
  });
  writePackage(root, {});
  writeFileSync(
    join(root, '.lefthook.yml'),
    'pre-commit:\n  commands:\n    otro:\n      run: echo hola\n',
  );

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/gate-not-executed');
  assert.ok(finding, 'el token ausente tiene que ser error');
});

test('D2 · el token de un gate local se reconoce en .lefthook.yml', () => {
  const root = makeRoot();
  writeCatalogue(root, [{ id: 'g-local', stage: 'pre-commit', enforced: true }]);
  writeLedger(root, { gates: [{ id: 'g-local', executor: 'local', command: 'mi-check' }] });
  writePackage(root, {});
  writeFileSync(
    join(root, '.lefthook.yml'),
    'pre-commit:\n  commands:\n    mi-check:\n      run: node --import tsx src/x.ts\n',
  );

  const report = auditDeclarations({ root });
  assert.equal(report.errors, 0, JSON.stringify(report.findings));
});

test('D2 · un comentario de un hook NO cuenta como ejecución', () => {
  const root = makeRoot();
  writeCatalogue(root, [{ id: 'g-local', stage: 'pre-commit', enforced: true }]);
  writeLedger(root, { gates: [{ id: 'g-local', executor: 'local', command: 'mi-check' }] });
  writePackage(root, {});
  writeFileSync(
    join(root, '.lefthook.yml'),
    'pre-commit:\n  commands:\n    otro:\n      run: echo hola\n# mi-check removed 2026-01-01\n',
  );

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/gate-not-executed');
  assert.ok(finding, 'un gate mencionado sólo en un comentario no se está ejecutando');
});

test('D2 · un check de CI sin espejo local es aviso, no error', () => {
  const root = makeRoot();
  writeCatalogue(root, [{ id: 'ci-x', stage: 'ci', enforced: true }]);
  writeLedger(root, {
    gates: [{ id: 'ci-x', executor: 'workflow', workflow: '.github/workflows/ci.yml' }],
  });
  writePackage(root, {});
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');

  const report = auditDeclarations({ root });
  assert.equal(report.errors, 0, JSON.stringify(report.findings));
  assert.equal(report.warnings, 1, 'sin espejo local tiene que quedar avisado');
});

// ── D3 · controles ──────────────────────────────────────────────────────────

test('D3 · un control sin test de contrato es error', () => {
  const root = makeRoot();
  writeCatalogue(root, []);
  writePackage(root, {});
  writeLedger(root, {
    controls: [{ id: 'ctrl:x', surface: 'POST /x', contractTest: 'tests/unit/x.test.ts' }],
  });

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/control-without-test');
  assert.ok(finding, 'el control sin test tiene que ser error');
});

test('D3 · un control cuyo test no menciona su id es error', () => {
  const root = makeRoot();
  writeCatalogue(root, []);
  writePackage(root, {});
  mkdirSync(join(root, 'tests', 'unit'), { recursive: true });
  writeFileSync(join(root, 'tests', 'unit', 'x.test.ts'), "test('algo', () => {});\n");
  writeLedger(root, {
    controls: [{ id: 'ctrl:x', surface: 'POST /x', contractTest: 'tests/unit/x.test.ts' }],
  });

  const report = auditDeclarations({ root });
  const finding = report.findings.find((f) => f.rule === 'declaration/control-test-unlinked');
  assert.ok(finding, 'el test tiene que enlazar el control por su id');
});

test('D3 · un control enlazado a su test NO es error', () => {
  const root = makeRoot();
  writeCatalogue(root, []);
  writePackage(root, {});
  mkdirSync(join(root, 'tests', 'unit'), { recursive: true });
  writeFileSync(join(root, 'tests', 'unit', 'x.test.ts'), "// ctrl:x\ntest('algo', () => {});\n");
  writeLedger(root, {
    controls: [{ id: 'ctrl:x', surface: 'POST /x', contractTest: 'tests/unit/x.test.ts' }],
  });

  const report = auditDeclarations({ root });
  assert.equal(report.errors, 0, JSON.stringify(report.findings));
});

// ── utilidades ──────────────────────────────────────────────────────────────

test('los comentarios de un YAML se eliminan antes de certificar ejecución', () => {
  const text = ['# comentario', 'pre-commit:', '  # otro', '    run: echo hola'].join('\n');
  assert.equal(stripYamlComments(text).includes('comentario'), false);
  assert.ok(stripYamlComments(text).includes('echo hola'));
});

test('el ledger real declara los tres tipos de superficie', () => {
  const ledger = loadLedger();
  assert.ok(ledger.derivedArtifacts.length > 0, 'hay artefactos derivados/runtime declarados');
  assert.ok(ledger.gates.length > 0, 'hay gates declarados');
  assert.ok(ledger.controls.length > 0, 'hay controles declarados');
});
