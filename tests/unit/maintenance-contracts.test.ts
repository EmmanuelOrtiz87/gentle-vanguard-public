import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeFallbackState } from '../../src/ml/model-fallback-orchestrator.js';
import { evaluateCodeGraphAvailability } from '../../src/core/watchtower/checks-infra.js';
import { evaluateProviderAlertStatus } from '../../src/core/watchtower/checks-data.js';
import { getEmbeddingFreshnessHours } from '../../src/skills/skill-embedder-incremental.js';
import { findDuplicateJsonKeys } from '../../src/tools/json-lint.js';
import {
  extractLogTimestamp,
  findLatestModelErrorLine,
  isNewHealthEvent,
} from '../../src/ml/model-provider-healer.js';
import { getDetectedTool } from '../../src/core/detect-tool.js';
import { buildZCodeHookConfig, copySkillTree } from '../../src/integrations/zcode-sync.js';
import {
  evaluateRegression,
  percentile as performancePercentile,
  type PerformanceBaseline,
} from '../../src/monitor/performance-baseline.js';
import { summarizeDurations } from '../../src/monitor/performance-exercise.js';
import { discoverSkills, parseSkillDocument } from '../../src/skills/skill-embedder.js';
import { lexicalBoost } from '../../src/skills/skill-router.js';
import { parseExplicitOutcome } from '../../src/skills/skill-usage-tracker.js';
import { canAutoArchive } from '../../src/skills/skill-evolution-engine.js';
import { parseSkillRegistry } from '../../src/skills/skill-registry-parser.js';
import { readSkillOutcomeEvidence } from '../../src/skills/skill-quality-audit.js';
import { evaluateLiveProbe } from '../../src/skills/skill-e2e-runner.js';
import {
  getEngramInstallModule,
  isEngramDoctorHealthy,
} from '../../src/knowledge/engram-auto-update.js';
import {
  compareSkillTrees,
  isUsableLauncherFile,
  parseOpenCodeRuntimeMajor,
} from '../../src/integrations/tool-interoperability-audit.js';
import { findBrokenRelativeImports } from '../../src/tools/ast-import-parser.js';

test('normalizes legacy fallback state without losing counters', () => {
  const state = normalizeFallbackState({
    agentStates: {},
    globalFallbackCount: 7,
    lastUpdated: '2026-08-02T05:47:07.522Z',
  });

  assert.equal(state.activeModel, 'opencode/deepseek-v4-flash-free');
  assert.deepEqual(state.exhaustedModels, []);
  assert.deepEqual(state.agentModelOverrides, {});
  assert.equal(state.globalFallbackCount, 7);
});

test('accepts a configured stdio CodeGraph server without a persistent daemon', () => {
  assert.deepEqual(
    evaluateCodeGraphAvailability({
      indexOk: true,
      mcpConfigured: true,
      pidAlive: false,
      processRunning: false,
    }),
    {
      status: 'PASS',
      detail: 'MCP stdio configured; starts on demand',
      action: 'ok',
    },
  );
});

test('alerts only when the unhealthy provider is the active model', () => {
  assert.equal(evaluateProviderAlertStatus('glm-5.3-flash', 'deepseek-v4-flash-free'), 'PASS');
  assert.equal(evaluateProviderAlertStatus('glm-5.3-flash', 'glm-5.3-flash'), 'WARN');
});

test('uses the latest successful embedding verification as freshness source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-embeddings-'));
  const indexPath = join(dir, 'skill-embeddings.json');
  const metaPath = join(dir, 'skill-meta.json');
  const now = Date.parse('2026-09-17T18:00:00.000Z');

  writeFileSync(indexPath, JSON.stringify({ generated: '2026-09-10T00:00:00.000Z' }));
  writeFileSync(metaPath, JSON.stringify({ lastBuilt: '2026-09-17T17:30:00.000Z' }));

  assert.equal(getEmbeddingFreshnessHours(indexPath, metaPath, now), 0.5);
});

test('reports duplicate JSON keys with their object path', () => {
  assert.deepEqual(findDuplicateJsonKeys('{"scripts":{"check":"first","check":"second"}}'), [
    'scripts.check',
  ]);
});

