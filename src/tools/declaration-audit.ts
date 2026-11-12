/**
 * declaration-audit.ts — el stack no puede tener rutas sin declarar.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * Dos incidentes en la misma semana, de la MISMA clase:
 *
 *   1. El REGISTRO de skills (`.atl/skill-registry.md`) es un artefacto
 *      DERIVADO y gitignored que leen ~12 módulos (embedder, router, MCP
 *      server, dashboard, factory, evolution engine, colectores de ML). No
 *      tenía generador: cuando faltaba, el stack entero perdía el índice
 *      semántico en silencio.
 *   2. El STOP del Command Center respondía "detenido" sin verificar que el
 *      proceso hubiera muerto: un control que AFIRMA sin COMPROBAR.
 *
 * En los dos casos el stack tenía guardrails (48 checks, health-check,
 * watchtower) y ninguno vio el problema. ¿Por qué? Porque cada guardrail
 * mira SU rebanada: ninguno verificaba las preguntas transversales
 *
 *   D1 · ¿Todo artefacto que el código lee y NO está versionado está
 *        DECLARADO (y, si es derivado, tiene generador)?
 *   D2 · ¿Todo check del catálogo tiene un ejecutor real? (Si su único
 *        ejecutor es el CI, y el CI está caído, ese check no corre: hay que
 *        saberlo, no descubrirlo meses después.)
 *   D3 · ¿Todo control que afirma "hecho" tiene un test de CONTRATO que
 *        verifica el efecto (no el código de retorno)?
 *
 * Éste es el auditor que convierte esas preguntas en un gate. Su regla de
 * oro: **lo que no está declarado, es un defecto**. Un gris no declarado no
 * es un detalle pendiente: es un fallo que ya occurred o va a ocurrir.
 *
 * MODO REPARACIÓN (`--repair`): los artefactos derivados declarados que
 * falten se REGENERAN con su generador (que es idempotente por contrato).
 * Eso es el "se autorrepara" del stack: no espera a que un gate grite.
 *
 * USO
 *   node --import tsx src/tools/declaration-audit.ts            # auditar
 *   node --import tsx src/tools/declaration-audit.ts --json     # JSON
 *   node --import tsx src/tools/declaration-audit.ts --repair   # reparar
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ArtifactKind = 'derived' | 'runtime';

export interface ArtifactDeclaration {
  /** Ruta relativa al repo. Si es un directorio, cubre todo lo que cuelgue. */
  path: string;
  /**
   * `derived` = se puede regenerar (debe declarar `generator`).
   * `runtime` = lo produce el stack en ejecución (debe declarar `producedBy`).
   */
  kind: ArtifactKind;
  /** Comando npm que lo regenera (obligatorio si kind = derived). */
  generator?: string;
  /** Módulo que lo escribe en runtime (obligatorio si kind = runtime). */
  producedBy?: string;
  /** Si es true, el artefacto debe EXISTIR ahora mismo. */
  required?: boolean;
  /** Nota para el humano: por qué existe esta declaración. */
  note?: string;
}

export interface GateDeclaration {
  /** id del check en config/quality-gates.json */
  id: string;
  /**
   * Dónde se ejecuta de verdad:
   *  - `local`   → en lefthook o en el gate de pre-push (command obligatorio)
   *  - `workflow`→ en un workflow de CI (workflow obligatorio)
   *  - `none`   → NO se ejecuta: el catálogo lo declara pero nadie lo corre
   */
  executor: 'local' | 'workflow' | 'none';
  /** Token que debe aparecer en .lefthook.yml o en el gate de pre-push. */
  command?: string;
  /** Archivo de workflow (si executor = workflow). */
  workflow?: string;
  /** Comando local que cubre lo mismo (para cuando el CI no está). */
  localMirror?: string;
  /** Por qué está así (contexto para el humano). */
  note?: string;
}

