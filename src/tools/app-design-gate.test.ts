/**
 * app-design-gate.test.ts — el gate real de NORM-APP-001.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * La norma de apps listaba verificaciones (BRAND-KIT, manifiesto, capturas,
 * DESIGN.md/waiver) que nadie ejecutaba. El gate las convierte en contratos:
 * waiver obligatorio para apps de cliente, declaración ratcheteada para las
 * nativas, manifiesto para superficies web y evidencia visual cuando una
 * declaración dice "homologada". Debe VER cada clase y respetar el baseline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditAppDesign } from './app-design-gate.ts';

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), `gv-app-design-${Date.now()}-`));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return root;
}

const BRAND = {
  'docs/brand/BRAND-KIT.md': '# kit\n',
  'docs/brand/OFFICIAL-ASSETS-2026-10.md': '# assets\n',
  'assets/gv-fonts.css': '/* fonts */\n',
};

test.after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test('VE una app de cliente sin waiver', () => {
  const root = makeRoot({
    ...BRAND,
    'config/apps.registry.json': JSON.stringify({
      apps: [{ id: 'x', scope: 'client', dir: 'apps/cliente-x' }],
    }),
    'apps/cliente-x/server.mjs': '// app\n',
  });
  const report = auditAppDesign(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.kind === 'client-waiver-missing'));
});

test('VE una app web sin manifiesto y una homologación sin evidencia', () => {
  const root = makeRoot({
    ...BRAND,
    'config/apps.registry.json': JSON.stringify({
      apps: [{ id: 'y', scope: 'native', dir: 'apps/web-y' }],
    }),
    'apps/web-y/index.html': '<html></html>\n',
    'apps/web-y/DESIGN.md': '# Diseño — identidad homologada al canon GV\n',
  });
  const report = auditAppDesign(root);
  assert.ok(report.findings.some((f) => f.kind === 'manifest-missing'));
  assert.ok(report.findings.some((f) => f.kind === 'homologation-without-evidence'));
});

test('la homologación CON evidencia existente no falla', () => {
  const root = makeRoot({
    ...BRAND,
    'config/apps.registry.json': JSON.stringify({
      apps: [{ id: 'z', scope: 'native', dir: 'apps/web-z' }],
    }),
    'apps/web-z/index.html': '<html></html>\n',
    'apps/web-z/public/manifest.webmanifest': '{}\n',
    'apps/web-z/DESIGN.md': '# Identidad GV homologada\n\nCaptura: `tests/screenshots/home.png`\n',
    'apps/web-z/tests/screenshots/home.png': 'png\n',
  });
  const report = auditAppDesign(root);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
});

test('el baseline exime lo histórico; strict NO', () => {
  const root = makeRoot({
    ...BRAND,
    'config/apps.registry.json': JSON.stringify({
      apps: [{ id: 'w', scope: 'native', dir: 'apps/legacy-w' }],
    }),
    'config/app-design-baseline.json': JSON.stringify({
      undeclaredNative: ['legacy-w'],
      clientWithoutWaiver: [],
      webAppsWithoutManifest: [],
    }),
    'apps/legacy-w/server.mjs': '// app\n',
  });
  assert.equal(auditAppDesign(root).ok, true, 'baseline exime');
  assert.equal(auditAppDesign(root, true).ok, false, 'strict no exime');
  const app = auditAppDesign(root).findings.find((f) => f.app === 'legacy-w');
  assert.equal(app, undefined, 'la app legacy no genera hallazgo');
});

test('una app NUEVA sin declaración falla aunque haya baseline', () => {
  const root = makeRoot({
    ...BRAND,
    'config/apps.registry.json': JSON.stringify({
      apps: [{ id: 'n', scope: 'native', dir: 'apps/nueva-n' }],
    }),
    'config/app-design-baseline.json': JSON.stringify({
      undeclaredNative: ['otra-vieja'],
      clientWithoutWaiver: [],
      webAppsWithoutManifest: [],
    }),
    'apps/nueva-n/server.mjs': '// app\n',
  });
  const report = auditAppDesign(root);
  assert.equal(report.ok, false);
  assert.ok(
    report.findings.some((f) => f.kind === 'native-declaration-missing' && f.app === 'nueva-n'),
  );
});

test('falta de BRAND-KIT es hallazgo de repo', () => {
  const root = makeRoot({
    'assets/gv-fonts.css': '/* fonts */\n',
    'apps/vacia/server.mjs': '// app\n',
  });
  const report = auditAppDesign(root);
  assert.equal(report.findings.filter((f) => f.kind === 'brand-prerequisite').length, 2);
});

test('el repo real cumple con el baseline vigente', () => {
  const report = auditAppDesign();
  assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
});
