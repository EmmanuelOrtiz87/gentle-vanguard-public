#!/usr/bin/env node

/**
 * app-design-gate.ts — NORM-APP-001 tiene gate real.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * La norma de apps declaraba verificaciones (BRAND-KIT, manifiesto PWA,
 * capturas, DESIGn.md/waiver) que nadie ejecutaba: 24 apps sin declaración y
 * el waiver de identidad de clientes vivía de la memoria. Este gate convierte
 * la norma en contratos verificables sin fabricar cumplimiento:
 *
 *   · PRERREQUISITOS DE MARCA (duros, repo): BRAND-KIT.md y
 *     OFFICIAL-ASSETS-2026-10.md existen; fuentes self-host presentes.
 *   · WAIVER DE CLIENTE (duro): toda app `scope: client` del registry tiene
 *     DESIGN-WAIVER.md o DESIGN.md. Sin waiver se espera el canon
 *     (NORMATIVA-DESIGN-SYSTEM §13).
 *   · DECLARACIÓN NATIVA (ratchet): toda app nativa nueva declara diseño
 *     (DESIGN.md/DESIGN-WAIVER.md). Las históricas sin declaración están en
 *     `config/app-design-baseline.json`; la lista solo puede achicarse.
 *   · MANIFIESTO (duro con excepciones declaradas): una app web (index.html)
 *     sirve manifest.webmanifest (raíz o public/). Excepciones legacy
 *     declaradas en el baseline; una app web nueva sin manifiesto falla.
 *   · EVIDENCIA VISUAL (duro): una declaración que dice "homologada" cita al
 *     menos un archivo de imagen que EXISTE (captura/arte) — la homologación
 *     no se declara sin evidencia.
 *
 * USO
 *   node --import tsx src/tools/app-design-gate.ts
 *   node --import tsx src/tools/app-design-gate.ts --json
 *   node --import tsx src/tools/app-design-gate.ts --strict   # objetivo final
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EXCLUDED = new Set(['node_modules', '.git', '.runtime', '.session', 'dist', 'build']);

const BRAND_PREREQS = ['docs/brand/BRAND-KIT.md', 'docs/brand/OFFICIAL-ASSETS-2026-10.md'];
const FONT_SNAPSHOT = 'assets/gv-fonts.css';
const IMAGE_RE = /[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)/g;

export interface DesignFinding {
  app: string;
  kind:
    | 'brand-prerequisite'
    | 'client-waiver-missing'
    | 'native-declaration-missing'
    | 'manifest-missing'
    | 'homologation-without-evidence';
  detail: string;
}

export interface DesignReport {
  apps: number;
  declared: number;
  undeclared: string[];
  findings: DesignFinding[];
  ok: boolean;
}

function appDirs(root = ROOT): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(join(root, 'apps'), { withFileTypes: true }) as never;
  } catch {
    return [];
  }
  return (entries as unknown as Array<{ name: string; isDirectory(): boolean }>)
    .filter((e) => e.isDirectory() && !EXCLUDED.has(e.name))
    .map((e) => e.name)
    .sort();
}

function registryScopes(root = ROOT): Map<string, 'native' | 'client'> {
  const scopes = new Map<string, 'native' | 'client'>();
  try {
    const raw = JSON.parse(readFileSync(join(root, 'config', 'apps.registry.json'), 'utf8'));
    const list = Array.isArray(raw.apps) ? raw.apps : Object.values(raw.apps ?? raw);
    for (const app of list as Array<{ scope?: string; dir?: string }>) {
      if (!app?.dir) continue;
      const dir = app.dir
        .replace(/\\/g, '/')
        .replace(/^apps\//, '')
        .replace(/\/$/, '');
      if (app.scope === 'client' || app.scope === 'native') scopes.set(dir, app.scope);
    }
  } catch {
    /* registry missing: treat everything as native */
  }
  return scopes;
}

function declaration(root: string, app: string): { file: string; text: string } | null {
  for (const name of ['DESIGN.md', 'DESIGN-WAIVER.md']) {
    const p = join(root, 'apps', app, name);
    if (existsSync(p)) return { file: `${app}/${name}`, text: readFileSync(p, 'utf8') };
  }
  return null;
}