export interface ControlDeclaration {
  /** Identificador estable; debe aparecer dentro del test de contrato. */
  id: string;
  /** Superficie de control (endpoint, script, comando). */
  surface: string;
  /** Test que verifica el EFECTO del control. */
  contractTest: string;
}

export interface DeclarationLedger {
  version: number;
  derivedArtifacts: ArtifactDeclaration[];
  gates: GateDeclaration[];
  controls: ControlDeclaration[];
  /**
   * Limitaciones aceptadas EXPLÍCITAMENTE (mecanismo del fix "aceptar la
   * limitación de forma explícita"). Un hallazgo con regla+subject aquí no se
   * emite: quedó dicho en el ledger, no oculto en la salida del auditor.
   */
  acceptedLimitations?: AcceptedLimitation[];
}

export interface AcceptedLimitation {
  /** Regla del hallazgo que se acepta (ej. declaration/root-read). */
  rule: string;
  /** Subject del hallazgo que se acepta (ej. .atl). */
  subject: string;
  /** Por qué se acepta y qué riesgo residual queda. */
  note: string;
}

export type FindingSeverity = 'error' | 'warn';

export interface Finding {
  rule: string;
  severity: FindingSeverity;
  subject: string;
  message: string;
  fix: string;
}

export interface AuditReport {
  ok: boolean;
  errors: number;
  warnings: number;
  discoveredArtifacts: number;
  declaredArtifacts: number;
  findings: Finding[];
  repaired: string[];
}

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');

/** Raíces que el código puede leer y que NO viajan en el clon. */
const DERIVED_ROOTS = [
  '.atl',
  '.runtime',
  '.event-bus',
  '.session',
  '.logs',
  '.codegraph',
  '.engram-data',
  '.opencode',
  '.codex',
  '.github/skills',
  'graphify-out',
];

/** Módulos escaneados para descubrir lecturas de rutas derivadas. */
const SCAN_DIRS = ['src', 'scripts', 'apps/command-center', 'apps/web-dashboard/server'];
const SCAN_EXT = /\.(ts|mts|cts|js|mjs)$/i;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.runtime',
  '.atl',
  '.session',
  'graphify-out',
  '.codegraph',
]);

export function ledgerPath(root = ROOT): string {
  return join(root, 'config', 'declarations.json');
}

