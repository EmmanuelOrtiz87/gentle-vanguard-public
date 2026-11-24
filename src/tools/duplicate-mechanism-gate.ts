/**
 * duplicate-mechanism-gate.ts — "ya existe": no re-implementes un mecanismo que ya está.
 *
 * POR QUÉ (2026-11-24): la clase "reescribir o superponer lo que ya existe" aparecía
 * en el uso sin estar en la taxonomía de fricción. Ejemplo real: el sync al repo
 * público se re-hizo a mano aunque `npm run publish:public` ya existía, y se escribió
 * una segunda poda cuando `sync-to-public.ts` ya podaba lo stale. La escalera de
 * corrección dice que una regla escrita y no enforced es una repetición: esta es la
 * enforcement de esa clase.
 *
 * REGLAS (solo alta señal; lo que sea subcomando de una CLI no es duplicado):
 *   R1 — dos scripts npm con el MISMO target y el MISMO comando = el mismo mecanismo
 *        con dos nombres (alias). Duplicado literal.
 *   R2 — dos archivos con el MISMO basename normalizado en src/ y scripts/ = el mismo
 *        mecanismo en dos rutas. Los nombres genéricos por dominio (types, config,
 *        helpers...) NO cuentan: se toleran con motivo declarado.
 *
 * RATCHET: el baseline declara la deuda tolerada. Falla SOLO si el conjunto actual
 * agrupa mechanisms que el baseline no conoce (o si un grupo conocido grew — alguien
 * agregó otro alias). Así el gate no bloquea por deuda previa y sí por lo que se agrega.
 *
 * Uso:
 *   node --import tsx src/tools/duplicate-mechanism-gate.ts [--json] [--write-baseline]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const BASELINE_PATH = join(ROOT, 'config', 'baselines', 'duplicate-mechanism.json');

/** Basenames genéricos: dos archivos con el mismo nombre en dominios distintos NO son duplicado. */
const GENERIC_BASENAMES = new Set([
  'analyze',
  'cli',
  'config',
  'gate',
  'helpers',
  'index',
  'metrics',
  'patterns',
  'readers',
  'report',
  'schemas',
  'types',
  'utils',
]);

export interface DuplicateGroup {
  key: string;
  rule: 'R1' | 'R2';
  members: string[];
  detail: string;
}

export interface Baseline {
  version: number;
  generatedAt?: string;
  tolerated: Record<string, { members: string[]; reason: string }>;
}

function npmScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

/** Target del comando: el primer path de código que el comando invoca. */
export function commandTarget(command: string): string | null {
  const match = String(command).match(
    /(src|scripts|apps|packages)\/[A-Za-z0-9_./@-]+\.(ts|mjs|js|sh|ps1)/,
  );
  return match ? match[0] : null;
}

export function findScriptDuplicates(scripts: Record<string, string>): DuplicateGroup[] {
  const groups = new Map<string, { names: string[]; target: string }>();
  for (const [name, command] of Object.entries(scripts)) {
    const target = commandTarget(command);
    if (!target) continue;
    const key = `${target}::${String(command).trim().replace(/\s+/g, ' ')}`;
    const entry = groups.get(key) ?? { names: [], target };
    entry.names.push(name);
    groups.set(key, entry);
  }
  return [...groups.entries()]
    .filter(([, entry]) => entry.names.length > 1)
    .map(([key, entry]) => ({
      // La clave incluye el comando: dos variantes del mismo target con args distintos
      // (p.ej. `audit:x` y `audit:x:json`) son mecanismos distintos, no duplicados.
      key: `R1:${entry.target}::${key.split('::')[1] ?? ''}`,
      rule: 'R1' as const,
      members: entry.names.sort(),
      detail: `mismo mecanismo con ${entry.names.length} nombres sobre ${entry.target}`,
    }));
}