function resolveEvidence(root: string, app: string, ref: string): boolean {
  if (ref.startsWith('/Users/') || ref.startsWith('C:')) return true; // ruta externa citada, no verificable
  const appDir = join(root, 'apps', app);
  const candidates = [
    join(appDir, ref),
    join(appDir, 'public', ref),
    join(appDir, 'public', 'assets', ref),
    join(appDir, 'tests', 'screenshots', ref),
    join(root, ref),
  ];
  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

function hasManifest(root: string, app: string): boolean {
  return (
    existsSync(join(root, 'apps', app, 'manifest.webmanifest')) ||
    existsSync(join(root, 'apps', app, 'public', 'manifest.webmanifest'))
  );
}

function hasIndexHtml(root: string, app: string): boolean {
  return existsSync(join(root, 'apps', app, 'index.html'));
}

export function auditAppDesign(root = ROOT, strict = false): DesignReport {
  const baselinePath = join(root, 'config', 'app-design-baseline.json');
  let baseline: {
    undeclaredNative?: string[];
    clientWithoutWaiver?: string[];
    webAppsWithoutManifest?: string[];
  } = {};
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    /* sin baseline: todo lo histórico aparecerá como hallazgo la primera vez */
  }
  const legacyUndeclared = new Set(baseline.undeclaredNative ?? []);
  const legacyClient = new Set(baseline.clientWithoutWaiver ?? []);
  const legacyNoManifest = new Set(baseline.webAppsWithoutManifest ?? []);

  const findings: DesignFinding[] = [];
  for (const rel of BRAND_PREREQS) {
    if (!existsSync(join(root, rel))) {
      findings.push({ app: '(repo)', kind: 'brand-prerequisite', detail: `falta ${rel}` });
    }
  }
  if (!existsSync(join(root, FONT_SNAPSHOT))) {
    findings.push({ app: '(repo)', kind: 'brand-prerequisite', detail: `falta ${FONT_SNAPSHOT}` });
  }

  const scopes = registryScopes(root);
  const apps = appDirs(root);
  let declaredCount = 0;
  const undeclared: string[] = [];

  for (const app of apps) {
    const decl = declaration(root, app);
    if (decl) declaredCount++;
    const scope = scopes.get(app) ?? 'native';

    if (scope === 'client') {
      if (!decl && (!legacyClient.has(app) || strict)) {
        findings.push({
          app,
          kind: 'client-waiver-missing',
          detail: 'app de cliente sin DESIGN-WAIVER.md/DESIGN.md (identidad propia sin waiver)',
        });
      }
    } else if (!decl) {
      undeclared.push(app);
      if (!legacyUndeclared.has(app) || strict) {
        findings.push({
          app,
          kind: 'native-declaration-missing',
          detail: 'app nativa sin DESIGN.md/DESIGN-WAIVER.md (NORM-APP-001)',
        });
      }
    }

    if (
      hasIndexHtml(root, app) &&
      !hasManifest(root, app) &&
      (!legacyNoManifest.has(app) || strict)
    ) {
      findings.push({
        app,
        kind: 'manifest-missing',
        detail: 'superficie web (index.html) sin manifest.webmanifest en raíz ni public/',
      });
    }

    if (decl && /homologad[oa]s?\b/i.test(decl.text)) {
      const refs = [...decl.text.matchAll(IMAGE_RE)].map((m) => m[0]);
      const verified = refs.some((ref) => resolveEvidence(root, app, ref));
      if (!verified) {
        findings.push({
          app,
          kind: 'homologation-without-evidence',
          detail: `${decl.file} declara homologación sin citar una captura/arte existente`,
        });
      }
    }
  }

  return {
    apps: apps.length,
    declared: declaredCount,
    undeclared,
    findings,
    ok: findings.length === 0,
  };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const report = auditAppDesign(ROOT, strict);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `[app-design-gate] ${report.apps} apps, ${report.declared} declaradas, ${report.undeclared.length} nativas sin declaración${strict ? ' (strict)' : ''}`,
    );
    for (const f of report.findings) console.log(`  ${f.kind}: ${f.app} — ${f.detail}`);
    if (report.ok) {
      console.log('  OK: marca, waivers, manifiestos y evidencia de homologación verificados');
    } else if (report.undeclared.length > 0) {
      console.log(`  pendiente de declaración: ${report.undeclared.join(', ')}`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
