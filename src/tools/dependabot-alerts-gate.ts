#!/usr/bin/env node

/**
 * dependabot-alerts-gate.ts — Las alertas Dependabot abiertas no pueden
 * crecer por debajo del radar.
 *
 * POR QUE EXISTE (2026-11-06)
 * El stack cerró 4 alertas de minimatch (CVE-2026-118764) descubiertas
 * manualmente consultando la web de GitHub Security. No había ningún artefacto
 * que verificara periódicamente la invariante
 *
 *     "cada alerta Dependabot abierta tiene una decision explicita:
 *      parchearse o estar en el baseline justificado por politica"
 *
 * Las superficies congeladas (locks pinned de Chatwoot, snapshots de
 * auditoría) resurgen con cada CVE nuevo del ecosistema; el baseline las
 * documenta una vez y el standard de triage vive en
 * rules/NORMATIVA-PNPM-SECURITY.md y
 * knowledge-base/security/dependency-override-policy.md.
 *
 * QUE HACE
 *   1. Consulta `gh api .../dependabot/alerts --paginate` (no la web: API
 *      machine-readable, como exige la norma pnpm security).
 *   2. Clasifica cada alerta con state == "open" contra el baseline
 *      config/baselines/dependabot-alerts.json (match por manifest y/o pkg).
 *   3. FALLA si hay alertas abiertas fuera del baseline; REPORTA las tolerated
 *      con su justificación.
 *   4. Un fallo de infraestructura (gh ausente, sin red, token vencido) NUNCA
 *      se interpreta como "0 vulnerabilidades": exit 2 INDETERMINADO.
 *
 * CODIGOS DE SALIDA
 *   0 = pass (0 alertas abiertas o todas cubiertas por el baseline)
 *   1 = fail (alertas abiertas fuera del baseline)
 *   2 = indeterminado (infraestructura: gh ausente / API / auth); la
 *       ausencia de evidencia NO es prueba de seguridad, tampoco de vulnerabilidad.
 *
 * USO
 *   node --import tsx src/tools/dependabot-alerts-gate.ts
 *   node --import tsx src/tools/dependabot-alerts-gate.ts --json
 *   node --import tsx src/tools/dependabot-alerts-gate.ts --repo owner/name
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface DependabotAlert {
  number: number;
  state: string;
  dependency?: { manifest_path?: string; package?: { name?: string; ecosystem?: string } };
  security_advisory?: { ghsa_id?: string; cve_id?: string; severity?: string; summary?: string };
}

export interface BaselineEntry {
  /** Foresta a cubrir: matchea si el manifest incluye este substring. */
  manifest?: string;
  /** Paquete vulnerable (oido). */
  pkg?: string;
  /** Justification politica (usuario-recordable). */
  reason: string;
  /** Documento donde vive la decision. */
  source: string;
}

export interface BaselineConfig {
  note?: string;
  entries: BaselineEntry[];
}

export interface GateFinding {
  number: number;
  pkg: string;
  manifest: string;
  severity: string;
  advisory: string;
}

export interface GateReport {
  ok: boolean;
  indeterminate: boolean;
  reason?: string;
  open: number;
  tolerated: GateFinding[];
  violations: GateFinding[];
  baselineEntries: number;
}

export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

const DEFAULT_BASELINE: BaselineConfig = {
  note: 'sin baseline: cualquier alerta abierta es una violation',
  entries: [],
};

function matches(entry: BaselineEntry, alert: DependabotAlert): boolean {
  const manifest = alert.dependency?.manifest_path ?? '';
  const pkg = alert.dependency?.package?.name ?? '';
  const manifestOk = !entry.manifest || manifest.includes(entry.manifest);
  const pkgOk = !entry.pkg || pkg === entry.pkg;
  return manifestOk && pkgOk;
}

/**
 * Pure classification: cada alerta abierta es tolerated (baseline) o violation.
 * La lista de entrada debe venir ya filtrada por state == "open".
 */
export function classifyOpenAlerts(
  open: DependabotAlert[],
  baseline: BaselineConfig = DEFAULT_BASELINE,
): { tolerated: GateFinding[]; violations: GateFinding[] } {
  const toFinding = (a: DependabotAlert): GateFinding => ({
    number: a.number,
    pkg: a.dependency?.package?.name ?? '(desconocido)',
    manifest: a.dependency?.manifest_path ?? '(desconocido)',
    severity: a.security_advisory?.severity ?? 'unknown',
    advisory: a.security_advisory?.ghsa_id ?? a.security_advisory?.cve_id ?? '(sin advisory)',
  });

  const tolerated: GateFinding[] = [];
  const violations: GateFinding[] = [];
  for (const alert of open) {
    const covered =
      baseline.entries.length > 0 && baseline.entries.some((entry) => matches(entry, alert));
    (covered ? tolerated : violations).push(toFinding(alert));
  }
  return { tolerated, violations };
}

