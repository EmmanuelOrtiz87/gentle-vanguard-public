#!/usr/bin/env node

/**
 * runtime-retention.ts — política de retención de `.runtime`.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * `.runtime/` estaba en **3,6 GB con 136 directorios** y 53.321 archivos. Es
 * gitignored, así que no aparece en ninguna revisión de código: el disco se
 * llenaba en silencio. El owner pidió una política (14 días de backups, 7 de
 * logs) Y que, si la política genera problemas, el stack lo **notifique** para
 * que la decisión la tome él.
 *
 * La política vive en `config/runtime-retention.json` (versionada = fuente de
 * verdad). El tool:
 *
 *   1. Poda lo que la política declara PODABLE (por edad y con un tope).
 *   2. Respeta `keepNewest`: un backup de restauración vale más que su edad.
 *   3. NUNCA toca lo que la política declara CONSERVAR.
 *   4. Reporta lo que NO tiene política (escalación: "decidir").
 *   5. Escala si, después de podar, un directorio sigue por encima de su
 *      tope: eso ya es una decisión del owner, no del tool.
 *
 * Escribe en `.runtime/retention-report.json` para que el aviso quede en un
 * lugar consultable.
 *
 * USO
 *   node --import tsx src/ops/runtime-retention.ts            # simulación
 *   node --import tsx src/ops/runtime-retention.ts --apply    # poda
 *   node --import tsx src/ops/runtime-retention.ts --json
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PruneRule {
  path: string;
  maxAgeDays: number;
  keepNewest?: number;
  maxMb?: number;
  /**
   * Qué hacer si el directorio queda por encima de `maxMb`:
   * - `report` (por defecto): se informa, no se escala (el tope está confirmado).
   * - `ask`: se escala al owner (el tope es el que hay que decidir).
   */
  onExceed?: 'report' | 'ask';
  note?: string;
}

export interface RetentionPolicy {
  version: number;
  /**
   * Si es `true`, el barrido diario APLICA la política (no sólo simula).
   * Por defecto es `false`: nada se borra sin que el owner lo habilite.
   */
  autoApply?: boolean;
  /**
   * Comportamiento por defecto al superar un tope declarado: `report` (informa)
   * o `ask` (escala). El owner confirmó los topes el 2026-11-11: se cambian
   * sólo cuando el sistema muestre que no son la configuración óptima.
   */
  exceedAction?: 'report' | 'ask';
  /** Aviso al owner cuando hay escalaciones (lo usa runtime-retention-notify). */
  notify?: { enabled?: boolean; note?: string };
  logs: { maxAgeDays: number; note?: string };
  pidfiles: { pruneStale: boolean; note?: string };
  prune: PruneRule[];
  preserve: Array<{ path: string; note: string }>;
}

export interface RetentionCandidate {
  path: string;
  kind: 'dir' | 'file';
  ageDays: number;
  sizeMb: number;
  rule: string;
}

export interface RetentionReport {
  ok: boolean;
  applied: boolean;
  totalMb: number;
  freedMb: number;
  pruned: RetentionCandidate[];
  /** Lo que necesita una DECISIÓN del owner (avisa). */
  escalations: string[];
  /** Lo que supera su tope pero el tope está confirmado: se informa, no se escala. */
  overCap: string[];
  unclassified: Array<{ path: string; sizeMb: number; files: number }>;
  stalePidfiles: string[];
  logsPruned: number;
}

const ROOT = resolve(import.meta.dirname, '..', '..');

export function policyPath(root = ROOT): string {
  return join(root, 'config', 'runtime-retention.json');
}