test('keeps provider health event time and rejects an already processed log line', () => {
  const line = 'timestamp=2026-09-15T22:14:28.287Z level=ERROR modelID=glm-5.3-flash error="bad"';
  const eventAt = extractLogTimestamp(line, Date.parse('2026-09-17T18:00:00.000Z'));

  assert.equal(eventAt, '2026-09-15T22:14:28.287Z');
  assert.equal(isNewHealthEvent(eventAt, '2026-09-17T17:57:22.602Z'), false);
  assert.equal(isNewHealthEvent('2026-09-17T18:01:00.000Z', eventAt), true);
});

test('selects the latest provider error line that still identifies a model', () => {
  const lines = [
    'timestamp=2026-09-15T22:14:28.287Z level=ERROR modelID=glm-5.3-flash error="unknown field provider"',
    'timestamp=2026-09-15T22:14:28.290Z level=ERROR message=process error="unknown field provider"',
  ];

  assert.equal(findLatestModelErrorLine(lines, /unknown field provider/i), lines[0]);
});

test('explicit Codex runtime wins over the repository OpenCode marker', () => {
  const previous = process.env.CODEX_SESSION_ID;
  process.env.CODEX_SESSION_ID = 'contract-test';
  try {
    const detected = getDetectedTool();
    assert.equal(detected.name, 'codex');
    assert.equal(detected.isCodex, true);
    assert.equal(detected.confidence, 100);
  } finally {
    if (previous === undefined) delete process.env.CODEX_SESSION_ID;
    else process.env.CODEX_SESSION_ID = previous;
  }
});

test('ZCode hook synchronization preserves plugins and avoids the tsx CLI process', () => {
  const config = buildZCodeHookConfig(
    { plugins: { enabledPlugins: { 'github@zcode-plugins-official': true } } },
    'C:\\Workspace_local\\gentle-vanguard',
  );
  const serialized = JSON.stringify(config);

  assert.match(serialized, /github@zcode-plugins-official/);
  assert.match(serialized, /--import/);
  assert.doesNotMatch(serialized, /cli\.mjs/);
});

test('cross-tool skill synchronization preserves nested resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-skill-copy-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(join(source, 'references'), { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), '---\nname: test\ndescription: test\n---\n');
  writeFileSync(join(source, 'references', 'contract.md'), 'nested evidence');

  copySkillTree(source, target);

  assert.equal(existsSync(join(target, 'SKILL.md')), true);
  assert.equal(readFileSync(join(target, 'references', 'contract.md'), 'utf8'), 'nested evidence');
});

test('cross-tool skill freshness detects changed and unexpected assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-skill-freshness-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(join(source, 'references'), { recursive: true });
  mkdirSync(join(target, 'references'), { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), 'canonical');
  writeFileSync(join(source, 'references', 'contract.md'), 'v1');
  writeFileSync(join(target, 'SKILL.md'), 'canonical');
  writeFileSync(join(target, 'references', 'contract.md'), 'v1');

  assert.deepEqual(compareSkillTrees(source, target), { fresh: true, differences: [] });

  writeFileSync(join(target, 'references', 'contract.md'), 'stale');
  assert.equal(compareSkillTrees(source, target).fresh, false);

  writeFileSync(join(target, 'references', 'contract.md'), 'v1');
  writeFileSync(join(target, 'unexpected.txt'), 'obsolete');
  const unexpected = compareSkillTrees(source, target);
  assert.equal(unexpected.fresh, false);
  assert.match(unexpected.differences.join('\n'), /unexpected\.txt/);
});

test('OpenCode runtime classification is version-aware and fails closed', () => {
  assert.equal(parseOpenCodeRuntimeMajor('opencode 1.18.21'), 'v1');
  assert.equal(parseOpenCodeRuntimeMajor('2.0.4'), 'v2');
  assert.equal(parseOpenCodeRuntimeMajor('2.0.4-beta.1'), 'unsupported');
  assert.equal(parseOpenCodeRuntimeMajor('nightly'), 'unsupported');
  assert.equal(parseOpenCodeRuntimeMajor('3.0.0'), 'unsupported');
});

test('close import validation ignores examples inside template literals', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-import-scan-'));
  const source = join(root, 'source.ts');
  writeFileSync(join(root, 'actual.ts'), 'export const value = true;\n');
  writeFileSync(
    source,
    "const lesson = `import { fake } from './missing-example.js';`;\n" +
      "import { value } from './actual.js';\n",
  );

  assert.deepEqual(findBrokenRelativeImports(source), []);

  writeFileSync(source, readFileSync(source, 'utf8') + "import { missing } from './missing.js';\n");
  const broken = findBrokenRelativeImports(source);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].path, './missing.js');
  assert.equal(broken[0].line, 3);
});

