#!/usr/bin/env node
/**
 * Skill & Agent Evolution Engine — analyzes usage, detects gaps, suggests refinements, deprecates unused.
 *
 * Skills estáticos → Skills evolutivos:
 *   Uso + Resultados → Análisis → Evolución (refinar/deprecar/crear)
 *
 * Flags:
 *   --analyze      Analyze skill usage only
 *   --gaps         Detect skill gaps only
 *   --refine       Suggest refinements only
 *   --deprecate    Suggest deprecations only
 *   --quiet        Minimal output (pipeline mode)
 *   --dry-run      Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

interface EvoArgs {
  mode: 'all' | 'analyze' | 'gaps' | 'refine' | 'deprecate';
  quiet: boolean;
  dryRun: boolean;
  autoArchive: boolean;
}

interface SkillInfo {
  name: string;
  file: string;
  useCount: number;
  successRate: number;
  failureCount: number;
  avgTokens: number;
  lastUsed: string | null;
  lastOutcome: string | null;
  domain: string;
  daysSinceUse: number | null;
}

interface SkillGap {
  domain: string;
  description: string;
  frequency: number;
  evidence: string[];
  suggestedSkillName: string;
  priority: 'low' | 'medium' | 'high';
}

interface SkillRefinement {
  skillName: string;
  currentSuccessRate: number;
  potentialImprovement: number;
  suggestion: string;
  reason: string;
  effort: 'low' | 'medium' | 'high';
}

interface DeprecationCandidate {
  skillName: string;
  useCount: number;
  daysSinceUse: number;
  successRate: number;
  reason: string;
  suggestedAction: 'review' | 'deprecate' | 'archive';
  priority: 'low' | 'medium' | 'high';
}

interface EvoOutput {
  timestamp: string;
  totalSkills: number;
  activeSkills: SkillInfo[];
  gaps: SkillGap[];
  refinements: SkillRefinement[];
  deprecations: DeprecationCandidate[];
  summary: {
    totalSkills: number;
    activeSkills: number;
    staleSkills: number;
    gapsFound: number;
    refinementsSuggested: number;
    deprecationsSuggested: number;
    overallHealth: 'excellent' | 'good' | 'fair' | 'poor';
  };
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const SKILL_USAGE_DIR = join(SESSION_DIR, 'skill-usage');
const AUDIT_DIR = join(SESSION_DIR, 'audit', 'logs');
const EVO_DIR = join(SESSION_DIR, 'evolution');
const EVO_CONFIG = join(ROOT, 'config', 'skill-evolution-engine.json');
const ROUTER_SRC = join(ROOT, 'src', 'skill-router.ts');

const DEFAULT_CONFIG = {
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
  outputDir: EVO_DIR,
};

// ─── Helpers ──────────────────────────────────────────────────────────

type LogFn = (msg: string) => void;

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
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getLogger(quiet: boolean): LogFn {
  return (msg: string) => {
    if (!quiet) console.log(msg);
  };
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function now(): string {
  return new Date().toISOString();
}

// ─── Data Collection ──────────────────────────────────────────────────

function loadSkillMetrics(log: LogFn): SkillInfo[] {
  if (!existsSync(SKILL_USAGE_DIR)) {
    log('  Skill usage dir not found');
    return [];
  }

  const files = readdirSync(SKILL_USAGE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const skills: SkillInfo[] = [];
  const now_ = Date.now();

  for (const f of files) {
    try {
      const data = loadJson<Record<string, unknown>>(join(SKILL_USAGE_DIR, f), {});
      if (!data || Object.keys(data).length === 0) continue;

      const name = (data.skillName as string) || f.replace(/\.json$/, '');
      const useCount = (data.useCount as number) || (data.totalCalls as number) || 0;
      const failCount = (data.failureCount as number) || 0;
      const successRate =
        (data.successRate as number) ?? (useCount > 0 ? (useCount - failCount) / useCount : 1);
      const lastUsed = (data.lastUsedAt as string) || (data.lastUsed as string) || null;
      const lastOutcome = (data.lastOutcome as string) || null;
      const avgTokens = (data.avgTokensUsed as number) || 0;

      const daysSinceUse = lastUsed
        ? Math.round((now_ - new Date(lastUsed).getTime()) / 86400000)
        : null;

      // Infer domain from skill name
      const domain = inferDomain(name);

      skills.push({
        name,
        file: f,
        useCount,
        successRate: typeof successRate === 'number' ? successRate : 1,
        failureCount: failCount,
        avgTokens,
        lastUsed,
        lastOutcome,
        domain,
        daysSinceUse,
      });
    } catch {
      /* skip corrupt files */
    }
  }

  skills.sort((a, b) => b.useCount - a.useCount);
  log(`  Skill metrics loaded: ${skills.length}`);
  return skills;
}

