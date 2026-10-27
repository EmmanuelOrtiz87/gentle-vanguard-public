#!/usr/bin/env node
/**
 * Auto-Norm-Learner TypeScript Implementation
 *
 * Analyzes session patterns, failures, and successes to automatically learn
 * and update norms in rules/adaptive/LEARNED-NORMS.md
 *
 * Trigger: session-start, post-session, on-failure
 * Integration: Called from session-autostart pipeline
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';

interface Norm {
  id: string;
  category: 'pattern' | 'fix' | 'optimization' | 'avoidance';
  description: string;
  trigger: string;
  confidence: number; // 0-100
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  status: 'proposed' | 'active' | 'deprecated';
  source: string;
}

interface LearningContext {
  sessionId: string;
  timestamp: string;
  trigger: 'session-start' | 'post-session' | 'on-failure' | 'manual';
  metrics?: {
    qualityScore: number;
    corrections: number;
    failures: number;
    tokenUsage: number;
  };
}

interface SessionData {
  sessionId: string;
  startTime: string;
  endTime?: string;
  toolCalls: number;
  filesRead: number;
  filesEdited: number;
  qualityScore: number;
  errors: string[];
  warnings: string[];
}

const ROOT = resolve(process.cwd());
const LEARNED_NORMS_PATH = join(ROOT, 'rules', 'adaptive', 'LEARNED-NORMS.md');
const SESSION_DIR = join(ROOT, '.session');
const NORMS_DB_PATH = join(SESSION_DIR, 'learned-norms.json');
const METRICS_PATH = join(ROOT, '.session', 'metrics-report.json');

/**
 * Load existing norms database
 */