test('close phases use canonical CodeGraph sync and treat neutral feedback as evaluated', () => {
  const source = readFileSync(join(process.cwd(), 'src/session/session-close/phases.ts'), 'utf8');

  assert.match(source, /runScript\('src\/integrations\/codegraph-sync-autostart\.ts'/);
  assert.doesNotMatch(source, /runScript\('src\/codegraph-sync-autostart\.ts'/);
  assert.match(source, /phase: 'outcome-feedback',\s+status: 'PASS'/);
});

test('Engram updater selects the major-version Go module and validates doctor v2', () => {
  assert.equal(
    getEngramInstallModule('1.20.0'),
    'github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0',
  );
  assert.equal(
    getEngramInstallModule('2.0.0'),
    'github.com/Gentleman-Programming/engram/v2/cmd/engram@v2.0.0',
  );
  assert.equal(
    isEngramDoctorHealthy(
      JSON.stringify({
        status: 'ok',
        summary: { total: 9, ok: 9, warnings: 0, blocked: 0, errors: 0 },
      }),
      0,
    ),
    true,
  );
  assert.equal(
    isEngramDoctorHealthy(
      JSON.stringify({
        status: 'warning',
        summary: { total: 9, ok: 8, warnings: 1, blocked: 0, errors: 0 },
      }),
      0,
    ),
    false,
  );
  const source = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'knowledge', 'engram-auto-update.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /^\s*process\.exit\(/m);
});

test('tool audit rejects simulated launchers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-launcher-audit-'));
  const demo = join(dir, 'opencode');
  const real = join(dir, 'opencode.cmd');
  writeFileSync(demo, '#!/bin/bash\necho "Code Review (Demo Mode)"\n');
  writeFileSync(real, '@echo off\r\nopencode-real.exe %*\r\n');

  assert.equal(isUsableLauncherFile(demo), false);
  assert.equal(isUsableLauncherFile(real), true);
});

test('Watchtower self-tests use the direct hidden TypeScript runner', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'core', 'watchtower', 'checks-infra.ts'),
    'utf8',
  );

  assert.match(source, /runNpxTsxSync\('src\/core\/orchestrator-loop-guard\.ts'/);
  assert.match(source, /runNpxTsxSync\(\s*'src\/security\/guardrails\/input-moderation\.ts'/);
  assert.doesNotMatch(source, /runSync\('npx', \['tsx'/);
});

test('academy validation delegates to the canonical multi-course validator', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'ops', 'academy-auto-updater.ts'),
    'utf8',
  );
  assert.match(source, /validate-multi-course\.mjs/);
  assert.doesNotMatch(source, /const requiredTracks = \[/);
});

test('performance gate stays neutral without evidence and fails a measured regression', () => {
  assert.equal(performancePercentile([10, 20, 30, 40], 95), 40);
  const baseline = {
    latency: { samples: 20, avg: 100, p50: 80, p95: 100, p99: 120, byRoute: [] },
    tokens: {
      samples: 20,
      total: 2000,
      averagePerTransaction: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      byAgent: [],
    },
    cache: {
      requests: 20,
      hits: 18,
      misses: 2,
      hitRate: 90,
      responseEntries: 1,
      responseEntryHits: 1,
      expiredEntries: 0,
    },
    quality: { minSamples: 20, latency: 'sufficient', tokens: 'sufficient', cache: 'sufficient' },
    generatedAt: '2026-09-17T00:00:00.000Z',
    source: 'nexus',
    windowDays: 30,
  } satisfies PerformanceBaseline;
  assert.equal(evaluateRegression(baseline, null).status, 'NEUTRAL');
  const current = structuredClone(baseline);
  current.latency.p95 = 125;
  assert.equal(evaluateRegression(current, baseline).status, 'FAIL');
});

test('performance exercise summarizes measured durations without losing precision bounds', () => {
  assert.deepEqual(summarizeDurations([0.8146, 1.5, 6.2638]), {
    minMs: 0.815,
    avgMs: 2.859,
    maxMs: 6.264,
  });
});