function inferDomain(skillName: string): string {
  const n = skillName.toLowerCase();
  if (n.includes('angular') || n.includes('react') || n.includes('vue') || n.includes('svelte'))
    return 'frontend';
  if (n.includes('api') || n.includes('backend') || n.includes('server') || n.includes('node'))
    return 'backend';
  if (n.includes('test') || n.includes('qa') || n.includes('quality')) return 'testing';
  if (n.includes('security') || n.includes('audit') || n.includes('vulner')) return 'security';
  if (n.includes('deploy') || n.includes('docker') || n.includes('ci') || n.includes('pipeline'))
    return 'devops';
  if (n.includes('data') || n.includes('ml') || n.includes('ai') || n.includes('train'))
    return 'data-ml';
  if (n.includes('doc') || n.includes('adr') || n.includes('readme')) return 'documentation';
  if (n.includes('architect') || n.includes('design') || n.includes('pattern'))
    return 'architecture';
  if (n.includes('skill') || n.includes('agent') || n.includes('orchestr') || n.includes('router'))
    return 'orchestration';
  if (n.includes('session') || n.includes('memory') || n.includes('engram')) return 'memory';
  return 'general';
}

function getRouterSkills(): string[] {
  if (!existsSync(ROUTER_SRC)) return [];
  const content = readFileSync(ROUTER_SRC, 'utf-8');
  const skills = new Set<string>();
  const re = /['"]([a-z][a-z0-9_-]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const s = m[1];
    if (
      s.length > 2 &&
      !['query', 'project', 'status', 'routed', 'skills', 'querylower'].includes(s)
    ) {
      skills.add(s);
    }
  }
  return [...skills];
}

function collectRecentTasks(log: LogFn): string[] {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 5);
  const tasks: string[] = [];

  for (const f of files) {
    const entries = loadJsonLines(join(AUDIT_DIR, f));
    for (const e of entries) {
      const msg = (e.message as string) || '';
      const type = (e.type as string) || '';
      if (msg) tasks.push(msg);
      if (type) tasks.push(type);
    }
  }

  log(`  Recent tasks: ${tasks.length}`);
  return tasks;
}

// ─── Usage Analysis ──────────────────────────────────────────────────

function analyzeSkillUsage(
  skills: SkillInfo[],
  config: typeof DEFAULT_CONFIG,
): { active: SkillInfo[]; stale: SkillInfo[] } {
  const ua = config.usageAnalysis;
  const active: SkillInfo[] = [];
  const stale: SkillInfo[] = [];

  for (const s of skills) {
    if (
      s.useCount >= ua.minDataPoints &&
      (s.daysSinceUse === null || s.daysSinceUse <= ua.staleDays)
    ) {
      active.push(s);
    } else {
      stale.push(s);
    }
  }

  // Sort active by frequency desc, stale by days since use desc
  active.sort((a, b) => b.useCount - a.useCount);
  stale.sort((a, b) => (b.daysSinceUse || 999) - (a.daysSinceUse || 999));

  return { active, stale };
}

// ─── Gap Detection ────────────────────────────────────────────────────