function walk(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 4) return out;
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.name === 'dist' || entry.name === 'build' || entry.name === 'out') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, depth + 1, out);
    else if (/\.(ts|mjs|js|sh|ps1)$/.test(entry.name)) out.push(path);
  }
  return out;
}

export function normalizeBasename(path: string): string {
  return basename(path)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function findFileDuplicates(root = ROOT): DuplicateGroup[] {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))];
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const normalized = normalizeBasename(file);
    if (GENERIC_BASENAMES.has(normalized)) continue;
    const key = `R2:${normalized}`;
    groups.set(key, [
      ...(groups.get(key) ?? []),
      file.replace(root + '\\', '').replace(root + '/', ''),
    ]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({
      key,
      rule: 'R2' as const,
      members: members.sort(),
      detail: `mismo nombre en ${members.length} rutas`,
    }));
}

export function computeDuplicates(root = ROOT): DuplicateGroup[] {
  return [...findScriptDuplicates(npmScripts()), ...findFileDuplicates(root)].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}

export function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return { version: 1, tolerated: {} };
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    if (parsed.version !== 1) return { version: 1, tolerated: {} };
    return parsed;
  } catch {
    return { version: 1, tolerated: {} };
  }
}

/** Un grupo tolerado que grew = alguien agregó otro alias: eso sí bloquea. */
export function findNewDuplicates(
  duplicates: DuplicateGroup[],
  baseline: Baseline,
): { group: DuplicateGroup; reason: string }[] {
  const found: { group: DuplicateGroup; reason: string }[] = [];
  for (const group of duplicates) {
    const known = baseline.tolerated[group.key];
    if (!known) {
      found.push({ group, reason: 'mecanismo duplicado nuevo (no está en el baseline)' });
      continue;
    }
    const added = group.members.filter((member) => !known.members.includes(member));
    if (added.length) {
      found.push({
        group,
        reason: `el grupo grew: se agregaron ${added.join(', ')} (tolerados: ${known.members.join(', ')})`,
      });
    }
  }
  return found;
}

function main(): number {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const writeBaseline = args.includes('--write-baseline');
  const duplicates = computeDuplicates();
  const baseline = loadBaseline();

  if (writeBaseline) {
    const tolerated: Baseline['tolerated'] = {};
    for (const group of duplicates) {
      // Conserva el motivo de un grupo equivalente (mismos miembros) aunque cambie la clave.
      const known =
        baseline.tolerated[group.key] ??
        Object.values(baseline.tolerated).find(
          (entry) =>
            entry.members.length === group.members.length &&
            entry.members.every((member) => group.members.includes(member)),
        );
      tolerated[group.key] = {
        members: group.members,
        reason: known?.reason ?? 'deuda preexistente (2026-11-24) — tolerada, no promotionada',
      };
    }
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tolerated }, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `duplicate-mechanism-gate -> baseline escrito: ${Object.keys(tolerated).length} grupos`,
    );
    return 0;
  }

  const fresh = findNewDuplicates(duplicates, baseline);
  const report = {
    ok: fresh.length === 0,
    duplicates: duplicates.length,
    tolerated: duplicates.length - fresh.length,
    fresh: fresh.map(({ group, reason }) => ({ rule: group.rule, members: group.members, reason })),
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (fresh.length === 0) {
    console.log(
      `PASS duplicate-mechanism: ${duplicates.length} grupos duplicados, todos tolerados en el baseline (${report.tolerated}).`,
    );
  } else {
    console.error(`FAIL duplicate-mechanism: ${fresh.length} duplicado(s) nuevo(s):`);
    for (const { group, reason } of fresh) {
      console.error(`  [${group.rule}] ${group.members.join(' | ')} — ${reason}`);
      console.error(`         ${group.detail}`);
    }
    console.error(
      '  Fix: reutilizá el mecanismo existente o justificá el alias nuevo en config/baselines/duplicate-mechanism.json.',
    );
  }
  return fresh.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(main());
}
