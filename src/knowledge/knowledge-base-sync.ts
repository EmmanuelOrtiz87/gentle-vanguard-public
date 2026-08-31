#!/usr/bin/env node
/**
 * Knowledge Base Sync - Engram ↔ Vault
 *
 * Sincroniza automáticamente entre Engram (memoria de sesión) y el vault de Obsidian.
 *
 * Features:
 * - Exporta observaciones de Engram al vault (largo plazo)
 * - Importa notas del vault a Engram (búsqueda de conocimiento)
 * - Genera resúmenes de sesión automáticamente
 * - Mantiene cross-references entre sesiones
 *
 * Usage:
 *   pnpm kb:sync -- --mode full
 *   pnpm kb:sync -- --mode export
 *   pnpm kb:sync -- --mode import
 *   pnpm kb:sync -- --mode session-summary
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { runSync } from '../core/run-command.js';
import { createHash } from 'crypto';
import { z } from 'zod';

function findRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return resolve(dir);
}

const ROOT = findRoot(process.env.GENTLE_VANGUARD_BASE_DIR || process.cwd());
const configPath = join(ROOT, 'config', 'knowledge-base-config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
  vault_path: string;
  folders: Record<string, string>;
  sync?: { engram_project?: string };
};
const VAULT_DIR = resolve(ROOT, config.vault_path);
const SESSIONS_DIR = join(VAULT_DIR, config.folders.sessions);
const INBOX_DIR = join(VAULT_DIR, config.folders.inbox);
const IMPORT_STATE_FILE = join(ROOT, '.runtime', 'kb-sync-imported.json');
const ENGRAM_PROJECT =
  process.env.ENGRAM_PROJECT || config.sync?.engram_project || 'gentle-vanguard';

const exportedObservationSchema = z.object({
  id: z.number(),
  session_id: z.string().nullable().optional(),
  title: z.string(),
  content: z.string(),
  type: z.string(),
  created_at: z.string(),
});
const exportSchema = z.object({
  observations: z.array(exportedObservationSchema),
  sessions: z.array(z.object({ id: z.string(), project: z.string() })),
});

interface ImportState {
  [filepath: string]: { hash: string; engramId?: string; importedAt: string };
}

interface SyncOptions {
  mode: 'full' | 'export' | 'import' | 'session-summary';
  sessionId?: string;
  quiet?: boolean;
  dryRun?: boolean;
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level]}[KB-SYNC] [${level}] ${msg}\x1b[0m`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Exporta observaciones de Engram al vault
 * Convierte memoria de sesión a notas de largo plazo
 */
