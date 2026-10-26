/**
 * inbox-triage — clasifica las exportaciones de Engram en 00-inbox/ del vault
 * del knowledge base, por el `type:` del frontmatter, al folder que el
 * knowledge-base-manager ya define para ese tipo.
 *
 * DRY-RUN POR DEFAULT: sin `--apply` solo reporta el plan (el guardrail de
 * destruccion exige confirmacion explicita del owner para mover en masa).
 * Con `--apply` mueve con renameSync (misma unidad, atomico) y NUNCA
 * sobrescribe: si el destino existe, reporta el conflicto y lo deja.
 *
 * Uso:
 *   npx tsx src/knowledge/inbox-triage.ts            (dry-run)
 *   npx tsx src/knowledge/inbox-triage.ts --apply    (mueve)
 */
import { existsSync, readdirSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');
const INBOX = join(ROOT, 'knowledge-base', '00-inbox');

/** Engram type → folder del vault (mismo mapa que knowledge-base-manager). */
const FOLDER_BY_TYPE: Record<string, string> = {
  architecture: '02-architecture',
  decision: '02-architecture',
  session_summary: '04-sessions',
  bugfix: '05-research',
  pattern: '05-research',
  learning: '05-research',
  discovery: '05-research',
  config: '05-research',
  manual: '00-inbox',
};

/** Lee `type:` del frontmatter de una nota (linea simple, sin YAML completo). */
function noteType(path: string): string {
  try {
    const head = readFileSync(path, 'utf-8').slice(0, 800);
    const m = head.match(/^type:\s*(\S+)/m);
    return m?.[1] ?? 'manual';
  } catch {
    return 'manual';
  }
}

function main(): number {
  if (!existsSync(INBOX)) {
    process.stderr.write(`No existe ${INBOX}\n`);
    return 2;
  }
  const apply = process.argv.includes('--apply');
  const files = readdirSync(INBOX).filter((f) => f.endsWith('.md'));
  const plan: Record<string, string[]> = {};
  const conflicts: string[] = [];

  for (const f of files) {
    const type = noteType(join(INBOX, f));
    const folder = FOLDER_BY_TYPE[type] ?? '00-inbox';
    (plan[folder] ??= []).push(f);
    if (apply && folder !== '00-inbox') {
      const destDir = join(ROOT, 'knowledge-base', folder);
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, f);
      if (existsSync(dest)) {
        conflicts.push(`${f} -> ${folder}/ (destino existe, no se toca)`);
        continue;
      }
      renameSync(join(INBOX, f), dest);
    }
  }

  const total = files.length;
  const movable = Object.entries(plan)
    .filter(([folder]) => folder !== '00-inbox')
    .reduce((n, [, fs]) => n + fs.length, 0);
  process.stdout.write(`inbox-triage — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);
  process.stdout.write(`  archivos: ${total} en 00-inbox/\n`);
  for (const [folder, fs] of Object.entries(plan).sort()) {
    process.stdout.write(`  ${folder}: ${fs.length}\n`);
  }
  process.stdout.write(
    apply
      ? `  movidos: ${movable - conflicts.length}, conflictos: ${conflicts.length}\n`
      : '  dry-run: nada se movio. Correr con --apply para ejecutar (requiere confirmacion del owner).\n'
  );
  for (const c of conflicts) process.stdout.write(`  CONFLICTO ${c}\n`);
  return 0;
}

process.exit(main());