export function loadLedger(root = ROOT): DeclarationLedger {
  const file = ledgerPath(root);
  if (!existsSync(file)) {
    throw new Error(`no existe el ledger de declaraciones: ${relative(root, file)}`);
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as DeclarationLedger;
  if (!Array.isArray(parsed.derivedArtifacts)) parsed.derivedArtifacts = [];
  if (!Array.isArray(parsed.gates)) parsed.gates = [];
  if (!Array.isArray(parsed.controls)) parsed.controls = [];
  return parsed;
}

function normPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

/**
 * ¿La ruta `candidate` está cubierta por alguna declaración?
 *
 * Tres casos, en este orden:
 *  1. coincidencia exacta;
 *  2. la declaración es un ancestro (`.atl/skill-registry.md` cubre
 *     `.atl/skill-registry.md.bak`);
 *  3. la ruta es una RAÍZ derivada leída como directorio (`.atl`) y hay al
 *     menos una declaración debajo: cada hijo se audita por separado, así que
 *     el directorio no se reporta como gris.
 *
 * El caso 3 es el que evita el falso positivo "el código lee `.atl`" cuando lo
 * que lee son los hijos ya declarados uno por uno.
 */
export function covers(declarations: ArtifactDeclaration[], candidate: string): boolean {
  const norm = normPath(candidate);
  return declarations.some((decl) => {
    const declPath = normPath(decl.path);
    if (norm === declPath) return true;
    if (norm.startsWith(`${declPath}/`)) return true;
    // La RAÍZ derivada leída como directorio queda cubierta si hay al menos
    // una declaración debajo: cada hijo se audita por separado, así que el
    // directorio no se reporta como gris.
    if (DERIVED_ROOTS.includes(norm) && declPath.startsWith(`${norm}/`)) return true;
    return false;
  });
}

/** ¿La ruta la ignora git? Si viaja en el clon, no es un gris: no necesita declaración. */
export function isGitIgnored(root: string, path: string): boolean {
  const r = spawnSync('git', ['check-ignore', '-q', '--', path], {
    cwd: root,
    windowsHide: true,
  });
  return r.status === 0;
}

/**
 * Descubre las rutas derivadas que el código lee.
 * Escanea literales de cadena que empiezan por una raíz derivada.
 */
export function discoverReadPaths(root = ROOT): Map<string, string[]> {
  const found = new Map<string, string[]>();
  // Las raíces se escapan: sin escape, el `.` de `.atl` también matchea
  // `#session` o `@opencode/codegraph` (dos falsos positivos que se
  // reportaban como si fueran rutas no declaradas).
  const escaped = DERIVED_ROOTS.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const literal = new RegExp(`['"\`](${escaped})(/[A-Za-z0-9_./-]+)?['"\`]`, 'g');
  for (const dir of SCAN_DIRS) {
    const base = resolve(root, dir);
    if (!existsSync(base)) continue;
    for (const file of walk(base, root)) {
      // El auditor no se audita a sí mismo: sus propios comentarios contienen
      // rutas de ejemplo y se reportarían como hallazgos falsos.
      if (file.replace(/\\/g, '/').endsWith('tools/declaration-audit.ts')) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const match of text.matchAll(literal)) {
        const rel = relative(root, file).replace(/\\/g, '/');
        const path = (match[1] + (match[2] ?? '')).replace(/\/$/, '');
        const readers = found.get(path) ?? [];
        if (!readers.includes(rel)) readers.push(rel);
        found.set(path, readers);
      }
    }
  }
  return found;
}

function walk(dir: string, root: string): string[] {
  const out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as never;
  } catch {
    return out;
  }
  for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(full, root));
      continue;
    }
    if (!SCAN_EXT.test(entry.name)) continue;
    try {
      if (statSync(full).size > 2 * 1024 * 1024) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
  return out;
}

/** Lee el catálogo de gates declarado. */
export interface CatalogueGate {
  id: string;
  stage?: string;
  command?: string;
  /** Si el catálogo dice `enforced: true`, el gate TIENE que ejecutarse. */
  enforced?: boolean;
  required?: boolean;
}

export function loadGateCatalogue(root = ROOT): CatalogueGate[] {
  const file = join(root, 'config', 'quality-gates.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { gates?: CatalogueGate[] };
    return parsed.gates ?? [];
  } catch {
    return [];
  }
}

/**
 * Texto de los ejecutores LOCALES (lefthook + gate de pre-push).
 * Es la fuente para responder "¿este comando se ejecuta de verdad?".
 *
 * Los COMENTARIOS se eliminan: un gate que fue borrado y quedó mencionado en
 * un comentario no está ejecutándose (el mismo defecto que el
 * `quality-gates-verify` ya corregía para su propio corpus).
 */
export function localExecutorText(root = ROOT): string {
  const parts: string[] = [];
  for (const file of ['.lefthook.yml', 'src/git/prepush-gate.ts']) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) continue;
    try {
      const text = readFileSync(abs, 'utf8');
      parts.push(file.endsWith('.yml') ? stripYamlComments(text) : text);
    } catch {
      /* best effort */
    }
  }
  return parts.join('\n');
}

/** Un comentario YAML no es ejecución. */
export function stripYamlComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function packageScripts(root: string = ROOT): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

