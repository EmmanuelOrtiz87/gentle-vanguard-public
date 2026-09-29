#!/usr/bin/env tsx
/**
 * untracked-snapshot — guardrail anti-pérdida (post-incidente gentle-music 2026-09-19).
 *
 * Los archivos untracked NO se recuperan de git: son la única clase de trabajo
 * que una eliminación descuidada destruye para siempre. Este guardrail copia
 * TODOS los untracked actuales del workspace a .session/snapshots/untracked/
 * con manifiesto, y poda los snapshots viejos (mantiene los últimos KEEP).
 *
 * Corre automáticamente como lazy step del session-autostart y está disponible
 * a demanda: `npm run guard:snapshot` — OBLIGATORIO antes de cualquier
 * operación destructiva (ver regla en AGENTS.md).
 *
 * Exclusiones: respeta .gitignore (vía git ls-files --others
 * --exclude-standard); archivos > MAX_FILE_BYTES (binarios grandes); el propio
 * .session/ (ya está ignorado). Fail-safe: si git falla, sale 0 sin romper el
 * pipeline — un guardrail nunca debe tumbar el autostart.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const SNAP_ROOT = join(ROOT, '.session', 'snapshots', 'untracked');
const MANIFEST = 'manifest.json';
const KEEP = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB: texto/código sí, binarios/db no

interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

function listUntracked(): string[] {
  const r = spawnSync(
    'git',
    ['-C', ROOT, 'ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer', windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) return [];
  return r.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function main(): number {
  const files = listUntracked().filter((rel) => {
    if (rel.startsWith('.session/') || rel.startsWith('.session\\')) return false;
    try {
      return statSync(join(ROOT, rel)).isFile();
    } catch {
      return false;
    }
  });

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);
  const dest = join(SNAP_ROOT, stamp);
  const entries: ManifestEntry[] = [];
  let skippedBig = 0;

  for (const rel of files) {
    const abs = join(ROOT, rel);
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      skippedBig++;
      continue;
    }
    const target = join(dest, rel);
    try {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(abs, target);
      const sha = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16);
      entries.push({ path: rel, bytes: size, sha256: sha });
    } catch {
      // Un archivo que falla al copiar no debe abortar el snapshot completo.
    }
  }

  if (entries.length > 0) {
    mkdirSync(dest, { recursive: true });
    writeFileSync(
      join(dest, MANIFEST),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          files: entries.length,
          totalBytes: entries.reduce((acc, e) => acc + e.bytes, 0),
          skippedOversize: skippedBig,
          note: 'Copia de seguridad de untracked — restaurar manualmente desde aquí si algo se pierde.',
          entries,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  // Cambios en tracked SIN commit (unstaged + staged): ni git objects los
  // protegen hasta commit — un checkout/--hard los destruye. Se salvan como
  // parches aplicables con `git apply`.
  mkdirSync(dest, { recursive: true });
  for (const [name, args] of [
    ['unstaged.patch', ['diff']],
    ['staged.patch', ['diff', '--cached']],
  ] as const) {
    const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      writeFileSync(join(dest, name), r.stdout, 'utf8');
    }
  }

  // Retención: conservar los últimos KEEP snapshots.
  if (existsSync(SNAP_ROOT)) {
    const dirs = readdirSync(SNAP_ROOT)
      .filter((d) => d !== MANIFEST)
      .sort();
    for (const old of dirs.slice(0, Math.max(0, dirs.length - KEEP))) {
      try {
        rmSync(join(SNAP_ROOT, old), { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  const total = entries.reduce((acc, e) => acc + e.bytes, 0);
  console.log(
    `[guard:snapshot] ${entries.length} archivos untracked (${(total / 1024).toFixed(1)} KB)` +
      (skippedBig ? ` · ${skippedBig} omitidos por tamaño` : '') +
      ` -> ${relative(ROOT, dest) || dest}`,
  );
  return 0;
}

process.exit(main());