async function exportFromEngram(
  _sessionId?: string,
  dryRun = false,
): Promise<{ exported: number; errors: string[] }> {
  log('Exporting from Engram...', 'INFO');
  const errors: string[] = [];
  let exported = 0;

  try {
    const exportFile = join(tmpdir(), `gentle-vanguard-engram-${process.pid}.json`);
    const result = runSync('engram', ['export', exportFile], {
      timeout: 10000,
    });

    if (result.status !== 0) {
      log('Engram CLI not available or no observations found', 'WARN');
      return { exported: 0, errors: ['Engram CLI unavailable'] };
    }

    try {
      const data = exportSchema.parse(JSON.parse(readFileSync(exportFile, 'utf-8')));
      const projectSessions = new Set(
        data.sessions.filter((s) => s.project === ENGRAM_PROJECT).map((s) => s.id),
      );
      const observations = data.observations.filter(
        (obs) => typeof obs.session_id === 'string' && projectSessions.has(obs.session_id),
      );
      if (!dryRun) ensureDir(INBOX_DIR);
      for (const obs of observations) {
        if (!['decision', 'architecture', 'bugfix', 'pattern'].includes(obs.type)) continue;
        const filename = `engram-${obs.id}-${obs.type}.md`;
        const filepath = join(INBOX_DIR, filename);
        if (existsSync(filepath)) continue;
        if (!dryRun) {
          const content = `---\ncreated: ${obs.created_at.split('T')[0]}\ntags: [engram, ${obs.type}]\nengram_id: ${obs.id}\ntype: ${obs.type}\n---\n\n# ${obs.title}\n\n${obs.content}\n\n---\n*Imported from Engram on ${getToday()}*\n`;
          writeFileSync(filepath, content, 'utf-8');
        }
        exported++;
      }
      log(`${dryRun ? 'Would export' : 'Exported'} ${exported} observations to inbox`, 'SUCCESS');
    } catch {
      log('Failed to parse Engram output', 'WARN');
      return { exported: 0, errors: ['Parse error'] };
    } finally {
      rmSync(exportFile, { force: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Export failed: ${msg}`, 'ERROR');
    errors.push(msg);
  }

  return { exported, errors };
}

/**
 * Carga el estado de importaciones previas (deduplicación por hash)
 */
function loadImportState(): ImportState {
  if (!existsSync(IMPORT_STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(IMPORT_STATE_FILE, 'utf-8')) as ImportState;
  } catch {
    return {};
  }
}

/**
 * Persiste el estado de importaciones
 */
function saveImportState(state: ImportState): void {
  ensureDir(join(ROOT, '.runtime'));
  writeFileSync(IMPORT_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Guarda una observación en Engram vía CLI (memoria persistente real)
 */
function saveToEngram(
  title: string,
  content: string,
): { ok: boolean; id?: string; error?: string } {
  // Limitar contenido para el CLI (línea de comando) — truncar de forma segura
  const safeTitle = title.slice(0, 200).replace(/\r?\n/g, ' ');
  const safeContent = content.slice(0, 3000).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  const result = runSync(
    'engram',
    [
      'save',
      safeTitle,
      safeContent,
      '--type',
      'discovery',
      '--project',
      ENGRAM_PROJECT,
      '--scope',
      'project',
    ],
    { timeout: 15000 },
  );

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    return { ok: false, error: stderr || result.error?.message || 'engram CLI failed' };
  }

  // Extraer ID de la salida si está disponible (formato: "Memory saved: <title> (type)")
  const stdout = (result.stdout || '').trim();
  const idMatch = stdout.match(/#(\d+)/);
  return { ok: true, id: idMatch ? idMatch[1] : undefined };
}

/**
 * Importa notas del vault a Engram
 * Usa `engram save` (integración real) con deduplicación por hash de contenido
 */
async function importToEngram(
  dryRun = false,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  log(`Importing from vault to Engram (project: ${ENGRAM_PROJECT})...`, 'INFO');
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Verificar que el CLI de engram esté disponible
  const check = runSync('engram', ['version'], { timeout: 5000 });
  if (check.status !== 0) {
    log('Engram CLI unavailable — cannot import', 'WARN');
    return { imported: 0, skipped: 0, errors: ['Engram CLI unavailable'] };
  }

  const state = loadImportState();
  const folders = [
    config.folders.projects,
    config.folders.architecture,
    config.folders.skills,
    config.folders.research,
  ];

  for (const folder of folders) {
    const folderPath = join(VAULT_DIR, folder);
    if (!existsSync(folderPath)) continue;

    const files = readdirSync(folderPath, { recursive: true }) as string[];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filepath = join(folderPath, file.toString());
      try {
        const content = readFileSync(filepath, 'utf-8');
        if (!content.trim()) continue;

        // Extraer título (primera línea # )
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : file.toString().replace(/\.md$/, '');

        // Deduplicación: si el contenido no cambió, no re-importar
        const hash = createHash('sha256').update(content).digest('hex');
        const previous = state[filepath];
        if (previous && previous.hash === hash) {
          skipped++;
          continue;
        }

        // Contenido a guardar: título + cuerpo (sin front-matter yaml)
        const body = content.replace(/^---[\s\S]*?---\n?/, '').trim();
        const summary = body.slice(0, 2500);

        const result = dryRun ? { ok: true } : saveToEngram(title, summary);
        if (result.ok) {
          if (!dryRun)
            state[filepath] = { hash, engramId: result.id, importedAt: new Date().toISOString() };
          imported++;
        } else {
          errors.push(`Failed to import ${file}: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to import ${file}: ${msg}`);
      }
    }
  }

  if (!dryRun) saveImportState(state);
  log(
    `${dryRun ? 'Would import' : 'Imported'} ${imported} notes to Engram (${skipped} unchanged)`,
    'SUCCESS',
  );
  return { imported, skipped, errors };
}

/**
 * Genera resumen de sesión actual
 */
async function generateSessionSummary(
  sessionId?: string,
  dryRun = false,
): Promise<{ path?: string; error?: string }> {
  const sid = sessionId || `session-${getToday().replace(/-/g, '')}`;
  log(`Generating session summary: ${sid}...`, 'INFO');

  try {
    if (!dryRun) ensureDir(SESSIONS_DIR);

    // Buscar contexto de sesión actual
    const sessionDir = join(ROOT, '.session', 'context-log', sid);
    let sessionData = '';

    if (existsSync(sessionDir)) {
      const files = readdirSync(sessionDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        sessionData += readFileSync(join(sessionDir, file), 'utf-8') + '\n\n';
      }
    }

    // Crear resumen
    const summaryPath = join(SESSIONS_DIR, `${sid}-summary.md`);
    const summaryContent = `---
created: ${getToday()}
tags: [session, #${sid}]
session_id: ${sid}
---

# Session Summary: ${sid}

**Generated**: ${getTimestamp()}

## Overview

Session context and artifacts archived from Gentle-Vanguard.

## Session Data

${sessionData || '*No session data available*'}

---

*Auto-generated by knowledge-base-sync*
`;

    if (!dryRun) writeFileSync(summaryPath, summaryContent, 'utf-8');
    log(`${dryRun ? 'Would save' : 'Session summary saved'}: ${summaryPath}`, 'SUCCESS');
    return { path: summaryPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Failed to generate summary: ${msg}`, 'ERROR');
    return { error: msg };
  }
}

/**
 * Muestra estadísticas del vault
 */
function showStats(): void {
  log('Knowledge Base Stats:', 'INFO');

  const folders = Object.values(config.folders);
  let total = 0;

  for (const folder of folders) {
    const folderPath = join(VAULT_DIR, folder);
    if (!existsSync(folderPath)) {
      console.log(`  ${folder}: 0 files`);
      continue;
    }

    const files = readdirSync(folderPath, { recursive: true }) as string[];
    const mdFiles = files.filter((f) => f.toString().endsWith('.md')).length;
    console.log(`  ${folder}: ${mdFiles} files`);
    total += mdFiles;
  }

  console.log(`\n  Total: ${total} markdown files`);
}

// CLI
function parseArgs(): SyncOptions {
  const args = process.argv.slice(2);
  const opts: SyncOptions = { mode: 'full' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' || args[i] === '-m') {
      opts.mode = args[++i] as SyncOptions['mode'];
    } else if (args[i] === '--session-id' || args[i] === '-s') {
      opts.sessionId = args[++i];
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      opts.quiet = true;
    } else if (args[i] === '--dry-run') {
      opts.dryRun = true;
    } else if (args[i] === '--stats') {
      showStats();
      process.exit(0);
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Knowledge Base Sync - Engram ↔ Vault

Usage:
  pnpm kb:sync -- [options]

Options:
  --mode, -m <mode>       Sync mode: full, export, import, session-summary (default: full)
  --session-id, -s <id>   Session ID for summary generation
  --stats                 Show vault statistics
  --quiet, -q             Suppress output
  --dry-run               Preview changes without writing to the vault or Engram
  --help, -h              Show this help

Examples:
  pnpm kb:sync -- --mode full
  pnpm kb:sync -- --mode session-summary --session-id session-2026-07-27
  pnpm kb:sync -- --stats
`);
      process.exit(0);
    }
  }

  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (!opts.quiet)
    console.log(`Knowledge Base Sync - Engram ↔ Vault${opts.dryRun ? ' (dry-run)' : ''}`);

  // Ensure vault exists
  if (!existsSync(VAULT_DIR)) {
    log('Vault not found. Creating structure...', 'WARN');
    if (!opts.dryRun) {
      ensureDir(VAULT_DIR);
      Object.values(config.folders)
        .map((folder) => join(VAULT_DIR, folder))
        .forEach(ensureDir);
    }
  }

  const results: {
    export?: { exported: number; errors: string[] };
    import?: { imported: number; skipped: number; errors: string[] };
    summary?: { path?: string; error?: string };
  } = {};

  switch (opts.mode) {
    case 'export':
      results.export = await exportFromEngram(opts.sessionId, opts.dryRun);
      break;
    case 'import':
      results.import = await importToEngram(opts.dryRun);
      break;
    case 'session-summary':
      results.summary = await generateSessionSummary(opts.sessionId, opts.dryRun);
      break;
    case 'full':
    default:
      results.export = await exportFromEngram(opts.sessionId, opts.dryRun);
      results.import = await importToEngram(opts.dryRun);
      results.summary = await generateSessionSummary(opts.sessionId, opts.dryRun);
      break;
  }

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    Summary                             ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  if (results.export) {
    console.log(`  Exported: ${results.export.exported} observations`);
    if (results.export.errors.length > 0) {
      console.log(`  Export errors: ${results.export.errors.length}`);
    }
  }

  if (results.import) {
    console.log(
      `  Imported: ${results.import.imported} notes (${results.import.skipped} unchanged)`,
    );
    if (results.import.errors.length > 0) {
      console.log(`  Import errors: ${results.import.errors.length}`);
    }
  }

  if (results.summary) {
    if (results.summary.path) {
      console.log(`  Session summary: ${results.summary.path}`);
    } else if (results.summary.error) {
      console.log(`  Summary error: ${results.summary.error}`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