function detectSkillGaps(
  skills: SkillInfo[],
  routerSkills: string[],
  _tasks: string[],
  config: typeof DEFAULT_CONFIG,
): SkillGap[] {
  if (!config.gapDetection.enabled) return [];
  const gaps: SkillGap[] = [];
  const existingSkills = new Set(skills.map((s) => s.name.toLowerCase()));

  // Gap 1: Router skills not in usage tracker
  const untrackedRouterSkills = routerSkills.filter((s) => {
    const baseName = s.replace(/-skill$/, '').toLowerCase();
    return !existingSkills.has(s.toLowerCase()) && !existingSkills.has(baseName);
  });

  if (untrackedRouterSkills.length > 0) {
    gaps.push({
      domain: 'routing',
      description: `${untrackedRouterSkills.length} skill(s) defined in skill-router but missing from usage tracker — may need initialization`,
      frequency: untrackedRouterSkills.length,
      evidence: untrackedRouterSkills.slice(0, 5),
      suggestedSkillName: 'Run skill-usage-tracker to initialize missing entries',
      priority: untrackedRouterSkills.length > 10 ? 'high' : 'medium',
    });
  }

  // Gap 2: Low-usage skills in router
  const lowUsageRouterSkills = skills.filter(
    (s) =>
      routerSkills.some((rs) => s.name.toLowerCase().includes(rs)) &&
      s.useCount < config.gapDetection.minFrequency,
  );
  if (lowUsageRouterSkills.length > 0) {
    gaps.push({
      domain: 'routing-utilization',
      description: `${lowUsageRouterSkills.length} router skill(s) with < ${config.gapDetection.minFrequency} uses — may be too niche or misconfigured`,
      frequency: lowUsageRouterSkills.length,
      evidence: lowUsageRouterSkills.slice(0, 5).map((s) => `${s.name} (${s.useCount}x)`),
      suggestedSkillName: 'Review and consolidate niche skills',
      priority: lowUsageRouterSkills.length > 5 ? 'medium' : 'low',
    });
  }

  // Gap 3: Domains with no skill coverage
  const coveredDomains = new Set(skills.map((s) => s.domain));
  const commonDomains = [
    'frontend',
    'backend',
    'testing',
    'security',
    'devops',
    'data-ml',
    'documentation',
    'architecture',
  ];
  const missingDomains = commonDomains.filter((d) => !coveredDomains.has(d));
  if (missingDomains.length > 0) {
    gaps.push({
      domain: 'domain-coverage',
      description: `No skills found for domain(s): ${missingDomains.join(', ')}`,
      frequency: missingDomains.length,
      evidence: missingDomains.map((d) => `Missing: ${d}`),
      suggestedSkillName: `Create skills for ${missingDomains[0]}`,
      priority: 'medium',
    });
  }

  return gaps
    .sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
    })
    .slice(0, config.gapDetection.maxSuggestions);
}

// ─── Refinement Suggestions ────────────────────────────────────────────

function suggestRefinements(skills: SkillInfo[], config: typeof DEFAULT_CONFIG): SkillRefinement[] {
  if (!config.refinements.enabled) return [];
  const refinements: SkillRefinement[] = [];
  const threshold = config.refinements.minImprovementPotential;

  // Refinement 1: Skills with low success rate
  const lowSuccess = skills.filter(
    (s) =>
      s.useCount >= config.usageAnalysis.minDataPoints &&
      s.successRate < config.usageAnalysis.lowSuccessThreshold,
  );

  for (const s of lowSuccess) {
    const improvement = 1 - s.successRate;
    if (improvement >= threshold) {
      refinements.push({
        skillName: s.name,
        currentSuccessRate: s.successRate,
        potentialImprovement: improvement,
        suggestion: `Review and refine prompts for "${s.name}" — success rate is ${(s.successRate * 100).toFixed(0)}%`,
        reason: `${s.failureCount} failure(s) in ${s.useCount} attempt(s). Consider updating prompts, edge cases, or error handling.`,
        effort: s.failureCount > 5 ? 'high' : 'medium',
      });
    }
  }

  // Refinement 2: Skills with high token consumption
  const highTokens = skills.filter(
    (s) => s.avgTokens > 5000 && s.useCount >= config.usageAnalysis.minDataPoints,
  );
  for (const s of highTokens.slice(0, 3)) {
    refinements.push({
      skillName: s.name,
      currentSuccessRate: s.successRate,
      potentialImprovement: 0.3,
      suggestion: `Optimize prompt length for "${s.name}" — avg ${s.avgTokens} tokens/use`,
      reason: `High token consumption (${s.avgTokens} avg) may indicate verbose prompts. Consider compressing context and examples.`,
      effort: 'medium',
    });
  }

  // Refinement 3: Stale skills with good history — still useful
  const staleButGood = skills.filter(
    (s) =>
      s.daysSinceUse !== null &&
      s.daysSinceUse > config.usageAnalysis.staleDays &&
      s.daysSinceUse <= config.usageAnalysis.deprecateDays &&
      s.successRate >= config.usageAnalysis.highSuccessThreshold,
  );
  for (const s of staleButGood.slice(0, 3)) {
    refinements.push({
      skillName: s.name,
      currentSuccessRate: s.successRate,
      potentialImprovement: 0.15,
      suggestion: `Re-promote "${s.name}" — high success rate (${(s.successRate * 100).toFixed(0)}%) but unused for ${s.daysSinceUse} days`,
      reason: `Skill was effective when used. Consider adding it to auto-delegation rules or refreshing triggers.`,
      effort: 'low',
    });
  }

  return refinements
    .sort((a, b) => b.potentialImprovement - a.potentialImprovement)
    .slice(0, config.refinements.maxSuggestions);
}

