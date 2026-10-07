#!/usr/bin/env node
/** Evalúa routing, metadata, handoff y evidencia de uso de skills sin fabricar actividad. */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRelevantSkills } from './skill-router.js';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

interface RoutingCase {
  id: string;
  query: string;
  expected?: string;
  expectAny?: string[];
}

interface RoutingDataset {
  version: string;
  topK: number;
  minPassRate?: number;
  cases: RoutingCase[];
}

/**
 * Routing suites, in evaluation order. Each declares its own minPassRate so a
 * newly added suite can be introduced with a realistic bar instead of an
 * aspirational one. skill-routing-cases-es.json exists because the ES/EN/PT
 * keywords in auto-delegation.json only reach the index via skill-embedder.ts,
 * and the English suite alone cannot see a regression in Spanish routing.
 */
const ROUTING_SUITES: Array<{ file: string; minPassRate: number }> = [
  { file: 'skill-routing-cases.json', minPassRate: 0.8 },
  { file: 'skill-routing-cases-es.json', minPassRate: 0.7 },
];

type EvidenceKind = 'production' | 'evaluation' | 'maintenance';
type OutcomeSummary = {
  skill: string;
  outcomes: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationMs: number | null;
};

export function readSkillOutcomeEvidence(
  db: Database.Database,
  tenantId = 'gentle-vanguard',
): {
  production: OutcomeSummary[];
  counts: Record<EvidenceKind, number>;
} {
  const hasEvidenceKind = db
    .prepare(
      "SELECT 1 FROM pragma_table_info('skill_execution_outcomes') WHERE name = 'evidence_kind'",
    )
    .get();
  const productionWhere = hasEvidenceKind ? " AND evidence_kind = 'production'" : '';
  const production = db
    .prepare(
      `SELECT skill_id AS skill,
              COUNT(*) AS outcomes,
              SUM(success) AS successes,
              COUNT(*) - SUM(success) AS failures,
              ROUND(SUM(success) * 100.0 / COUNT(*), 2) AS successRate,
              ROUND(AVG(duration_ms), 2) AS avgDurationMs
         FROM skill_execution_outcomes
        WHERE tenant_id = ?${productionWhere}
        GROUP BY skill_id
        ORDER BY outcomes DESC, skill_id ASC`,
    )
    .all(tenantId) as OutcomeSummary[];
  const counts: Record<EvidenceKind, number> = {
    production: 0,
    evaluation: 0,
    maintenance: 0,
  };
  if (hasEvidenceKind) {
    const rows = db
      .prepare(
        `SELECT evidence_kind AS kind, COUNT(*) AS count
           FROM skill_execution_outcomes
          WHERE tenant_id = ?
          GROUP BY evidence_kind`,
      )
      .all(tenantId) as Array<{ kind: EvidenceKind; count: number }>;
    for (const row of rows) counts[row.kind] = row.count;
  } else {
    counts.production = production.reduce((sum, row) => sum + row.outcomes, 0);
  }
  return { production, counts };
}

export interface SkillQualityReport {
  generatedAt: string;
  routing: {
    cases: number;
    passed: number;
    passRate: number;
    minimumPassRate: number;
    suites: Array<{
      file: string;
      cases: number;
      passed: number;
      passRate: number;
      minimumPassRate: number;
      pass: boolean;
    }>;
    results: Array<{
      id: string;
      suite: string;
      expected: string[];
      actual: string[];
      passed: boolean;
      handoffValid: boolean;
    }>;
  };
  metadata: {
    criticalSkills: number;
    valid: number;
    missing: string[];
    invalid: string[];
    duplicateNames: string[];
  };
  usage: {
    evidenceRows: number;
    totalCalls: number;
    usedCriticalSkills: number;
    unusedCriticalSkills: string[];
    status: 'observed' | 'insufficient';
  };
  execution: {
    outcomes: number;
    successes: number;
    failures: number;
    successRate: number | null;
    criticalSkillsWithOutcomes: number;
    status: 'observed' | 'insufficient';
    evidenceCounts: Record<EvidenceKind, number>;
    bySkill: OutcomeSummary[];
  };
  lifecycle: {
    minimumOutcomes: number;
    decisions: Array<{
      skill: string;
      action: 'retain' | 'review';
      reason: string;
    }>;
    deferredWithoutEvidence: number;
    autoDeprecationEnabled: false;
  };
  embeddings: { skills: number; verifiedAt: string | null; ageHours: number | null };
  status: 'PASS' | 'FAIL';
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const block = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/i)?.[1];
  if (!block) return {};
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  // Line-based parse (no lazy [\s\S]*? + lookahead — ReDoS-safe): the value is
  // the inline text plus any continuation lines until the next `key:` line.
  const descHeader = block.match(/^description:[ \t]*(.*)$/m);
  let description: string | undefined;
  if (descHeader) {
    const inline = descHeader[1].replace(/^[>|][ \t]*/, '');
    const afterHeader = block.slice(block.indexOf(descHeader[0]) + descHeader[0].length);
    const parts = [inline];
    for (const line of afterHeader.split('\n')) {
      if (/^[a-zA-Z0-9_-]+:/.test(line)) break;
      parts.push(line);
    }
    description = parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return { name, description };
}

