#!/usr/bin/env node
/**
 * Knowledge Synthesizer — Cross-session knowledge distillation for Gentle-Vanguard.
 *
 * Reads from Engram, digests, reflections, audit logs, metrics, and the
 * knowledge base vault to produce structured knowledge artifacts:
 *   - Knowledge maps (concepts and their relationships)
 *   - Trend analyses (concept frequency over time)
 *   - Gap analyses (undocumented areas needing attention)
 *
 * The synthesizer closes the knowledge gap:
 *   Datos → Información → Conocimiento → Sabiduría → Decisión
 *
 * Flags:
 *   --synthesize   Run full synthesis (default)
 *   --map          Generate knowledge map only
 *   --trends       Generate trend analysis only
 *   --gaps         Generate gap analysis only
 *   --output json|md  Output format (default: json)
 *   --quiet        Minimal output (pipeline mode)
 *   --dry-run      Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

interface SynthArgs {
  mode: 'synthesize' | 'map' | 'trends' | 'gaps';
  output: 'json' | 'md';
  quiet: boolean;
  dryRun: boolean;
}

interface KnowledgeConcept {
  id: string;
  name: string;
  category: string;
  firstSeen: string;
  lastSeen: string;
  frequency: number;
  sources: string[];
  confidence: number; // 0..1
  relatedConcepts: string[];
}

interface KnowledgeRelationship {
  from: string;
  to: string;
  type: 'depends_on' | 'implements' | 'conflicts_with' | 'extends' | 'related_to' | 'precedes';
  confidence: number;
  evidence: string[];
}

interface TrendPoint {
  date: string;
  conceptCount: number;
  newConcepts: number;
  activeSessions: number;
}

interface TrendAnalysis {
  concept: string;
  windowDays: number;
  points: TrendPoint[];
  trajectory: 'growing' | 'stable' | 'declining' | 'sporadic';
  acceleration: number; // slope
  recommendation: string;
}

interface KnowledgeGap {
  area: string;
  description: string;
  evidenceCount: number;
  evidence: string[];
  suggestedSource: string;
  priority: 'low' | 'medium' | 'high';
}

interface PatternRef {
  id: string;
  type: string;
  title: string;
  severity: string;
}

interface InsightRef {
  category: string;
  finding: string;
  confidence?: number;
}

interface SynthOutput {
  timestamp: string;
  sessionCount: number;
  dateRange: { from: string; to: string };
  patterns?: PatternRef[];
  insights?: InsightRef[];
  concepts: KnowledgeConcept[];
  relationships: KnowledgeRelationship[];
  trends: TrendAnalysis[];
  gaps: KnowledgeGap[];
  qualityScore: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const AUDIT_DIR = join(SESSION_DIR, 'audit', 'logs');
const REFLECTIONS_DIR = join(SESSION_DIR, 'reflections');
const DIGESTS_DIR = join(SESSION_DIR, 'digests');
const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
const KNOWLEDGE_DIR = join(SESSION_DIR, 'knowledge');
const KB_VAULT = join(ROOT, 'knowledge-base');
const SYNTH_CONFIG = join(ROOT, 'config', 'knowledge-synthesis.json');

const DEFAULT_CONFIG = {
  minSessionsForTrend: 2,
  maxKnowledgeMaps: 5,
  maxTrends: 10,
  maxGaps: 8,
  outputDir: KNOWLEDGE_DIR,
  sources: {
    engramContext: true,
    sessionDigests: true,
    reflectionOutputs: true,
    auditLogs: true,
    metrics: true,
    knowledgeBase: true,
    fineTuningData: true,
    contextLogs: true,
  },
  knowledgeMap: { maxConcepts: 50, maxRelationships: 100, minConfidence: 0.3 },
  trendAnalysis: { windowDays: 14, minDataPoints: 3, detectAccelerations: true },
  gapAnalysis: { enabled: true, minEvidenceCount: 2, suggestSources: true },
};

// ─── Helpers ──────────────────────────────────────────────────────────

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function loadJsonLines(path: string): Record<string, unknown>[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

interface Logger {
  (msg: string): void;
}

function getLogger(quiet: boolean): Logger {
  return (msg: string) => {
    if (!quiet) console.log(msg);
  };
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function getDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

// ─── Data Sources ─────────────────────────────────────────────────────

interface SessionRecord {
  id: string;
  timestamp: string;
  type: string;
  status: string;
  message: string;
  date: string;
}

function readAuditSessions(): SessionRecord[] {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const sessions: SessionRecord[] = [];
  for (const f of files.slice(-20)) {
    const entries = loadJsonLines(join(AUDIT_DIR, f));
    for (const e of entries) {
      sessions.push({
        id: (e.id as string) || '',
        timestamp: (e.timestamp as string) || '',
        type: (e.type as string) || '',
        status: (e.status as string) || '',
        message: (e.message as string) || '',
        date: ((e.timestamp as string) || '').slice(0, 10),
      });
    }
  }
  return sessions;
}

function readSessionDigests(): string[] {
  if (!existsSync(DIGESTS_DIR)) return [];
  return readdirSync(DIGESTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 30)
    .map((f) => join(DIGESTS_DIR, f));
}

function readReflectionOutputs(): SynthOutput[] {
  if (!existsSync(REFLECTIONS_DIR)) return [];
  return readdirSync(REFLECTIONS_DIR)
    .filter((f) => f.startsWith('reflection-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => loadJson<SynthOutput>(join(REFLECTIONS_DIR, f), null as unknown as SynthOutput))
    .filter(Boolean);
}

function readKnowledgeBaseVaultFiles(): string[] {
  const files: string[] = [];
  if (!existsSync(KB_VAULT)) return files;
  function walk(dir: string): void {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.')) walk(full);
        else if (e.name.endsWith('.md')) files.push(full);
      }
    } catch {
      /* skip unreadable */
    }
  }
  try {
    walk(KB_VAULT);
  } catch {
    /* vault not available */
  }
  return files.slice(0, 100);
}