// ─── Deprecation Detection ─────────────────────────────────────────────

function detectDeprecations(
  skills: SkillInfo[],
  config: typeof DEFAULT_CONFIG,
): DeprecationCandidate[] {
  if (!config.deprecation.enabled) return [];
  const candidates: DeprecationCandidate[] = [];
  const ua = config.usageAnalysis;

  for (const s of skills) {
    if (s.daysSinceUse === null || s.useCount === 0) {
      // Never used or no usage data
      if (s.useCount === 0) {
        candidates.push({
          skillName: s.name,
          useCount: 0,
          daysSinceUse: 0,
          successRate: s.successRate,
          reason: 'Skill exists but has never been invoked',
          suggestedAction: 'review',
          priority: 'low',
        });
      }
      continue;
    }

    if (s.daysSinceUse > ua.archiveDays) {
      candidates.push({
        skillName: s.name,
        useCount: s.useCount,
        daysSinceUse: s.daysSinceUse,
        successRate: s.successRate,
        reason: `Not used in ${s.daysSinceUse} days (> ${ua.archiveDays} day archive threshold)`,
        suggestedAction: 'archive',
        priority: 'low',
      });
    } else if (s.daysSinceUse > ua.deprecateDays) {
      candidates.push({
        skillName: s.name,
        useCount: s.useCount,
        daysSinceUse: s.daysSinceUse,
        successRate: s.successRate,
        reason: `Not used in ${s.daysSinceUse} days (> ${ua.deprecateDays} day deprecate threshold)`,
        suggestedAction: 'deprecate',
        priority: 'medium',
      });
    } else if (s.daysSinceUse > ua.staleDays) {
      candidates.push({
        skillName: s.name,
        useCount: s.useCount,
        daysSinceUse: s.daysSinceUse,
        successRate: s.successRate,
        reason: `Not used in ${s.daysSinceUse} days (> ${ua.staleDays} day stale threshold) — consider review`,
        suggestedAction: 'review',
        priority: 'low',
      });
    }
  }

  return candidates.sort((a, b) => {
    const order: Record<string, number> = { archive: 0, deprecate: 1, review: 2 };
    return (order[a.suggestedAction] ?? 9) - (order[b.suggestedAction] ?? 9);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): EvoArgs {
  const args: EvoArgs = { mode: 'all', quiet: false, dryRun: false, autoArchive: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--analyze') args.mode = 'analyze';
    else if (arg === '--gaps') args.mode = 'gaps';
    else if (arg === '--refine') args.mode = 'refine';
    else if (arg === '--deprecate') args.mode = 'deprecate';
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--auto-archive') args.autoArchive = true;
  }
  return args;
}

// ─── Auto-Archive Integration ─────────────────────────────────────────

function autoArchiveDeprecations(deprecations: DeprecationCandidate[]): number {
  const archives = deprecations.filter((d) => d.suggestedAction === 'archive');
  if (archives.length === 0) return 0;

  const triggerDir = join(ROOT, '.session', 'auto-apply');
  if (!existsSync(triggerDir)) mkdirSync(triggerDir, { recursive: true });

  let archived = 0;
  for (const dep of archives) {
    const triggerFile = join(triggerDir, `trigger-archive-${dep.skillName}.json`);
    writeFileSync(
      triggerFile,
      JSON.stringify(
        {
          source: 'skill-evolution-engine',
          type: 'deprecation',
          skillName: dep.skillName,
          daysSinceUse: dep.daysSinceUse,
          reason: dep.reason,
          confidence: dep.daysSinceUse > 60 ? 0.95 : 0.85,
          timestamp: now(),
          autoApply: true,
        },
        null,
        2,
      ),
      'utf-8',
    );
    archived++;
  }
  return archived;
}

function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[SKILL-EVOLUTION-ENGINE] Starting...');

  const config = loadJson<typeof DEFAULT_CONFIG>(EVO_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 1. Collect data
  log('Collecting skill data...');
  const allSkills = loadSkillMetrics(log);
  const routerSkills = getRouterSkills();
  log(`  Router skills: ${routerSkills.length}`);
  const tasks = collectRecentTasks(log);

  // 2. Analyze usage
  let activeSkills: SkillInfo[] = [];
  let staleSkills: SkillInfo[] = [];
  if (args.mode === 'all' || args.mode === 'analyze') {
    log('Analyzing skill usage...');
    const analysis = analyzeSkillUsage(allSkills, config);
    activeSkills = analysis.active;
    staleSkills = analysis.stale;
    log(`  Active: ${activeSkills.length}, Stale: ${staleSkills.length}`);
    for (const s of activeSkills.slice(0, 5)) {
      log(`    [ACTIVE] ${s.name}: ${s.useCount}x, ${(s.successRate * 100).toFixed(0)}% success`);
    }
    for (const s of staleSkills.slice(0, 3)) {
      log(
        `    [STALE] ${s.name}: ${s.useCount}x, ${s.daysSinceUse !== null ? `${s.daysSinceUse}d since use` : 'never used'}`,
      );
    }
  }

  // 3. Detect gaps
  let gaps: SkillGap[] = [];
  if (args.mode === 'all' || args.mode === 'gaps') {
    log('Detecting skill gaps...');
    gaps = detectSkillGaps(allSkills, routerSkills, tasks, config);
    log(`  Gaps: ${gaps.length}`);
    for (const g of gaps) {
      log(`    [${g.priority}] ${g.domain}: ${g.description}`);
    }
  }

  // 4. Suggest refinements
  let refinements: SkillRefinement[] = [];
  if (args.mode === 'all' || args.mode === 'refine') {
    log('Suggesting refinements...');
    refinements = suggestRefinements(allSkills, config);
    log(`  Refinements: ${refinements.length}`);
    for (const r of refinements.slice(0, 3)) {
      log(
        `    ${r.skillName}: +${(r.potentialImprovement * 100).toFixed(0)}% potential (${r.effort} effort)`,
      );
    }
  }

  // 5. Detect deprecations
  let deprecations: DeprecationCandidate[] = [];
  if (args.mode === 'all' || args.mode === 'deprecate') {
    log('Detecting deprecations...');
    deprecations = detectDeprecations(allSkills, config);
    log(`  Deprecations: ${deprecations.length}`);
    for (const d of deprecations.slice(0, 3)) {
      log(`    [${d.suggestedAction}] ${d.skillName}: ${d.reason}`);
    }
  }

  // 6. Compute health
  const staleCount = staleSkills.length;
  const total = allSkills.length;
  let health: 'excellent' | 'good' | 'fair' | 'poor';
  const staleRatio = total > 0 ? staleCount / total : 0;
  if (staleRatio < 0.1 && deprecations.length < 5) health = 'excellent';
  else if (staleRatio < 0.25 && deprecations.length < 10) health = 'good';
  else if (staleRatio < 0.4) health = 'fair';
  else health = 'poor';

  // 6.5 Auto-archive if enabled
  let archivedCount = 0;
  if (args.autoArchive && deprecations.length > 0) {
    archivedCount = autoArchiveDeprecations(deprecations);
    log(`  Auto-archive triggered for ${archivedCount} skills`);
  }

  // 7. Output
  const output: EvoOutput = {
    timestamp: now(),
    totalSkills: total,
    activeSkills: activeSkills.slice(0, 50),
    gaps,
    refinements,
    deprecations,
    summary: {
      totalSkills: total,
      activeSkills: activeSkills.length,
      staleSkills: staleSkills.length,
      gapsFound: gaps.length,
      refinementsSuggested: refinements.length,
      deprecationsSuggested: deprecations.length,
      overallHealth: health,
    },
  };

  if (!args.dryRun) {
    const outFile = join(outputDir, `evolution-${now().slice(0, 10)}.json`);
    writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
    log(`[OK] Evolution report saved: ${outFile}`);
  }

  if (!args.quiet) {
    console.log(
      JSON.stringify({
        total: output.summary.totalSkills,
        active: output.summary.activeSkills,
        stale: output.summary.staleSkills,
        gaps: output.summary.gapsFound,
        refinements: output.summary.refinementsSuggested,
        deprecations: output.summary.deprecationsSuggested,
        health: output.summary.overallHealth,
      }),
    );
  }

  log('[SKILL-EVOLUTION-ENGINE] Done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