/** Corre un comando npm del repo (para reparar derivados). */
export function runGenerator(command: string, root = ROOT): { ok: boolean; output: string } {
  const r = spawnSync('npm', ['run', command, '--silent'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return {
    ok: r.status === 0,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-500),
  };
}

export interface AuditOptions {
  root?: string;
  /** Regenera los derivados que falten (idempotente por contrato). */
  repair?: boolean;
}

export function auditDeclarations(options: AuditOptions = {}): AuditReport {
  const root = options.root ?? ROOT;
  const findings: Finding[] = [];
  const repaired: string[] = [];

  const ledger = loadLedger(root);
  const scripts = packageScripts(root);

  // ── D1 · derivados declarados vs. realidad ──────────────────────────────
  for (const decl of ledger.derivedArtifacts) {
    const abs = resolve(root, decl.path);
    const exists = existsSync(abs);
    if (decl.kind === 'derived') {
      if (!decl.generator) {
        findings.push({
          rule: 'declaration/derived-without-generator',
          severity: 'error',
          subject: decl.path,
          message:
            'un artefacto derivado no declara cómo se regenera: si falta, nadie lo reconstruye',
          fix: 'declarar `generator` (un script de package.json) en config/declarations.json',
        });
        continue;
      }
      const scriptName = decl.generator.replace(/^npm run /, '').split(' ')[0];
      if (!scripts[scriptName]) {
        findings.push({
          rule: 'declaration/missing-generator',
          severity: 'error',
          subject: decl.path,
          message: `el generador declarado no existe: "${decl.generator}"`,
          fix: `declarar un script real de package.json (hoy no existe "${scriptName}")`,
        });
        continue;
      }
      if (!exists && decl.required !== false) {
        const fixable = options.repair === true;
        if (fixable) {
          const result = runGenerator(scriptName, root);
          if (result.ok && existsSync(abs)) {
            repaired.push(decl.path);
            continue;
          }
          findings.push({
            rule: 'declaration/derived-missing',
            severity: 'error',
            subject: decl.path,
            message: `falta y su generador no lo repuso: ${result.output || 'sin salida'}`,
            fix: `revisar "${decl.generator}"`,
          });
          continue;
        }
        findings.push({
          rule: 'declaration/derived-missing',
          severity: 'error',
          subject: decl.path,
          message: 'artefacto derivado ausente: el código lo lee y no existe',
          fix: `npm run ${scriptName}  (o --repair para que lo regenere solo)`,
        });
      }
      continue;
    }

    // kind = runtime: lo escribe el stack en ejecución.
    if (!decl.producedBy) {
      findings.push({
        rule: 'declaration/runtime-without-producer',
        severity: 'error',
        subject: decl.path,
        message: 'un artefacto de runtime no declara qué módulo lo produce',
        fix: 'declarar `producedBy` (módulo del repo) en config/declarations.json',
      });
      continue;
    }
    const producer = decl.producedBy.split(' ')[0];
    const producerPath = resolve(root, producer);
    if (!existsSync(producerPath)) {
      findings.push({
        rule: 'declaration/missing-producer',
        severity: 'error',
        subject: decl.path,
        message: `el módulo que lo produce no existe: ${producer}`,
        fix: 'corregir `producedBy` en config/declarations.json',
      });
    }
  }

  // ── D1b · rutas derivadas leídas pero NO declaradas ────────────────────
  const discovered = discoverReadPaths(root);
  const accepted = (rule: string, subject: string): boolean =>
    (ledger.acceptedLimitations ?? []).some(
      (a) => a.rule === rule && normPath(a.subject) === normPath(subject),
    );
  for (const [path, readers] of discovered) {
    // Si la ruta viaja en el clon no es un gris: no necesita declaración.
    // El gris es lo que NO está en el clon y el código lee igual.
    if (!isGitIgnored(root, path)) continue;
    if (covers(ledger.derivedArtifacts, path)) {
      // Raíz derivada leída como DIRECTORIO: los hijos declarados la cubren,
      // pero un hijo construido en runtime (path dinámico) quedaría fuera del
      // descubrimiento por literal. Se deja dicho, no se oculta.
      if (
        DERIVED_ROOTS.includes(path) &&
        !ledger.derivedArtifacts.some((d) => normPath(d.path) === path) &&
        !accepted('declaration/root-read', path)
      ) {
        findings.push({
          rule: 'declaration/root-read',
          severity: 'warn',
          subject: path,
          message: `el código lee el directorio "${path}" completo (${readers.length} módulos): sus hijos se declaran uno por uno, pero un hijo con path dinámico quedaría fuera`,
          fix: 'declarar el directorio raíz, o aceptar la limitación de forma explícita',
        });
      }
      continue;
    }
    findings.push({
      rule: 'declaration/undeclared-artifact',
      severity: 'error',
      subject: path,
      message: `el código lee esta ruta (${readers.length} módulos: ${readers.slice(0, 3).join(', ')}${readers.length > 3 ? '…' : ''}) y NO está declarada`,
      fix: `declararla en config/declarations.json (kind: derived con generator, o runtime con producedBy)`,
    });
  }

  // ── D2 · gates: declarados con ejecutor real ───────────────────────────
  const catalogue = loadGateCatalogue(root);
  const localExecutors = localExecutorText(root);
  for (const check of catalogue) {
    const declaration = ledger.gates.find((g) => g.id === check.id);
    // El catálogo es el que dice si el gate se ENFORZA. Un gate `enforced: true`
    // sin ejecutor es un guardrail de mentira: alguien cree que está protegido
    // y no lo está. Un gate `enforced: false` es aspiracional y honesto: lo
    // que no puede ser es declarar `enforced: true` y no correrlo.
    const enforced = check.enforced !== false;
    if (!declaration) {
      findings.push({
        rule: 'declaration/gate-without-declaration',
        severity: 'error',
        subject: check.id,
        message: 'el catálogo declara este check pero nadie declaró dónde se ejecuta',
        fix: `declararlo en config/declarations.json (gates: executor local|workflow|none)`,
      });
      continue;
    }
    if (declaration.executor === 'none') {
      if (enforced) {
        findings.push({
          rule: 'declaration/gate-without-executor',
          severity: 'error',
          subject: check.id,
          message:
            'el catálogo declara este check como enforced pero NINGÚN ejecutor lo corre: es un guardrail de mentira',
          fix: 'implementar el ejecutor (lefthook / gate de pre-push) o sacarlo del catálogo',
        });
      } else if (!declaration.note) {
        findings.push({
          rule: 'declaration/aspirational-without-note',
          severity: 'warn',
          subject: check.id,
          message: 'gate aspiracional (enforced: false) sin nota: nadie sabe por qué no corre',
          fix: 'explicar en la nota por qué no se ejecuta y qué lo cubre',
        });
      }
      continue;
    }
    if (declaration.executor === 'local') {
      if (!declaration.command) {
        findings.push({
          rule: 'declaration/gate-without-command',
          severity: 'error',
          subject: check.id,
          message: 'ejecutor local sin `command`: no se puede verificar que corra',
          fix: 'declarar el token del comando en .lefthook.yml o en el gate de pre-push',
        });
        continue;
      }
      if (!localExecutors.includes(declaration.command)) {
        findings.push({
          rule: 'declaration/gate-not-executed',
          severity: 'error',
          subject: check.id,
          message: `declara ejecutor local pero "${declaration.command}" no aparece ni en .lefthook.yml ni en el gate de pre-push`,
          fix: 'cambiar el command por el token real, o sacarlo del catálogo',
        });
      }
      continue;
    }
    // executor = workflow
    if (!declaration.workflow || !existsSync(resolve(root, declaration.workflow))) {
      findings.push({
        rule: 'declaration/gate-missing-workflow',
        severity: 'error',
        subject: check.id,
        message: `declara ejecutor "workflow" pero el workflow no existe: ${declaration.workflow ?? '(sin declarar)'}`,
        fix: 'declarar el workflow real o cambiar el executor a local',
      });
      continue;
    }
    if (check.stage === 'ci') {
      const mirror = declaration.localMirror;
      if (!mirror) {
        findings.push({
          rule: 'declaration/ci-only-gate',
          severity: 'warn',
          subject: check.id,
          message:
            'este check sólo corre en el CI: si Actions está caído (hoy lo está, por billing de la cuenta) no se ejecuta y nadie lo nota',
          fix: 'declarar `localMirror` con el comando local que cubre lo mismo',
        });
        continue;
      }
      const scriptName = mirror.replace(/^npm run /, '').split(' ')[0];
      const existsAsScript = Boolean(scripts[scriptName]);
      const wiredLocally = localExecutors.includes(mirror) || localExecutors.includes(scriptName);
      if (!existsAsScript && !wiredLocally) {
        findings.push({
          rule: 'declaration/ci-only-gate',
          severity: 'warn',
          subject: check.id,
          message: `el espejo local declarado ("${mirror}") no existe como script ni corre en local`,
          fix: 'declarar un espejo real o cablearlo al gate de pre-push',
        });
        continue;
      }
      if (!wiredLocally) {
        findings.push({
          rule: 'declaration/ci-only-gate',
          severity: 'warn',
          subject: check.id,
          message: `el espejo local ("${mirror}") existe pero NO está cableado a ningún gate local: con Actions caído, este check no se ejecuta`,
          fix: 'cablear el espejo al gate de pre-push (o declararlo como aspiracional)',
        });
      }
    }
  }
  for (const declaration of ledger.gates) {
    if (catalogue.some((c) => c.id === declaration.id)) continue;
    findings.push({
      rule: 'declaration/stale-gate',
      severity: 'warn',
      subject: declaration.id,
      message: 'declaración de gate que ya no existe en el catálogo',
      fix: 'borrar la entrada de config/declarations.json',
    });
  }

  // ── D3 · controles con test de contrato ────────────────────────────────
  for (const control of ledger.controls) {
    const testFile = resolve(root, control.contractTest);
    if (!existsSync(testFile)) {
      findings.push({
        rule: 'declaration/control-without-test',
        severity: 'error',
        subject: control.id,
        message: `el control "${control.surface}" no tiene test de contrato (falta ${control.contractTest})`,
        fix: 'escribir el test de contrato o sacar el control de la declaración',
      });
      continue;
    }
    const text = readFileSync(testFile, 'utf8');
    if (!text.includes(control.id)) {
      findings.push({
        rule: 'declaration/control-test-unlinked',
        severity: 'error',
        subject: control.id,
        message: `el test ${control.contractTest} no menciona "${control.id}": el contrato no está enlazado a la superficie`,
        fix: `añadir el marcador "${control.id}" en el test de contrato`,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  return {
    ok: errors === 0,
    errors,
    warnings,
    discoveredArtifacts: discovered.size,
    declaredArtifacts: ledger.derivedArtifacts.length,
    findings,
    repaired,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const repair = argv.includes('--repair');
  let report: AuditReport;
  try {
    report = auditDeclarations({ repair });
  } catch (err) {
    console.error(`[declaration-audit] FATAL: ${(err as Error).message}`);
    process.exit(2);
  }
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `[declaration-audit] ${report.declaredArtifacts} declarados · ${report.discoveredArtifacts} descubiertos · ` +
        `${report.errors} errores · ${report.warnings} avisos`,
    );
    for (const repairedPath of report.repaired) console.log(`  REPARADO ${repairedPath}`);
    for (const f of report.findings) {
      console.log(
        `  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.subject}: ${f.message}`,
      );
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: nada sin declarar');
  }
  if (!report.ok) {
    console.error(
      '[declaration-audit] -> FAIL: hay rutas, gates o controles sin declarar. ' +
        'Un gris no declarado es un fallo que ya ocurrió o va a ocurrir.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