function repoFromGit(root: string): string | null {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const https = url.match(/github\.com[:/](.+?)(\.git)?$/i);
    return https?.[1] ?? null;
  } catch {
    return null;
  }
}

function fetchAlerts(repo: string): DependabotAlert[] {
  // gh --paginate EMITE UN DOC JSON POR PAGINA (concatenados, no combinados).
  // Con --jq 'tojson' cada pagina sale como UNA linea compacta de JSON, que se
  // parsea linea a linea: robusto contra resoluciones y sin necesitar --slurp
  // (no disponible en gh <= 2.92).
  const out = execFileSync(
    'gh',
    ['api', `repos/${repo}/dependabot/alerts`, '--paginate', '--jq', 'tojson'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  const alerts: DependabotAlert[] = [];
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const page = JSON.parse(trimmed) as DependabotAlert[];
      if (Array.isArray(page)) alerts.push(...page);
    } catch {
      // Loop de robustez extra: si tojson llegara a partir, reparse del doc completo.
      const blob = JSON.parse(out) as DependabotAlert[] | DependabotAlert;
      if (Array.isArray(blob)) alerts.push(...blob);
      else alerts.push(blob);
    }
  }
  return alerts;
}

function loadBaseline(root: string): { config: BaselineConfig; path: string } {
  const path = join(root, 'config', 'baselines', 'dependabot-alerts.json');
  if (!existsSync(path)) return { config: DEFAULT_BASELINE, path: '(ausente)' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BaselineConfig;
    return { config: { note: parsed.note, entries: parsed.entries ?? [] }, path };
  } catch {
    return { config: DEFAULT_BASELINE, path };
  }
}

export async function runGate(
  options: { repo?: string; baseline?: BaselineConfig } = {},
): Promise<GateReport> {
  const root = defaultRoot();
  const baselineConfig =
    options.baseline ?? loadBaseline(root).config;

  try {
    const repo = options.repo ?? process.env.DEPENDABOT_GATE_REPO ?? repoFromGit(root);
    if (!repo) {
      return {
        ok: false,
        indeterminate: true,
        reason: 'no se pudo resolver el repo origin (gh/git ausente o sin remote)',
        open: 0,
        tolerated: [],
        violations: [],
        baselineEntries: baselineConfig.entries.length,
      };
    }

    const alerts = fetchAlerts(repo);
    const open = alerts.filter((a) => a.state === 'open');
    const { tolerated, violations } = classifyOpenAlerts(open, baselineConfig);
    return {
      ok: violations.length === 0,
      indeterminate: false,
      open: open.length,
      tolerated,
      violations,
      baselineEntries: baselineConfig.entries.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      indeterminate: true,
      reason: `no se pudo verificar (infraestructura, NO prueba de vulnerabilidad): ${message}`,
      open: 0,
      tolerated: [],
      violations: [],
      baselineEntries: baselineConfig.entries.length,
    };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const softIndeterminate = argv.includes('--soft-indeterminate');
  const repoIdx = argv.indexOf('--repo');
  const repo = repoIdx >= 0 ? argv[repoIdx + 1] : undefined;

  const report = await runGate({ repo });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `dependabot-alerts-gate -> ${report.open} abiertas, ` +
        `${report.tolerated.length} tolerated por baseline (${report.baselineEntries} entradas), ` +
        `${report.violations.length} violations`,
    );
    for (const f of report.tolerated) {
      console.log(`  TOL #${f.number} [${f.severity}] ${f.pkg} ${f.manifest}`);
    }
    for (const f of report.violations) {
      console.log(
        `  VIOL #${f.number} [${f.severity}] ${f.pkg} ${f.manifest} (${f.advisory})`,
      );
      console.log(
        '       fix: parchear con overrides quirurgicos o dismiss justificado en GitHub y',
        'registrar en config/baselines/dependabot-alerts.json',
      );
    }
    if (report.indeterminate) {
      console.log(`  INDETERMINADO: ${report.reason}`);
    }
    if (report.ok && !report.indeterminate) {
      console.log('  OK: 0 alertas abiertas fuera del baseline justificado');
    }
  }

  if (report.indeterminate) {
    // Modo hook (--soft-indeterminate): un push no puede bloquearse por
    // infraestructura (gh ausente, red, token). Se loguea con la marca
    // INDETERMINADO y sale 0 — la verificacion dura sigue disponible on-demand.
    if (softIndeterminate) {
      console.log(`  INDETERMINADO (no bloquea el push): ${report.reason}`);
      process.exit(0);
    }
    process.exit(2);
  }
  if (!report.ok) process.exit(1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
