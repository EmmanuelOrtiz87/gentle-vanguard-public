import { existsSync, readdirSync } from 'fs';
import { DEFAULT_CONFIG, REFLECTIONS_DIR, getDate } from './config.js';
import type { Logger } from './config.js';
import { readKnowledgeBaseVaultFiles } from './readers.js';
import type { SessionRecord } from './readers.js';
import type {
  KnowledgeConcept,
  KnowledgeGap,
  KnowledgeRelationship,
  SynthOutput,
  TrendAnalysis,
  TrendPoint,
} from './types.js';

export function buildKnowledgeMap(
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

export function analyzeTrends(
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

export function analyzeGaps(
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

export function computeQualityScore(
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