test('discovers SKILL.md metadata and gives later canonical roots precedence', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-skill-discovery-'));
  const migrated = join(root, 'migrated', 'research');
  const canonical = join(root, 'canonical', 'research');
  mkdirSync(migrated, { recursive: true });
  mkdirSync(canonical, { recursive: true });
  writeFileSync(
    join(migrated, 'SKILL.md'),
    '---\nname: web-research\ndescription: Migrated description\ntriggers: [crawl]\n---\n',
  );
  writeFileSync(
    join(canonical, 'SKILL.md'),
    '---\nname: web-research\ndescription: Canonical web research capability\nmetadata:\n  trigger: search the web, documentation\n---\n',
  );

  const parsed = parseSkillDocument(readFileSync(join(canonical, 'SKILL.md'), 'utf8'), 'research');
  assert.deepEqual(parsed.triggers, ['search the web', 'documentation']);
  const skills = discoverSkills([join(root, 'migrated'), join(root, 'canonical')], {
    'web-research': 'KNOWLEDGE',
  });
  assert.equal(skills['web-research'].description, 'Canonical web research capability');
  assert.equal(skills['web-research'].agent, 'KNOWLEDGE');
  assert.deepEqual(skills['web-research'].triggers, ['crawl', 'search the web', 'documentation']);
});

test('hybrid skill routing favors explicit capability names and trigger phrases', () => {
  const query = ['research', 'official', 'web', 'sources', 'documentation'];
  assert.equal(lexicalBoost(query, 'web-research', ['search the web']), 0.2);
  assert.equal(lexicalBoost(query, 'documentation-skill', ['documentation']), 0.04);
  assert.equal(lexicalBoost(query, 'unrelated-skill', ['database backup']), 0);
});

test('skill outcomes are recorded only when execution result is explicit', () => {
  assert.equal(parseExplicitOutcome('completed'), true);
  assert.equal(parseExplicitOutcome('FAILED'), false);
  assert.equal(parseExplicitOutcome('used'), null);
  assert.equal(parseExplicitOutcome(null), null);
});

test('skill lifecycle evidence excludes evaluation and maintenance outcomes', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE skill_execution_outcomes (
      tenant_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      duration_ms REAL,
      evidence_kind TEXT NOT NULL
    );
    INSERT INTO skill_execution_outcomes VALUES
      ('gentle-vanguard', 'nexus-database', 1, 10, 'production'),
      ('gentle-vanguard', 'nexus-database', 1, 20, 'evaluation'),
      ('gentle-vanguard', 'nexus-database', 1, 30, 'evaluation'),
      ('gentle-vanguard', 'nexus-database', 1, 40, 'maintenance');
  `);

  const evidence = readSkillOutcomeEvidence(db);
  assert.equal(evidence.production[0].outcomes, 1);
  assert.deepEqual(evidence.counts, { production: 1, evaluation: 2, maintenance: 1 });
  db.close();
});

test('live skill probes require both a zero exit and their evidence pattern', () => {
  assert.deepEqual(evaluateLiveProbe(0, '[db-health] HEALTHY', 'HEALTHY'), {
    passed: true,
    reason: 'exit=0 and evidence matched',
  });
  assert.deepEqual(evaluateLiveProbe(0, 'completed without marker', 'HEALTHY'), {
    passed: false,
    reason: 'expected evidence not found: HEALTHY',
  });
  assert.deepEqual(evaluateLiveProbe(1, 'HEALTHY', 'HEALTHY'), {
    passed: false,
    reason: 'command exited with status 1',
  });
});

test('skill auto-archive requires explicit enablement and no confirmation gate', () => {
  const base = {
    usageAnalysis: {
      minDataPoints: 2,
      staleDays: 30,
      deprecateDays: 60,
      archiveDays: 90,
      lowSuccessThreshold: 0.4,
      highSuccessThreshold: 0.85,
    },
    gapDetection: { enabled: true, minFrequency: 2, maxSuggestions: 8 },
    refinements: { enabled: true, maxSuggestions: 10, minImprovementPotential: 0.2 },
    deprecation: { enabled: true, autoDeprecate: false, requireConfirmation: true },
    outputDir: '.session/evolution',
  };
  assert.equal(canAutoArchive(base), false);
  assert.equal(
    canAutoArchive({
      ...base,
      deprecation: { enabled: true, autoDeprecate: true, requireConfirmation: false },
    }),
    true,
  );
});

test('skill registry parser reads the Skill column without creating header metrics', () => {
  const registry = `| Agent | Skill | Triggers |\n|---|---|---|\n| ops | nexus-database | db |\n| gov | code-review-and-quality | review |`;
  assert.deepEqual(parseSkillRegistry(registry), ['code-review-and-quality', 'nexus-database']);
});