export function auditSkillQuality(root = process.cwd()): SkillQualityReport {
  const routingResults: SkillQualityReport['routing']['results'] = [];
  const suites: SkillQualityReport['routing']['suites'] = [];

  for (const suite of ROUTING_SUITES) {
    const suitePath = join(root, 'tests', 'eval', suite.file);
    if (!existsSync(suitePath)) {
      // A suite that is absent must not silently vanish from the gate; report it
      // as failing rather than reducing the evaluated surface.
      suites.push({ file: suite.file, cases: 0, passed: 0, passRate: 0, minimumPassRate: suite.minPassRate, pass: false });
      continue;
    }
    const dataset = JSON.parse(readFileSync(suitePath, 'utf8')) as RoutingDataset;
    const minPassRate = dataset.minPassRate ?? suite.minPassRate;
    const suiteResults = dataset.cases.map((testCase) => {
      const matches = findRelevantSkills(testCase.query, dataset.topK);
      // A case asserts intent: either one exact skill or any of a set, so a
      // skill rename does not invalidate the suite.
      const accepted = testCase.expectAny ?? (testCase.expected ? [testCase.expected] : []);
      return {
        id: testCase.id,
        suite: suite.file,
        expected: accepted,
        actual: matches.map((match) => match.skill),
        passed: accepted.length > 0 && matches.some((match) => accepted.includes(match.skill)),
        handoffValid: matches.every((match) => Boolean(match.agent && match.agent !== 'unknown')),
      };
    });
    const suitePassed = suiteResults.filter((result) => result.passed).length;
    suites.push({
      file: suite.file,
      cases: suiteResults.length,
      passed: suitePassed,
      passRate: suiteResults.length ? suitePassed / suiteResults.length : 0,
      minimumPassRate: minPassRate,
      pass: suiteResults.length > 0 && suitePassed / suiteResults.length >= minPassRate,
    });
    routingResults.push(...suiteResults);
  }

  const routingPassed = routingResults.filter((result) => result.passed).length;
  const minimumPassRate = ROUTING_SUITES[0]?.minPassRate ?? 0.8;
  const routingPassRate = routingResults.length ? routingPassed / routingResults.length : 0;

  const missing: string[] = [];
  const invalid: string[] = [];
  const names = new Map<string, number>();
  for (const skill of CRITICAL_SKILLS) {
    const resolved = join(
      root,
      skill.root === 'opencode' ? '.opencode/skills' : 'skills',
      skill.dir,
      'SKILL.md',
    );
    if (!existsSync(resolved)) {
      missing.push(skill.dir);
      continue;
    }
    const metadata = parseFrontmatter(readFileSync(resolved, 'utf8'));
    if (!metadata.name || !metadata.description || metadata.description.length < 20) {
      invalid.push(skill.dir);
    }
    const name = metadata.name ?? skill.dir;
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  const duplicateNames = [...names.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  let evidenceRows = 0;
  let totalCalls = 0;
  const used = new Set<string>();
  let outcomeRows: SkillQualityReport['execution']['bySkill'] = [];
  let evidenceCounts: SkillQualityReport['execution']['evidenceCounts'] = {
    production: 0,
    evaluation: 0,
    maintenance: 0,
  };
  const dbPath = join(root, '.runtime', 'gentle-vanguard.db');
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT skill_id, SUM(count) count FROM skill_usage
           WHERE tenant_id = 'gentle-vanguard' GROUP BY skill_id`,
        )
        .all() as Array<{ skill_id: string; count: number }>;
      evidenceRows = rows.length;
      for (const row of rows) {
        used.add(row.skill_id);
        totalCalls += row.count;
      }
      const outcomeTable = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'skill_execution_outcomes'",
        )
        .get();
      if (outcomeTable) {
        const evidence = readSkillOutcomeEvidence(db);
        outcomeRows = evidence.production;
        evidenceCounts = evidence.counts;
      }
    } finally {
      db.close();
    }
  }
  const criticalNames = CRITICAL_SKILLS.map((skill) => skill.dir);
  const unusedCriticalSkills = criticalNames.filter((name) => !used.has(name));
  const outcomeCount = outcomeRows.reduce((sum, row) => sum + row.outcomes, 0);
  const outcomeSuccesses = outcomeRows.reduce((sum, row) => sum + row.successes, 0);
  const outcomeFailures = outcomeRows.reduce((sum, row) => sum + row.failures, 0);
  const minimumLifecycleOutcomes = 5;
  const lifecycleDecisions = outcomeRows
    .filter((row) => row.outcomes >= minimumLifecycleOutcomes)
    .map((row) => ({
      skill: row.skill,
      action: (row.successRate >= 80 ? 'retain' : 'review') as 'retain' | 'review',
      reason: `${row.outcomes} explicit outcomes at ${row.successRate}% success`,
    }));
  const criticalExecutionFailures = outcomeRows.filter(
    (row) =>
      criticalNames.includes(row.skill) &&
      row.outcomes >= minimumLifecycleOutcomes &&
      row.successRate < 50,
  );

  let embeddingSkills = 0;
  let verifiedAt: string | null = null;
  let ageHours: number | null = null;
  try {
    const embedding = JSON.parse(readFileSync(join(root, '.atl', 'skill-embeddings.json'), 'utf8')) as {
      metadata?: { totalSkills?: number };
    };
    embeddingSkills = embedding.metadata?.totalSkills ?? 0;
    const meta = JSON.parse(readFileSync(join(root, '.atl', 'skill-meta.json'), 'utf8')) as {
      lastBuilt?: string;
    };
    verifiedAt = meta.lastBuilt ?? null;
    ageHours = verifiedAt ? Number(((Date.now() - Date.parse(verifiedAt)) / 3_600_000).toFixed(2)) : null;
  } catch {
    // Missing evidence is represented explicitly below.
  }

  const metadataValid = CRITICAL_SKILLS.length - missing.length - invalid.length;
  return {
    generatedAt: new Date().toISOString(),
    routing: {
      cases: routingResults.length,
      passed: routingPassed,
      passRate: Number(routingPassRate.toFixed(4)),
      minimumPassRate,
      suites,
      results: routingResults,
    },
    metadata: {
      criticalSkills: CRITICAL_SKILLS.length,
      valid: metadataValid,
      missing,
      invalid,
      duplicateNames,
    },
    usage: {
      evidenceRows,
      totalCalls,
      usedCriticalSkills: criticalNames.filter((name) => used.has(name)).length,
      unusedCriticalSkills,
      status: evidenceRows > 0 ? 'observed' : 'insufficient',
    },
    execution: {
      outcomes: outcomeCount,
      successes: outcomeSuccesses,
      failures: outcomeFailures,
      successRate:
        outcomeCount > 0 ? Number(((outcomeSuccesses / outcomeCount) * 100).toFixed(2)) : null,
      criticalSkillsWithOutcomes: criticalNames.filter((name) =>
        outcomeRows.some((row) => row.skill === name),
      ).length,
      status: outcomeCount >= minimumLifecycleOutcomes ? 'observed' : 'insufficient',
      evidenceCounts,
      bySkill: outcomeRows,
    },
    lifecycle: {
      minimumOutcomes: minimumLifecycleOutcomes,
      decisions: lifecycleDecisions,
      deferredWithoutEvidence: Math.max(0, embeddingSkills - lifecycleDecisions.length),
      autoDeprecationEnabled: false,
    },
    embeddings: { skills: embeddingSkills, verifiedAt, ageHours },
    // Each suite is judged against its own bar, not the pooled rate: a pooled
    // rate can hide a failing language behind a passing one.
    status:
      suites.every((suite) => suite.pass) &&
      missing.length === 0 &&
      invalid.length === 0 &&
      duplicateNames.length === 0 &&
      criticalExecutionFailures.length === 0 &&
      routingResults.every((result) => result.handoffValid)
        ? 'PASS'
        : 'FAIL',
  };
}

function main(): void {
  const report = auditSkillQuality();
  if (process.argv.includes('--write')) {
    const outDir = resolve('reports', 'audits');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'skill-quality-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--gate') && report.status === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