export function loadPolicy(root = ROOT): RetentionPolicy {
  const file = policyPath(root);
  if (!existsSync(file)) throw new Error(`no existe la política de retención: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8')) as RetentionPolicy;
}

/** ¿El path relativo coincide con el patrón? Soporta el sufijo `*`. */
export function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

function dirSizeMb(dir: string): { mb: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (d: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(d, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      const full = join(d, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(full);
        } else {
          bytes += statSync(full).size;
          files += 1;
        }
      } catch {
        /* best effort */
      }
    }
  };
  walk(dir);
  return { mb: bytes / (1024 * 1024), files };
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // EPERM = existe pero está elevado: VIVO (no se puede señalar, pero vive).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface AuditOptions {
  root?: string;
  apply?: boolean;
  now?: number;
}

export function auditRetention(options: AuditOptions = {}): RetentionReport {
  const root = options.root ?? ROOT;
  const runtime = join(root, '.runtime');
  const policy = loadPolicy(root);
  const now = options.now ?? Date.now();

  const report: RetentionReport = {
    ok: true,
    applied: options.apply === true,
    totalMb: 0,
    freedMb: 0,
    pruned: [],
    escalations: [],
    overCap: [],
    unclassified: [],
    stalePidfiles: [],
    logsPruned: 0,
  };

  if (!existsSync(runtime)) {
    report.ok = true;
    return report;
  }

  // ── Top-level: clasificar cada directorio ────────────────────────────────
  let entries: string[] = [];
  try {
    entries = readdirSync(runtime, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return report;
  }

  const pruneRules = policy.prune;
  const preservePaths = policy.preserve.map((p) => p.path);

  for (const name of entries) {
    const abs = join(runtime, name);
    const { mb, files } = dirSizeMb(abs);
    report.totalMb += mb;

    const preserveRule = preservePaths.find((p) => matches(p, name));
    if (preserveRule) continue;

    const rule = pruneRules.find((r) => matches(r.path, name));
    if (!rule) {
      // SIN POLÍTICA: no se toca, pero se escala (lo que no está declarado es
      // un defecto: alguien tiene que decidir qué hacer con esto).
      report.unclassified.push({ path: name, sizeMb: Math.round(mb * 10) / 10, files });
      continue;
    }

    // Miembros del directorio (para aplicar keepNewest sobre lo más reciente).
    let members: Array<{ name: string; mtime: number; sizeMb: number }> = [];
    try {
      members = readdirSync(abs, { withFileTypes: true }).map((e) => {
        const full = join(abs, e.name);
        let sizeMb = 0;
        try {
          sizeMb = statSync(full).isDirectory()
            ? dirSizeMb(full).mb
            : statSync(full).size / (1024 * 1024);
        } catch {
          sizeMb = 0;
        }
        let mtime = 0;
        try {
          mtime = statSync(full).mtimeMs;
        } catch {
          mtime = 0;
        }
        return { name: e.name, mtime, sizeMb };
      });
    } catch {
      continue;
    }

    const sorted = [...members].sort((a, b) => b.mtime - a.mtime);
    const keep = new Set(sorted.slice(0, rule.keepNewest ?? 0).map((m) => m.name));

    for (const member of members) {
      if (keep.has(member.name)) continue;
      // La edad NO puede ser negativa: un archivo escrito en el mismo
      // milisegundo de la auditoría puede tener el mtime un instante por
      // delante del reloj y quedaba como "más nuevo que todo" (no podable).
      const ageDays = Math.max(0, (now - member.mtime) / 86_400_000);
      if (ageDays < rule.maxAgeDays) continue;
      const candidate: RetentionCandidate = {
        path: join(name, member.name).replace(/\\/g, '/'),
        kind: 'dir',
        ageDays: Math.round(ageDays),
        sizeMb: Math.round(member.sizeMb * 10) / 10,
        rule: rule.path,
      };
      report.pruned.push(candidate);
      report.freedMb += member.sizeMb;
      if (options.apply === true) {
        try {
          rmSync(join(abs, member.name), { recursive: true, force: true });
        } catch (err) {
          report.escalations.push(`no se pudo podar ${candidate.path}: ${(err as Error).message}`);
        }
      }
    }

    // Tope por directorio: si después de podar sigue por encima, se escala.
    // En simulación se resta lo que se habría podado (si no, la escalada
    // sería siempre la misma y no informaría nada).
    const measured = dirSizeMb(abs);
    const freedHere = members
      .filter((m) => {
        if (keep.has(m.name)) return false;
        const ageDays = Math.max(0, (now - m.mtime) / 86_400_000);
        return ageDays >= rule.maxAgeDays;
      })
      .reduce((acc, m) => acc + m.sizeMb, 0);
    const remainingMb =
      options.apply === true ? dirSizeMb(abs).mb : Math.max(0, measured.mb - freedHere);
    if (rule.maxMb !== undefined && remainingMb > rule.maxMb) {
      // El owner confirmó los topes (2026-11-11): superarlos se INFORMA, no se
      // escala. Sólo escalan si la regla declara `onExceed: "ask"` (o la
      // política dice `exceedAction: "ask"`): lo que no está declarado es lo
      // que necesita decisión.
      const action = rule.onExceed ?? policy.exceedAction ?? 'report';
      const detail = `${name}: ${Math.round(remainingMb)} MB, sobre su tope de ${rule.maxMb} MB`;
      if (action === 'ask') {
        report.escalations.push(`${detail} tras podar — decisión del owner`);
      } else {
        report.overCap.push(`${detail} (informativo: el tope está confirmado)`);
      }
    }
  }

  // ── Logs (7 días) ────────────────────────────────────────────────────────
  const logCutoff = now - policy.logs.maxAgeDays * 86_400_000;
  const walkLogs = (dir: string): void => {
    let entries2: ReturnType<typeof readdirSync>;
    try {
      entries2 = readdirSync(dir, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries2 as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkLogs(full);
        continue;
      }
      if (!entry.name.endsWith('.log')) continue;
      let mtime = 0;
      try {
        mtime = statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (mtime >= logCutoff) continue;
      report.logsPruned += 1;
      if (options.apply === true) {
        try {
          rmSync(full, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
  };
  walkLogs(runtime);

  // ── Pidfiles huérfanos ────────────────────────────────────────────────────
  if (policy.pidfiles.pruneStale) {
    const walkPids = (dir: string): void => {
      let entries2: ReturnType<typeof readdirSync>;
      try {
        entries2 = readdirSync(dir, { withFileTypes: true }) as never;
      } catch {
        return;
      }
      for (const entry of entries2 as unknown as Array<{ name: string; isDirectory(): boolean }>) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkPids(full);
          continue;
        }
        if (!entry.name.endsWith('.pid')) continue;
        let pid = 0;
        try {
          pid = Number.parseInt(readFileSync(full, 'utf8').replace(/[^0-9]/g, ''), 10);
        } catch {
          continue;
        }
        if (pid > 0 && isAlive(pid)) continue;
        report.stalePidfiles.push(
          full.replace(/\\/g, '/').replace(`${root.replace(/\\/g, '/')}/`, ''),
        );
        if (options.apply === true) {
          try {
            rmSync(full, { force: true });
          } catch {
            /* best effort */
          }
        }
      }
    };
    walkPids(runtime);
  }

  // ── Escalaciones ─────────────────────────────────────────────────────────
  for (const item of report.unclassified) {
    if (item.sizeMb >= 20) {
      report.escalations.push(
        `${item.path}: ${item.sizeMb} MB sin política de retención — decidir (podar, archivar o declarar)`,
      );
    }
  }

  report.ok = report.escalations.length === 0;
  report.freedMb = Math.round(report.freedMb * 10) / 10;
  report.totalMb = Math.round(report.totalMb * 10) / 10;

  if (options.apply === true) {
    try {
      writeFileSync(
        join(runtime, 'retention-report.json'),
        JSON.stringify(report, null, 2),
        'utf8',
      );
    } catch {
      /* best effort */
    }
  }
  return report;
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const asJson = argv.includes('--json');
  const report = auditRetention({ apply });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `[runtime-retention] ${apply ? 'APLICADO' : 'SIMULACIÓN'} · .runtime = ${report.totalMb} MB · ` +
        `podables: ${report.pruned.length} (${report.freedMb} MB) · logs: ${report.logsPruned} · ` +
        `pidfiles huérfanos: ${report.stalePidfiles.length} · sin política: ${report.unclassified.length}`,
    );
    for (const p of report.pruned.slice(0, 20)) {
      console.log(`  · ${p.path} (${p.sizeMb} MB, ${p.ageDays} días, regla ${p.rule})`);
    }
    if (report.pruned.length > 20) console.log(`  … y ${report.pruned.length - 20} más`);
    for (const e of report.escalations) console.log(`  ESCALACIÓN: ${e}`);
    for (const o of report.overCap) console.log(`  · ${o}`);
    if (report.ok) console.log('  OK: nada requiere decisión del owner');
  }
  // Las escalaciones NO bloquean: la decisión es del owner. Se notifican.
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
