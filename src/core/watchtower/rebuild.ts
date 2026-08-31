// Rebuild actions (F2.5 split): ML Embeddings rebuild + Engram RAG reindex.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { join } from 'path';
import { runSync } from '../run-command';
import { getEffectiveProcessTimeout } from '../timeout-config';
import { addResult, quiet, ROOT } from './context';
import { fileExists } from './helpers';
const logger = log('CORE-WATCHTOWER-REBUILD');
import { log } from '../../utils/logger.js';

// ─── Rebuild Actions ────────────────────────────────────────────────────────

export async function rebuildMlEmbeddings() {
  if (!quiet) logger.info('  [Rebuild] ML Embeddings...');
  const skillEmbedder = join(ROOT, 'src/skills/skill-embedder.ts');
  if (fileExists(skillEmbedder)) {
    try {
      const r = runSync('npx', ['tsx', 'src/skills/skill-embedder.ts'], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: getEffectiveProcessTimeout('long_running'),
      });
      addResult('ml-embeddings', 'rebuild', r.status === 0 ? 'PASS' : 'FAIL', 'Completed', 'ok');
    } catch (e: unknown) {
      addResult(
        'ml-embeddings',
        'rebuild',
        'FAIL',
        `Error: ${e instanceof Error ? e.message : String(e)}`,
        'manual',
        true,
      );
    }
  } else {
    addResult('ml-embeddings', 'rebuild', 'SKIP', 'Not found', 'manual');
  }
}

export async function reindexEngramRag() {
  if (!quiet) logger.info('  [Rebuild] Engram RAG...');
  const ragReindexTs = join(ROOT, 'src', 'knowledge', 'engram-rag-reindex.ts');
  const ragReindexPs1 = join(ROOT, 'src/knowledge/engram-rag-reindex.ts');
  const hasTs = fileExists(ragReindexTs);
  if (hasTs || fileExists(ragReindexPs1)) {
    try {
      let r: { status: number | null };
      if (hasTs) {
        r = runSync('npx', ['tsx', ragReindexTs], {
          cwd: ROOT,
          stdio: 'pipe',
          timeout: getEffectiveProcessTimeout('long_running'),
        });
      } else {
        r = runSync('pwsh', ['-NoProfile', '-File', ragReindexPs1], {
          cwd: ROOT,
          stdio: 'pipe',
          timeout: getEffectiveProcessTimeout('long_running'),
        });
      }
      addResult('engram', 'reindex', r.status === 0 ? 'PASS' : 'FAIL', 'Completed', 'ok');
    } catch (e: unknown) {
      addResult(
        'engram',
        'reindex',
        'FAIL',
        `Error: ${e instanceof Error ? e.message : String(e)}`,
        'manual',
        true,
      );
    }
  } else {
    addResult('engram', 'reindex', 'SKIP', 'Not found', 'manual');
  }
}