function loadNorms(): Norm[] {
  try {
    if (existsSync(NORMS_DB_PATH)) {
      const data = readFileSync(NORMS_DB_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[AUTO-NORM] Failed to load norms:', e);
  }
  return [];
}

/**
 * Save norms database
 */
function saveNorms(norms: Norm[]): void {
  try {
    if (!existsSync(SESSION_DIR)) {
      mkdirSync(SESSION_DIR, { recursive: true });
    }
    writeFileSync(NORMS_DB_PATH, JSON.stringify(norms, null, 2));
  } catch (e) {
    console.error('[AUTO-NORM] Failed to save norms:', e);
  }
}

/**
 * Load session data from recent sessions
 */
function loadRecentSessions(days = 7): SessionData[] {
  const sessions = new Map<string, SessionData>();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  try {
    for (const file of readdirSync(SESSION_DIR, { withFileTypes: true })) {
      if (!file.isFile() || !/^session-.*\.json$/.test(file.name)) continue;
      try {
        const raw = JSON.parse(readFileSync(join(SESSION_DIR, file.name), 'utf-8'));
        if (!raw || typeof raw !== 'object') continue;
        const sessionId = raw.sessionId ?? raw.id;
        const startTime = raw.startTime ?? raw.timestamp;
        const started = typeof startTime === 'string' ? Date.parse(startTime) : NaN;
        if (typeof sessionId !== 'string' || !sessionId || !Number.isFinite(started) ||
          started < cutoff || started > Date.now()) continue;
        const count = (value: unknown): number =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
        const messages = (value: unknown): string[] => Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
        const data: SessionData = {
          sessionId, startTime, endTime: typeof raw.endTime === 'string' ? raw.endTime : undefined,
          toolCalls: count(raw.toolCalls), filesRead: count(raw.filesRead), filesEdited: count(raw.filesEdited),
          qualityScore: count(raw.qualityScore), errors: messages(raw.errors), warnings: messages(raw.warnings),
        };
        const existing = sessions.get(sessionId);
        if (!existing || data.toolCalls >= existing.toolCalls) sessions.set(sessionId, data);
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // No sessions found
  }
  return [...sessions.values()];
}

// ─── Engram inbox ingestion (2026-10-21, mandate "aprender de lo resuelto día a día") ───

const INBOX_DIR = join(ROOT, 'knowledge-base', '00-inbox');
const MAX_INGEST_FILES = 600;
const STEM_TOKENS = 9;

const TYPE_TO_CATEGORY: Record<string, Norm['category']> = {
  bugfix: 'fix',
  pattern: 'pattern',
  discovery: 'pattern',
  architecture: 'optimization',
  decision: 'optimization',
};

/** stem = primeras N palabras normalizadas de una lección → dedupe entre sesiones. */
export function lessonStem(lesson: string): string {
  return (
    lesson
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü ]+/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, STEM_TOKENS)
      .join(' ') || ''
  ).slice(0, 180);
}

export interface IngestResult { normsAdded: number; filesRead: number; filesSkipped: number }

/**
 * Ingesta las lecciones Learned del inbox engram (los mem_save diarios exportados a
 * knowledge-base/00-inbox/engram-*.md). Agrupa por stem → las clases que se repiten
 * entre sesiones suben occurrences y (vía promoteNorms) pueden activarse. Idempotente:
 * dedupe por trigger-id estable = `inbox:<stem>`.
 */
const INGEST_STATE_PATH = join(ROOT, '.session', 'learned-norms-ingest-state.json');

import { createHash } from 'crypto';

interface IngestState {
  files: Record<string, string>; // archivo → sha1 del contenido
  stems: Record<string, string[]>; // normId → archivos que aportaron esa lección
}
function loadIngestState(): IngestState {
  try {
    const raw = JSON.parse(readFileSync(INGEST_STATE_PATH, 'utf8')) as Partial<IngestState>;
    return { files: raw.files ?? {}, stems: raw.stems ?? {} };
  } catch {
    return { files: {}, stems: {} };
  }
}
function saveIngestState(state: IngestState): void {
  try {
    writeFileSync(INGEST_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    /* best-effort: sin state re-lectura infla ocurrencias (bug r17) */
  }
}

/**
 * Idempotencia por contenido (2026-10-21 ronda 17): re-lecturas del mismo archivo
 * inflaban occurrences (++ por cada corrida) → Chromium x2→x6 tras 4 corridas.
 * Solución: hash SHA-1 por archivo; files sin cambios NO re-ingestan. Si el DB de
 * norms está vacío (rebuild), se fuerza re-ingesta descartando el state previo.
 */
export function ingestInboxLessons(norms: Norm[]): { norms: Norm[]; result: IngestResult } {
  const out = [...norms];
  let filesRead = 0;
  let normsAdded = 0;
  let filesSkipped = 0;
  let files: string[];
  try {
    files = readdirSync(INBOX_DIR)
      .filter((f) => /^engram-\d+-\w+\.md$/.test(f))
      .sort((a, b) => (Number(b.match(/\d+/)?.[0] ?? 0)) - (Number(a.match(/\d+/)?.[0] ?? 0)))
      .slice(0, MAX_INGEST_FILES);
  } catch {
    return { norms: out, result: { normsAdded, filesRead, filesSkipped } };
  }
  const dbWasEmpty = norms.length === 0;
  const prevState = loadIngestState();
  const state: IngestState = dbWasEmpty ? { files: {}, stems: {} } : prevState;
  const byStem = new Map<string, Norm>();
  for (const norm of out) if (norm.id.startsWith('inbox:')) byStem.set(norm.id, norm);
  for (const file of files) {
    const abs = join(INBOX_DIR, file);
    let content: string;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const hash = createHash('sha1').update(content).digest('hex');
    if (!dbWasEmpty && state.stems && state.files[file] === hash) {
      filesSkipped++; // mismo contenido ya ingerido: NO sumar ocurrencias de nuevo
      continue;
    }
    state.files[file] = hash; // marca como procesado (contenido actual)
    filesRead++;
    const typeMatch = content.match(/^type:\s*(\w+)/m);
    const type = typeMatch?.[1] ?? 'pattern';
    const category = TYPE_TO_CATEGORY[type] ?? 'pattern';
    // lecciones Learned (bullets después de **Learned**:) + fallback a la primera frase What:
    const learnedBlock = content.split('**Learned**')[1] ?? content.split('**What**')[1] ?? '';
    const lessons = learnedBlock
      .split('\n')
      .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
      .filter((l) => l.length >= 20 && l.length <= 400)
      // watermark del export engram (pie del archivo) NO es lección (fix 2026-10-21:
      // se coló como lección y absorbió 454 ocurrencias falsas en el primer ciclo)
      .filter((l) => !/^imported from engram/i.test(l))
      .filter((l) => !/^(tags|created|engram_id|type):/i.test(l));
    const engramId = file.match(/engram-(\d+)/)?.[0] ?? file;
    for (const lesson of lessons.slice(0, 6)) {
      const stem = lessonStem(lesson);
      if (stem.length < 15) continue;
      const id = `inbox:${stem.slice(0, 80)}`;
      const existing = byStem.get(id);
      if (existing) {
        // recurrencia GENUINA = la misma lección vive en un archivo DIFERENTE
        // (otra sesión/otro exports). Re-lecturas del mismo archivo no suman nada
        // (hash skip) y tampoco inflan occ ni confidence.
        const contributors = state.stems[id] ?? [];
        if (!contributors.includes(file)) {
          contributors.push(file);
          state.stems[id] = contributors;
          existing.occurrences++;
          existing.confidence = Math.min(100, existing.confidence + 2);
        }
        const observedAt = dateFromInbox(preDate(content));
        if (observedAt && (!Number.isFinite(Date.parse(existing.lastSeen)) ||
          Date.parse(observedAt) > Date.parse(existing.lastSeen))) {
          existing.lastSeen = observedAt;
        }
      } else {
        state.stems[id] = [file];
        const norm: Norm = {
          id,
          category,
          description: lesson.length > 300 ? `${lesson.slice(0, 297)}…` : lesson,
          trigger: stem.slice(0, 60),
          confidence: 55,
          occurrences: 1,
          firstSeen: dateFromInbox(preDate(content)) || new Date().toISOString(),
          lastSeen: dateFromInbox(preDate(content)) || new Date().toISOString(),
          status: 'proposed',
          source: `engram-inbox:${engramId}`,
        };
        byStem.set(id, norm);
        out.push(norm);
        normsAdded++;
      }
    }
  }
  saveIngestState(state);
  return { norms: out, result: { normsAdded, filesRead, filesSkipped } };
}

function preDate(content: string): string {
  return content.match(/^created:\s*(.+)$/m)?.[1]?.trim() ?? '';
}
function dateFromInbox(created: string): string | '' {
  const normalized = created.trim().replace(' ', 'T');
  if (!normalized) return '';
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

/**
 * Load current metrics
 */
interface SessionMetrics {
  qualityScore?: number;
}

function loadMetrics(): SessionMetrics | null {
  try {
    if (existsSync(METRICS_PATH)) {
      const data = readFileSync(METRICS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // No metrics
  }
  return null;
}

/**
 * Analyze patterns from session data
 */
function analyzePatterns(sessions: SessionData[], norms: Norm[]): Norm[] {
  const newNorms = [...norms];
  const now = new Date().toISOString();

  // Pattern 1: High error rate in specific operations
  const errorPatterns = new Map<string, number>();
  for (const session of sessions) {
    const types = new Set((session.errors || []).map((error) => error.split(':')[0] || error));
    for (const key of types) {
      errorPatterns.set(key, (errorPatterns.get(key) || 0) + 1);
    }
  }

  for (const [errorType, count] of errorPatterns) {
    if (count >= 3) {
      // Threshold for pattern recognition
      const existing = newNorms.find((n) => n.trigger === errorType && n.category === 'avoidance');
      if (existing) {
        existing.occurrences = count;
        existing.lastSeen = now;
        existing.confidence = Math.min(95, count * 15);
      } else {
        newNorms.push({
          id: `norm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          category: 'avoidance',
          description: `Avoid pattern that leads to: ${errorType}`,
          trigger: errorType,
          confidence: Math.min(95, count * 15),
          occurrences: count,
          firstSeen: now,
          lastSeen: now,
          status: 'proposed',
          source: 'auto-analysis',
        });
      }
    }
  }

  // Pattern 2: Successful optimizations
  const highQualitySessions = sessions.filter((s) => s.toolCalls > 0 && s.qualityScore >= 90);
  if (highQualitySessions.length >= 3) {
    const existing = newNorms.find(
      (n) => n.trigger === 'high-quality-session' && n.category === 'optimization',
    );
    if (existing) {
      existing.occurrences = highQualitySessions.length;
      existing.confidence = Math.min(95, highQualitySessions.length * 20);
      existing.lastSeen = now;
    } else {
      newNorms.push({
        id: `norm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        category: 'optimization',
        description: 'Pattern for achieving high quality scores (90+) consistently',
        trigger: 'high-quality-session',
        confidence: Math.min(95, highQualitySessions.length * 20),
        occurrences: highQualitySessions.length,
        firstSeen: highQualitySessions[0]?.startTime || now,
        lastSeen: now,
        status: 'proposed',
        source: 'auto-analysis',
      });
    }
  }

  // Pattern 3: Token efficiency
  const efficientSessions = sessions.filter(
    (s) => s.toolCalls > 0 && (s.filesRead || 0) / s.toolCalls > 2,
  );
  if (efficientSessions.length >= 3) {
    const existing = newNorms.find(
      (n) => n.trigger === 'token-efficiency' && n.category === 'optimization',
    );
    if (existing) {
      existing.occurrences = efficientSessions.length;
      existing.confidence = Math.min(95, efficientSessions.length * 20);
      existing.lastSeen = now;
    } else {
      newNorms.push({
        id: `norm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        category: 'optimization',
        description: 'High file-to-tool ratio indicates efficient context usage',
        trigger: 'token-efficiency',
        confidence: Math.min(95, efficientSessions.length * 20),
        occurrences: efficientSessions.length,
        firstSeen: efficientSessions[0]?.startTime || now,
        lastSeen: now,
        status: 'proposed',
        source: 'auto-analysis',
      });
    }
  }

  return newNorms;
}

/**
 * Promote norms based on confidence and occurrences
 */
function promoteNorms(norms: Norm[]): Norm[] {
  return norms.map((norm) => {
    if (norm.status === 'proposed' && norm.confidence >= 80 && norm.occurrences >= 5) {
      return { ...norm, status: 'active' };
    }
    if (norm.status === 'active' && norm.occurrences >= 20) {
      // Keep active, could add 'established' status in future
      return norm;
    }
    return norm;
  });
}

/**
 * Prune stale norms
 */
function pruneStaleNorms(norms: Norm[]): Norm[] {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return norms.filter((norm) => {
    if (norm.status === 'deprecated') return false;
    if (norm.occurrences < 3 && new Date(norm.lastSeen) < thirtyDaysAgo) {
      return false; // Remove unused proposed norms
    }
    return true;
  });
}

/**
 * Cola de promoción clase-B (normativa v2.0: "recurrente ≥2 → norma/skill/automation")
 * 2026-10-21 ronda 17: la cola sale del archivo auto-mantenido promueve el TRIGGER
 * del ciclo A-D: future sesiones leen PROMOTION-QUEUE.md y aterrizan la norma como
 * skill/automation/helper nativo vía courtecicuito del semáforo verde.
 */
const PROMOTION_QUEUE_PATH = join(ROOT, 'rules', 'adaptive', 'PROMOTION-QUEUE.md');

function savePromotionQueue(norms: Norm[]): void {
  const ENTRADA_MIN = 2; // clase-B per NORMATIVAS-AUTONOMOUS-EVOLUTION.md v2.0 (≥2 recurrente)
  const candidates = norms
    .filter((n) => n.status === 'proposed' && n.occurrences >= ENTRADA_MIN)
    .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);

  const lines: string[] = [
    `# Promotion Queue (Class-B candidates)`,
    ``,
    `Auto-mantenido por auto-norm-learner.ts — generado: ${new Date().toISOString()}`,
    `Criterio (clase-B, normativa v2.0): status=proposed ∧ occurrences ≥ ${ENTRADA_MIN}.`,
    `Acción siguiente del agente: aterrizar la normativa como skill/automation/helper nativo`,
    `+ registrar su ID en PROMOTED-NORMS.json para marcarla active; el commit`,
    `requerido es visible al owner. Empty queue = no recurrentes aún.`,
    ``,
    `## Candidates (${candidates.length})`,
    ``,
  ];
  const activeFirst = candidates.slice(0, 50);
  for (const c of activeFirst) {
    lines.push(`- **${c.id}** — ${c.description}`);
    lines.push(`  - occ=${c.occurrences} · conf=${c.confidence}% · cat=${c.category} · último=${c.lastSeen}`);
  }
  if (!activeFirst.length) lines.push(`_Ninguna recurrence ≥ ${ENTRADA_MIN} pendiente._`);
  writeFileSync(PROMOTION_QUEUE_PATH, `${lines.join('\n')}\n`, 'utf-8');
}

/**
 * Promoción clase-B de primera clase (ronda 18, 2026-10-21): el agente aterriza la
 * norma como skill/automation y registra su ID en rules/adaptive/PROMOTED-NORMS.json;
 * en cada corrida el learner marca esas normas como active (promoted vía) y salen
 * de la cola. Registro = verde autónomo (NORMATIVAS v2.0); el commit queda visible.
 */
function loadPromotedIds(): string[] {
  try {
    const raw = JSON.parse(
      readFileSync(join(ROOT, 'rules', 'adaptive', 'PROMOTED-NORMS.json'), 'utf8'),
    ) as { promoted: string[] };
    return raw.promoted ?? [];
  } catch {
    return [];
  }
}

function applyPromotions(norms: Norm[]): { norms: Norm[]; promoted: number } {
  const ids = new Set(loadPromotedIds());
  let count = 0;
  for (const n of norms) {
    if (ids.has(n.id) && n.status !== 'active') {
      n.status = 'active';
      n.confidence = Math.max(n.confidence, 80);
      count++;
    }
  }
  return { norms, promoted: count };
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(norms: Norm[]): string {
  const now = new Date().toISOString();
  const activeAll = norms.filter((n) => n.status === 'active');
  const proposedAll = norms.filter((n) => n.status === 'proposed');
  const deprecatedNorms = norms.filter((n) => n.status === 'deprecated');
  // Cap de render (2026-10-21): con la ingesta de engram-inbox el master index puede
  // tener cientos de norms — el índice renderiza top-25 por occurrences/fecha y los
  // conteos completos viven en Statistics (y el JSON de .session/learned-norms.json).
  const activeNorms = [...activeAll]
    .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence)
    .slice(0, 25);
  const proposedNorms = [...proposedAll]
    .sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence)
    .slice(0, 25);

  return `# Learned Norms (Autonomous)

Auto-maintained by auto-norm-learner.ts — last run: ${now}

## Statistics

- Total norms: ${norms.length}
- Active norms: ${activeAll.length} (render top-25)
- Proposed norms: ${proposedAll.length} (render top-25)
- Deprecated norms: ${deprecatedNorms.length}
- Last trigger: session-start

## Active Norms

${
  activeNorms.length === 0
    ? '_No active norms yet. Learning in progress..._'
    : activeNorms
        .map(
          (n) => `
### ${n.id}
- **Category**: ${n.category}
- **Description**: ${n.description}
- **Trigger**: ${n.trigger}
- **Confidence**: ${n.confidence}%
- **Occurrences**: ${n.occurrences}
- **First seen**: ${n.firstSeen}
- **Last seen**: ${n.lastSeen}
`,
        )
        .join('\n')
}

## Proposed Norms

${
  proposedNorms.length === 0
    ? '_No proposed norms pending._'
    : proposedNorms
        .map(
          (n) => `
### ${n.id}
- **Category**: ${n.category}
- **Description**: ${n.description}
- **Trigger**: ${n.trigger}
- **Confidence**: ${n.confidence}%
- **Occurrences**: ${n.occurrences}
- **Status**: Pending promotion (needs confidence ≥80 and occurrences ≥5)
`,
        )
        .join('\n')
}

## Deprecated Norms

${deprecatedNorms.length === 0 ? '_No deprecated norms._' : deprecatedNorms.map((n) => `- ${n.id}: ${n.description}`).join('\n')}

---

*This file is automatically updated by the auto-norm-learner system.*
`;
}

/**
 * Save markdown report
 */
function saveMarkdownReport(content: string): void {
  try {
    const dir = join(ROOT, 'rules', 'adaptive');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(LEARNED_NORMS_PATH, content);
  } catch (e) {
    console.error('[AUTO-NORM] Failed to save markdown:', e);
  }
}

/**
 * Log learning to Engram if available
 */
function logToEngram(norms: Norm[], context: LearningContext, newNorms: number): void {
  try {
    const summary = {
      timestamp: context.timestamp,
      trigger: context.trigger,
      totalNorms: norms.length,
      newNorms,
      activeNorms: norms.filter((n) => n.status === 'active').length,
    };

    const saved = runSync(
      'engram',
      [
        'save',
        'auto-norm-learner: learning report',
        JSON.stringify(summary),
        '--type',
        'learning',
        '--project', 'gentle-vanguard',
        '--scope', 'project',
        '--topic', 'learning/auto-norm-learner',
      ],
      { stdio: 'pipe', cwd: ROOT, timeout: 10000 },
    );
    if (saved.status !== 0) throw saved.error ?? new Error(`Engram exited ${saved.status}`);
  } catch {
    // Engram not available, skip
    console.log('[AUTO-NORM] Engram not available, skipping log');
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const trigger = (args.find((a) => a.startsWith('--trigger='))?.split('=')[1] ||
    'manual') as LearningContext['trigger'];
  const quiet = args.includes('--quiet');

  if (!quiet) {
    console.log('[AUTO-NORM] Starting auto-norm-learner...');
    console.log(`[AUTO-NORM] Trigger: ${trigger}`);
  }

  const context: LearningContext = {
    sessionId: process.env.SESSION_ID || `session-${Date.now()}`,
    timestamp: new Date().toISOString(),
    trigger,
  };

  // Load existing data
  let norms = loadNorms();
  const existingIds = new Set(norms.map((n) => n.id));
  const inbox = ingestInboxLessons(norms);
  norms = inbox.norms;
  const sessions = loadRecentSessions(7);
  const _metrics = loadMetrics();

  if (!quiet) {
    console.log(`[AUTO-NORM] Loaded ${norms.length} existing norms`);
    console.log(`[AUTO-NORM] Ingested engram inbox: ${inbox.result.filesRead} read / ${inbox.result.filesSkipped} skipped (hash-unchanged), ${inbox.result.normsAdded} lessons`);
    console.log(`[AUTO-NORM] Analyzing ${sessions.length} recent sessions`);
    if (_metrics) {
      console.log(`[AUTO-NORM] Metrics loaded: quality=${_metrics.qualityScore}`);
    }
  }

  // Analyze and learn
  const previouslyActive = new Set(norms.filter((n) => n.status === 'active').map((n) => n.id));
  norms = analyzePatterns(sessions, norms);
  const promo = applyPromotions(norms);
  norms = promo.norms;
  norms = promoteNorms(norms);
  norms = pruneStaleNorms(norms);

  // Save results
  saveNorms(norms);
  const markdown = generateMarkdownReport(norms);
  saveMarkdownReport(markdown);
  savePromotionQueue(norms);

  // Log to Engram
  logToEngram(norms, context, norms.filter((n) => !existingIds.has(n.id)).length);

  // Signal auto-apply-safe for newly promoted norms
  const promotedCount = norms.filter(
    (n) => n.status === 'active' && !previouslyActive.has(n.id),
  ).length;
  if (promotedCount > 0) {
    const triggerDir = join(ROOT, '.session', 'auto-apply');
    if (!existsSync(triggerDir)) mkdirSync(triggerDir, { recursive: true });
    writeFileSync(
      join(triggerDir, 'trigger-norms.json'),
      JSON.stringify({
        source: 'auto-norm-learner',
        type: 'norm-promotion',
        promotedCount,
        timestamp: new Date().toISOString(),
      }),
      'utf-8',
    );
  }

  // Output summary
  const activeCount = norms.filter((n) => n.status === 'active').length;
  const proposedCount = norms.filter((n) => n.status === 'proposed').length;

  if (!quiet) {
    console.log(`[AUTO-NORM] Learning complete:`);
    console.log(`  - Total norms: ${norms.length}`);
    console.log(`  - Active: ${activeCount}`);
    console.log(`  - Proposed: ${proposedCount}`);
    console.log(`[AUTO-NORM] Report saved to: rules/adaptive/LEARNED-NORMS.md (repo-relative)`);
  }

  // Return success
  process.exit(0);
}

// Run if called directly (fix 2026-10-21: el check anterior comparaba
// import.meta.url contra un path Windows exportado por fileURLToPath — incompatible
// en win32, main() nunca corria; usar detección por basename como el resto del stack)
const invoked = ['auto-norm-learner.ts', 'auto-norm-learner.js'].includes(
  process.argv[1]?.split(/[\\/]/).pop() ?? '',
);
if (invoked) {
  main().catch((err) => {
    console.error('[AUTO-NORM] Fatal error:', err);
    process.exit(1);
  });
}

export { analyzePatterns, promoteNorms, pruneStaleNorms };
export type { Norm, LearningContext };