function getMetricsSummary(): Record<string, number> {
  const m = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const s = (m.summary as Record<string, number>) || {};
  return {
    delegations: (s.total_delegations as number) || 0,
    corrections: (s.total_corrections as number) || 0,
    qualityScore: (s.quality_score as number) || 100,
    uptimeSeconds: (s.uptime_seconds as number) || 0,
  };
}

function getGitActivity(): { commits: number; changedFiles: number; recentMessages: string[] } {
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const log = runSync('git', ['log', `--since=${since}`, '--format=%s', '--name-only'], {
      cwd: ROOT,
      timeout: 5000,
    }).stdout.trim();
    if (!log) return { commits: 0, changedFiles: 0, recentMessages: [] };
    const sections = log.split('\n\n');
    const messages = sections.map((s) => s.split('\n')[0]).filter(Boolean);
    const files = sections
      .flatMap((s) => s.split('\n').slice(1))
      .filter((f) => f.trim() && !f.startsWith(' '));
    return {
      commits: messages.length,
      changedFiles: [...new Set(files)].length,
      recentMessages: messages.slice(-10),
    };
  } catch {
    return { commits: 0, changedFiles: 0, recentMessages: [] };
  }
}

// ─── Knowledge Extraction ─────────────────────────────────────────────

function extractConceptsFromDigests(digestFiles: string[], log: Logger): KnowledgeConcept[] {
  const concepts: Map<string, KnowledgeConcept> = new Map();
  const conceptPatterns = [
    /## (.+?)(?:\n|$)/g, // markdown headings
    /\*\*(.+?)\*\*/g, // bold text
    /`([a-z-]+)`/gi, // inline code terms
    /([A-Z][a-z]+ [A-Z][a-z]+)/g, // Proper Noun phrases
  ];

  for (const fp of digestFiles) {
    try {
      const content = readFileSync(fp, 'utf-8');
      const date = fp.replace(/.*[\\/](\d{4}-\d{2}-\d{2})\.md$/, '$1');

      for (const pattern of conceptPatterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const name = match[1].trim();
          if (name.length < 3 || name.length > 60) continue;
          if (/^[0-9\s]+$/.test(name)) continue;

          const id = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          if (!id) continue;

          const existing = concepts.get(id);
          if (existing) {
            existing.frequency++;
            existing.lastSeen = date;
            existing.sources.push(fp);
            if (!existing.relatedConcepts.includes(fp)) {
              // extract nearby concepts as related
            }
          } else {
            concepts.set(id, {
              id,
              name,
              category: 'unknown',
              firstSeen: date,
              lastSeen: date,
              frequency: 1,
              sources: [fp],
              confidence: 0.5,
              relatedConcepts: [],
            });
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  log(`  Extracted ${concepts.size} concepts from digests`);
  return [...concepts.values()].sort((a, b) => b.frequency - a.frequency);
}

function extractConceptsFromReflections(reflections: SynthOutput[]): KnowledgeConcept[] {
  const concepts: Map<string, KnowledgeConcept> = new Map();

  for (const ref of reflections) {
    const date = ref.timestamp.slice(0, 10);
    for (const p of ref.patterns || []) {
      const id = `pattern:${p.id}`;
      if (!concepts.has(id)) {
        concepts.set(id, {
          id,
          name: p.title,
          category: `pattern:${p.type}`,
          firstSeen: date,
          lastSeen: date,
          frequency: 1,
          sources: [`reflection:${ref.timestamp}`],
          confidence: p.severity === 'critical' ? 0.9 : p.severity === 'warning' ? 0.7 : 0.5,
          relatedConcepts: [],
        });
      } else {
        const c = concepts.get(id);
        if (c) {
          c.frequency++;
          c.lastSeen = date;
          c.sources.push(`reflection:${ref.timestamp}`);
        }
      }
    }

    for (const ins of ref.insights || []) {
      const id = `insight:${ins.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (!concepts.has(id)) {
        concepts.set(id, {
          id,
          name: ins.finding,
          category: `insight:${ins.category}`,
          firstSeen: date,
          lastSeen: date,
          frequency: 1,
          sources: [`reflection:${ref.timestamp}`],
          confidence: ins.confidence || 0.5,
          relatedConcepts: [],
        });
      }
    }
  }

  return [...concepts.values()];
}

function categorizeConcepts(concepts: KnowledgeConcept[]): KnowledgeConcept[] {
  return concepts.map((c) => {
    if (c.category !== 'unknown') return c;

    const name = c.name.toLowerCase();
    if (name.includes('error') || name.includes('bug') || name.includes('fix')) {
      return { ...c, category: 'bugfix', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('config') || name.includes('setting') || name.includes('.json')) {
      return { ...c, category: 'config', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('architect') || name.includes('design') || name.includes('pattern')) {
      return { ...c, category: 'architecture', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('skill') || name.includes('agent') || name.includes('tool')) {
      return { ...c, category: 'skill', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('deploy') || name.includes('pipeline') || name.includes('ci')) {
      return { ...c, category: 'workflow', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('api') || name.includes('mcp') || name.includes('gateway')) {
      return { ...c, category: 'integration', confidence: Math.min(c.confidence + 0.1, 1) };
    }

    return { ...c, category: 'discovery' };
  });
}

// ─── Knowledge Map ────────────────────────────────────────────────────

function buildKnowledgeMap(
  concepts: KnowledgeConcept[],
  _reflections: SynthOutput[],
  _digestFiles: string[],
  config: typeof DEFAULT_CONFIG,
): { concepts: KnowledgeConcept[]; relationships: KnowledgeRelationship[] } {
  const maxConcepts = config.knowledgeMap.maxConcepts;
  const topConcepts = concepts
    .filter((c) => c.confidence >= config.knowledgeMap.minConfidence)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, maxConcepts);

  // Build relationships based on shared sources
  const relationships: KnowledgeRelationship[] = [];
  const relationshipSet = new Set<string>();

  for (let i = 0; i < topConcepts.length; i++) {
    for (let j = i + 1; j < topConcepts.length; j++) {
      const a = topConcepts[i];
      const b = topConcepts[j];
      const sharedSources = a.sources.filter((s) => b.sources.includes(s));
      if (sharedSources.length > 0) {
        const key = [a.id, b.id].sort().join('||');
        if (
          !relationshipSet.has(key) &&
          relationships.length < config.knowledgeMap.maxRelationships
        ) {
          relationshipSet.add(key);
          relationships.push({
            from: a.id,
            to: b.id,
            type: 'related_to',
            confidence: Math.min(0.3 + sharedSources.length * 0.2, 0.95),
            evidence: sharedSources.slice(0, 3),
          });
        }
      }
    }
  }

  return { concepts: topConcepts, relationships };
}

// ─── Trend Analysis ───────────────────────────────────────────────────

function analyzeTrends(
  topConcepts: KnowledgeConcept[],
  sessions: SessionRecord[],
  config: typeof DEFAULT_CONFIG,
): TrendAnalysis[] {
  const windowDays = config.trendAnalysis.windowDays;
  const minDataPoints = config.trendAnalysis.minDataPoints;
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86400000);

  // Group sessions by date
  const sessionsByDate = new Map<string, number>();
  for (const s of sessions) {
    if (s.date && s.date >= getDate(windowStart)) {
      sessionsByDate.set(s.date, (sessionsByDate.get(s.date) || 0) + 1);
    }
  }

  const trends: TrendAnalysis[] = [];
  const totalDays = Math.ceil((now.getTime() - windowStart.getTime()) / 86400000);

  for (const concept of topConcepts.slice(0, 20)) {
    const points: TrendPoint[] = [];
    let previousCount = 0;
    let accelerations = 0;

    for (let d = 0; d < totalDays; d++) {
      const date = getDate(new Date(windowStart.getTime() + d * 86400000));
      const sessionCount = sessionsByDate.get(date) || 0;
      const isActive = concept.lastSeen >= date && concept.firstSeen <= date;

      points.push({
        date,
        conceptCount: isActive ? 1 : 0,
        newConcepts: concept.firstSeen === date ? 1 : 0,
        activeSessions: sessionCount,
      });

      if (isActive && previousCount === 0 && d > 0) accelerations++;
      previousCount = isActive ? 1 : 0;
    }

    if (points.filter((p) => p.activeSessions > 0).length < minDataPoints) continue;

    // Determine trajectory
    const firstThird = points.slice(0, Math.floor(points.length / 3));
    const lastThird = points.slice(-Math.floor(points.length / 3));
    const firstActivity = firstThird.filter((p) => p.conceptCount > 0).length;
    const lastActivity = lastThird.filter((p) => p.conceptCount > 0).length;

    let trajectory: TrendAnalysis['trajectory'] = 'stable';
    let recommendation = 'Monitor for changes';

    const growth = lastActivity - firstActivity;
    if (lastActivity === 0 && firstActivity > 0) {
      trajectory = 'declining';
      recommendation = 'Consider reviewing relevance — activity decreasing';
    } else if (firstActivity === 0 && lastActivity > 0) {
      trajectory = 'growing';
      recommendation = 'Emerging concept — watch for consolidation opportunities';
    } else if (accelerations >= 3) {
      trajectory = 'sporadic';
      recommendation = 'Irregular activity — may benefit from structured tracking';
    } else if (growth > 1) {
      trajectory = 'growing';
      recommendation = 'Increasing relevance — consider dedicated documentation';
    } else if (growth < -1) {
      trajectory = 'declining';
      recommendation = 'Decreasing relevance — may be resolved or deprecated';
    }

    trends.push({
      concept: concept.name,
      windowDays,
      points,
      trajectory,
      acceleration: growth / Math.max(totalDays, 1),
      recommendation,
    });
  }

  return trends
    .sort((a, b) => {
      const order: Record<string, number> = { growing: 0, sporadic: 1, stable: 2, declining: 3 };
      return (order[a.trajectory] ?? 9) - (order[b.trajectory] ?? 9);
    })
    .slice(0, config.maxTrends);
}

// ─── Gap Analysis ─────────────────────────────────────────────────────

function analyzeGaps(
  concepts: KnowledgeConcept[],
  sessions: SessionRecord[],
  digestFiles: string[],
  _kbFiles: string[],
  _log: Logger,
  maxGaps: number,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];

  // Gap 1: Sessions without corresponding digests
  const sessionDates = new Set(sessions.map((s) => s.date));
  const digestDates = new Set(
    digestFiles
      .map((f) => {
        const m = f.match(/(\d{4}-\d{2}-\d{2})\.md$/);
        return m ? m[1] : '';
      })
      .filter(Boolean),
  );
  const missingDigests = [...sessionDates].filter((d) => d && !digestDates.has(d));
  if (missingDigests.length > 0) {
    gaps.push({
      area: 'Session Documentation',
      description: `${missingDigests.length} session(s) with audit logs but no digest generated`,
      evidenceCount: missingDigests.length,
      evidence: missingDigests.slice(0, 5).map((d) => `Session on ${d}`),
      suggestedSource: 'Run digest-generator for missing dates',
      priority: missingDigests.length > 5 ? 'high' : 'medium',
    });
  }

  // Gap 2: Concepts with low confidence
  const lowConf = concepts.filter((c) => c.confidence < 0.4 && c.frequency >= 2);
  if (lowConf.length > 0) {
    gaps.push({
      area: 'Weak Signal Concepts',
      description: `${lowConf.length} concept(s) appear multiple times but with low confidence classification`,
      evidenceCount: lowConf.length,
      evidence: lowConf
        .slice(0, 5)
        .map((c) => `"${c.name}" (${c.frequency}x, conf: ${c.confidence})`),
      suggestedSource: 'Review and manually categorize in knowledge base vault',
      priority: lowConf.length > 5 ? 'high' : 'medium',
    });
  }

  // Gap 3: High-frequency uncategorized concepts
  const uncategorized = concepts.filter((c) => c.category === 'unknown' && c.frequency >= 3);
  if (uncategorized.length > 0) {
    gaps.push({
      area: 'Uncategorized Frequent Concepts',
      description: `${uncategorized.length} concept(s) appear frequently but lack categorization`,
      evidenceCount: uncategorized.length,
      evidence: uncategorized.slice(0, 5).map((c) => `"${c.name}" (${c.frequency}x)`),
      suggestedSource: 'knowledge-base vault, 02-architecture/ or 03-skills/',
      priority: uncategorized.length > 3 ? 'high' : 'medium',
    });
  }

  // Gap 4: Knowledge base coverage
  const kbFiles = readKnowledgeBaseVaultFiles();
  if (kbFiles.length === 0 && sessions.length > 5) {
    gaps.push({
      area: 'Knowledge Base Vault',
      description: 'Knowledge base vault is empty despite having session history',
      evidenceCount: sessions.length,
      evidence: [`${sessions.length} sessions without vault entries`],
      suggestedSource: 'Run knowledge-base-init to initialize vault structure',
      priority: 'high',
    });
  }

  // Gap 5: Reflection coverage
  const refDir = REFLECTIONS_DIR;
  const refCount = existsSync(refDir)
    ? readdirSync(refDir).filter((f) => f.startsWith('reflection-')).length
    : 0;
  if (refCount === 0 && sessions.length > 3) {
    gaps.push({
      area: 'Self-Reflection Coverage',
      description: 'No reflection artifacts found despite session activity',
      evidenceCount: sessions.length,
      evidence: [`${sessions.length} sessions without reflections`],
      suggestedSource: 'Ensure self-reflection step is active in pipeline',
      priority: 'medium',
    });
  }

  return gaps
    .sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
    })
    .slice(0, maxGaps || 8);
}

// ─── Quality Scoring ──────────────────────────────────────────────────

function computeQualityScore(
  _concepts: KnowledgeConcept[],
  gaps: KnowledgeGap[],
  metrics: Record<string, number>,
): number {
  let score = 85; // baseline

  // Deduct for high-priority gaps
  const highGaps = gaps.filter((g) => g.priority === 'high').length;
  score -= highGaps * 10;

  // Deduct for medium gaps
  const mediumGaps = gaps.filter((g) => g.priority === 'medium').length;
  score -= mediumGaps * 5;

  // Penalize low quality score from metrics
  const metricQuality = metrics.qualityScore || 100;
  if (metricQuality < 70) score -= 15;
  else if (metricQuality < 85) score -= 5;

  // Bonus for having knowledge base
  const kbFiles = readKnowledgeBaseVaultFiles();
  if (kbFiles.length > 0) score += Math.min(kbFiles.length, 10);

  return Math.max(0, Math.min(100, score));
}

// ─── Output Formatting ────────────────────────────────────────────────

function formatJson(output: SynthOutput): string {
  return JSON.stringify(output, null, 2);
}

function formatMarkdown(output: SynthOutput): string {
  const lines: string[] = [];
  lines.push(`# Knowledge Synthesis Report`);
  lines.push(``);
  lines.push(`**Generated**: ${output.timestamp}`);
  lines.push(`**Sessions analyzed**: ${output.sessionCount}`);
  lines.push(`**Date range**: ${output.dateRange.from} → ${output.dateRange.to}`);
  lines.push(`**Quality score**: ${output.qualityScore}/100`);
  lines.push(``);

  lines.push(
    `## Knowledge Map (${output.concepts.length} concepts, ${output.relationships.length} relationships)`,
  );
  lines.push(``);
  const byCategory = new Map<string, KnowledgeConcept[]>();
  for (const c of output.concepts) {
    const cat = c.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const catArr = byCategory.get(cat);
    if (catArr) catArr.push(c);
  }
  for (const [cat, items] of byCategory) {
    lines.push(`### ${cat}`);
    for (const c of items.sort((a, b) => b.frequency - a.frequency).slice(0, 10)) {
      lines.push(`- **${c.name}** — ${c.frequency}x, conf: ${c.confidence}`);
    }
    lines.push(``);
  }

  if (output.trends.length > 0) {
    lines.push(`## Trends (${output.trends.length})`);
    lines.push(``);
    for (const t of output.trends) {
      const icon =
        { growing: '📈', declining: '📉', stable: '➡️', sporadic: '🔄' }[t.trajectory] || '❓';
      lines.push(
        `- ${icon} **${t.concept}** — ${t.trajectory}, accel: ${t.acceleration.toFixed(3)}`,
      );
      lines.push(`  - ${t.recommendation}`);
    }
    lines.push(``);
  }

  if (output.gaps.length > 0) {
    lines.push(`## Gaps (${output.gaps.length})`);
    lines.push(``);
    for (const g of output.gaps) {
      const icon = { high: '🔴', medium: '🟡', low: '🟢' }[g.priority] || '⚪';
      lines.push(`- ${icon} **${g.area}** (${g.priority})`);
      lines.push(`  - ${g.description}`);
      lines.push(`  - Suggested: ${g.suggestedSource}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`_Knowledge Synthesizer v1.0.0_`);
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): SynthArgs {
  const args: SynthArgs = {
    mode: 'synthesize',
    output: 'json',
    quiet: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--synthesize') args.mode = 'synthesize';
    else if (arg === '--map') args.mode = 'map';
    else if (arg === '--trends') args.mode = 'trends';
    else if (arg === '--gaps') args.mode = 'gaps';
    else if (arg === '--output' && argv[i + 1]) {
      const val = argv[++i];
      args.output = val === 'md' ? 'md' : 'json';
    } else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[KNOWLEDGE-SYNTHESIZER] Starting...');

  // 1. Load config
  const config = loadJson<typeof DEFAULT_CONFIG>(SYNTH_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 2. Collect data from all sources
  log('Collecting data sources...');

  const sessions = readAuditSessions();
  log(`  Audit sessions: ${sessions.length}`);

  const digestFiles = readSessionDigests();
  log(`  Digest files: ${digestFiles.length}`);

  const reflections = readReflectionOutputs();
  log(`  Reflection outputs: ${reflections.length}`);

  const kbFiles = readKnowledgeBaseVaultFiles();
  log(`  Knowledge base files: ${kbFiles.length}`);

  const metrics = getMetricsSummary();
  log(`  Metrics: quality=${metrics.qualityScore}, delegations=${metrics.delegations}`);

  const git = getGitActivity();
  log(`  Git: ${git.commits} commits, ${git.changedFiles} files`);

  // 3. Build date range
  const dates = sessions
    .map((s) => s.date)
    .filter(Boolean)
    .sort();
  const dateRange = {
    from: dates[0] || getDate(),
    to: dates[dates.length - 1] || getDate(),
  };

  // 4. Extract and categorize concepts
  log('Extracting concepts...');
  let concepts: KnowledgeConcept[] = [];

  if (args.mode === 'synthesize' || args.mode === 'map') {
    const digestConcepts = extractConceptsFromDigests(digestFiles, log);
    const reflectionConcepts = extractConceptsFromReflections(reflections);
    concepts = categorizeConcepts([...digestConcepts, ...reflectionConcepts]);
    log(`  Total concepts: ${concepts.length}`);
  }

  // 5. Build knowledge map
  let relationships: KnowledgeRelationship[] = [];
  if (args.mode === 'synthesize' || args.mode === 'map') {
    const map = buildKnowledgeMap(concepts, reflections, digestFiles, config);
    concepts = map.concepts;
    relationships = map.relationships;
    log(`  Knowledge map: ${concepts.length} concepts, ${relationships.length} relationships`);
  }

  // 6. Analyze trends
  let trends: TrendAnalysis[] = [];
  if (args.mode === 'synthesize' || args.mode === 'trends') {
    trends = analyzeTrends(concepts, sessions, config);
    log(`  Trends: ${trends.length}`);
  }

  // 7. Analyze gaps
  let gaps: KnowledgeGap[] = [];
  if (args.mode === 'synthesize' || args.mode === 'gaps') {
    gaps = analyzeGaps(concepts, sessions, digestFiles, kbFiles, log, config.maxGaps || 8);
    log(`  Gaps: ${gaps.length}`);
  }

  // 8. Quality score
  const qualityScore = computeQualityScore(concepts, gaps, metrics);
  log(`  Quality score: ${qualityScore}/100`);

  // 9. Build output
  const output: SynthOutput = {
    timestamp: now(),
    sessionCount: sessions.length,
    dateRange,
    concepts: concepts.slice(0, config.knowledgeMap?.maxConcepts || 50),
    relationships: relationships.slice(0, config.knowledgeMap?.maxRelationships || 100),
    trends,
    gaps,
    qualityScore,
  };

  // 10. Output
  if (args.output === 'md') {
    const md = formatMarkdown(output);
    if (!args.quiet) console.log(`\n${md}\n`);
    if (!args.dryRun) {
      const outFile = join(outputDir, `synthesis-${getDate()}.md`);
      writeFileSync(outFile, md, 'utf-8');
      log(`[OK] Markdown report saved to ${outFile}`);
    }
  } else {
    const json = formatJson(output);
    if (!args.quiet) {
      // Print summary line for pipeline mode
      console.log(
        JSON.stringify({
          concepts: output.concepts.length,
          relationships: output.relationships.length,
          trends: output.trends.length,
          gaps: output.gaps.length,
          qualityScore: output.qualityScore,
        }),
      );
    }
    if (!args.dryRun) {
      const outFile = join(outputDir, `synthesis-${getDate()}.json`);
      writeFileSync(outFile, json, 'utf-8');
      log(`[OK] JSON report saved to ${outFile}`);
    }
  }

  log('[KNOWLEDGE-SYNTHESIZER] Done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
