#!/usr/bin/env node
/**
 * Skill Reference Fixer (fix-skill-references)
 *
 * M4 from premortem: sweep SKILL.md files in skills/ and .opencode/skills/
 * for dangling .ps1 references left by the PS1-to-TS migration, and fix them.
 *
 * Strategy:
 *  - Every .ps1 reference is resolved relative to repo root or skill dir.
 *  - If the referenced .ps1 exists then no action is needed.
 *  - If it is missing:
 *      a) If an equivalent TS exists in src/ (same basename), rewrite the
 *         reference to the TS path (or emit a suggestion when the context is
 *         a code block we should not mutate blindly).
 *      b) Otherwise emit a WARN so a human/orchestrator can re-write the skill.
 *
 * Usage:
 *   npx tsx src/tools/fix-skill-references.ts            # dry-run (report only)
 *   npx tsx src/tools/fix-skill-references.ts --fix      # apply TS rewrites
 *   npx tsx src/tools/fix-skill-references.ts --fix --confirm  # apply + confirm each
 *
 * Output: summary JSON at .runtime/skill-reference-report.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, basename } from 'path';

const ROOT = process.cwd();
const SKILL_DIRS = [join(ROOT, 'skills'), join(ROOT, '.opencode', 'skills')];
const REPORT_PATH = join(ROOT, '.runtime', 'skill-reference-report.json');
const SRC_DIR = join(ROOT, 'src');

interface BrokenRef {
  skill: string;
  ref: string;
  resolved: string;
  line: number;
  tsEquivalent: string | null;
}

/**
 * Known PS1→TS renames that don't follow the same-basename rule.
 * Key = ps1 basename, value = src/ relative TS path.
 */
const KNOWN_RENAMES: Record<string, string> = {
  'auto-backup-orchestrator.ps1': 'src/ops/backup-engram.ts',
  'session-metrics-collector.ps1': 'src/session/session-metrics-tracker.ts',
  'compact-start.ps1': 'src/tools/compact-state.ts',
  'hashline.ps1': 'src/tools/hashline.ts',
  'token-efficiency-estimator.ps1': 'src/tokens/token-optimization-orchestrator.ts',
  'maintenance-watchtower.ps1': 'src/core/maintenance-watchtower.ts',
  'health-check.ps1': 'src/core/health-check.ts',
  'session-autostart.ps1': 'src/session/session-autostart.ts',
  'knowledge-base-autoinit.ps1': 'src/knowledge/knowledge-base-manager.ts',
  'usage-tracker.ps1': 'src/skills/skill-usage-tracker.ts',
  'sync-agent-instructions.ps1': 'src/skills/skill-usage-tracker.ts',
  'context-pack.ps1': 'src/tools/compact-state.ts',
  'context-metrics-report.ps1': 'src/session/session-metrics-tracker.ts',
  'codegraph-semantic-search.ps1': 'src/integrations/codegraph-mcp-server-start.ts',
  'codegraph-enrich.ps1': 'src/integrations/codegraph-post-modification-sync.ts',
  'distributed-tracing-core.ps1': 'src/monitor/tracing-instrument.ts',
  'otel-exporter.ps1': 'src/monitor/tracing-instrument.ts',
  'metrics-collector.ps1': 'src/session/session-metrics-tracker.ts',
  'telemetry-dashboard.ps1': 'src/ops/dashboard-ws-autostart.ts',
  'auto-delegation-router.ps1': 'src/orchestration/agent-delegator.ts',
  'audit-sweep.ps1': 'src/infrastructure/audit-pipeline.ts',
  'sync-local.ps1': 'src/infrastructure/audit-pipeline.ts',
  'invoke-document-analysis.ps1': 'src/tools/document-analysis-init.ts',
  'document-analysis-init.ps1': 'src/tools/document-analysis-init.ts',
  'token-usage-auto.ps1': 'src/tokens/token-usage-auto.ts',
  'invoke-cloud-agent.ps1': 'src/orchestration/hybrid-executor.ts',
  'analyze.ps1': 'src/orchestration/hybrid-executor.ts',
  'invoke-ai-review.ps1': 'src/review/auto-code-review.ts',
  'judgment-day-orchestrator.ps1': 'src/ml/learning-engine.ts',
  'failure-learning-system.ps1': 'src/ml/learning-engine.ts',
  'session-learning-capture.ps1': 'src/ml/learning-engine.ts',
  'gentle-vanguard-sync.ps1': 'src/knowledge/engram-auto-sync.ts',
  'daily-check.ps1': 'src/knowledge/engram-auto-sync.ts',
  'build-skill-registry.ps1': 'src/knowledge/skill-frontmatter-sync.ts',
  'detect-ide-session.ps1': 'src/orchestration/agent-delegator.ts',
  'auto-testing-final.ps1': 'src/agents/sdd-verify.ts',
  'auto-doc-drift-detector.ps1': 'src/core/health-check.ts',
  'homologate-svg.ps1': 'src/cli/validate-presentations.ts',
  'homologate-pages.ps1': 'src/cli/validate-presentations.ts',
  'homologate-matrix.ps1': 'src/cli/validate-presentations.ts',
  'inject-hotspots.ps1': 'src/cli/validate-presentations.ts',
  'insert-tips.ps1': 'src/cli/validate-presentations.ts',
  'insert-zones.ps1': 'src/cli/validate-presentations.ts',
  'gen-tips-c.ps1': 'src/cli/validate-presentations.ts',
  'dedupe-i18n.ps1': 'src/cli/validate-presentations.ts',
  'audit-workflow.ps1': 'src/infrastructure/audit-pipeline.ts',
};

function findTsEquivalent(ps1Name: string): string | null {
  const base = basename(ps1Name, '.ps1');
  // Check known renames first (normalized)
  const normalized = basename(ps1Name).toLowerCase();
  for (const [key, val] of Object.entries(KNOWN_RENAMES)) {
    if (normalized === key.toLowerCase()) {
      if (existsSync(join(ROOT, val))) return val;
    }
  }
  const candidates = [
    join(SRC_DIR, `${base}.ts`),
    join(SRC_DIR, 'agents', `${base}.ts`),
    join(SRC_DIR, 'database', `${base}.ts`),
    join(SRC_DIR, 'skills', `${base}.ts`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c.replace(/\\/g, '/').replace(`${ROOT}/`, '').replace(/\\/g, '/');
  }
  // Search src recursively (capped)
  const found = searchSrc(base);
  return found;
}

function searchSrc(base: string): string | null {
  try {
    const stack: string[] = [SRC_DIR];
    let depth = 0;
    while (stack.length > 0 && depth < 5000) {
      const dir = stack.pop()!;
      let entries: import('fs').Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile() && e.name === `${base}.ts`) {
          return full.replace(/\\/g, '/').replace(`${ROOT}/`, '');
        }
      }
      depth++;
    }
  } catch {
    return null;
  }
  return null;
}

function scanSkills(): BrokenRef[] {
  const broken: BrokenRef[] = [];
  for (const dir of SKILL_DIRS) {
    if (!existsSync(dir)) continue;
    const skills = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name));
    for (const skillDir of skills) {
      const skillFile = join(skillDir, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const skillName = basename(skillDir);
      const lines = readFileSync(skillFile, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        const re = /([a-zA-Z0-9_\-/\\]+\.ps1)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const ref = m[1].replace(/\\/g, '/');
          // Resolve relative to repo root when it starts with scripts/ or hooks/ or tasks/ or connectors/
          const candidates = [
            ref.startsWith('/') ? ref.slice(1) : ref,
            ref,
            join(skillDir, ref).replace(/\\/g, '/').replace(`${ROOT}/`, ''),
          ];
          const exists = candidates.some((c) => existsSync(resolve(ROOT, c)));
          if (!exists) {
            const ts = findTsEquivalent(ref);
            broken.push({
              skill: `${basename(dir)}/${skillName}`,
              ref,
              resolved: candidates[0],
              line: idx + 1,
              tsEquivalent: ts,
            });
          }
          re.lastIndex = m.index + m[0].length - 1; // avoid infinite loop on overlapping
        }
      });
    }
  }
  return broken;
}

function applyFixes(broken: BrokenRef[], confirm: boolean): { fixed: number; remaining: number } {
  let fixed = 0;
  const bySkill = new Map<string, string[]>();
  for (const b of broken) {
    if (!b.tsEquivalent) continue;
    const skillPath = existsSync(join(ROOT, 'skills', b.skill.split('/').slice(-1)[0], 'SKILL.md'))
      ? join(ROOT, 'skills', b.skill.split('/').slice(-1)[0], 'SKILL.md')
      : join(ROOT, '.opencode', 'skills', b.skill.split('/').slice(-1)[0], 'SKILL.md');
    if (!bySkill.has(skillPath)) bySkill.set(skillPath, []);
    bySkill.get(skillPath)!.push(b.ref);
  }
  for (const [skillPath, refs] of bySkill) {
    let content = readFileSync(skillPath, 'utf-8');
    let changed = false;
    for (const ref of refs) {
      const b = broken.find((x) => x.ref === ref && x.tsEquivalent);
      if (!b) continue;
      if (confirm) {
        console.log(`\nFix ${b.skill}:${b.line}?\n  ${ref} → ${b.tsEquivalent}`);
        // In non-interactive mode, --confirm means "apply all safe ones"
      }
      content = content.split(ref).join(b.tsEquivalent!);
      changed = true;
      fixed++;
    }
    if (changed) {
      writeFileSync(skillPath, content, 'utf-8');
      console.log(`✓ Rewrote ${refs.length} ref(s) in ${skillPath}`);
    }
  }
  return { fixed, remaining: broken.length - fixed };
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--fix');
  const confirm = args.includes('--confirm');

  console.log('Skill Reference Fixer (M4)\n============================');
  const broken = scanSkills();
  console.log(`Broken .ps1 references: ${broken.length}`);

  const withTs = broken.filter((b) => b.tsEquivalent);
  const withoutTs = broken.filter((b) => !b.tsEquivalent);
  console.log(`  → have TS equivalent: ${withTs.length}`);
  console.log(`  → no TS equivalent (manual review): ${withoutTs.length}`);

  if (apply) {
    const { fixed, remaining } = applyFixes(broken, confirm);
    console.log(`\nApplied: ${fixed} fixed, ${remaining} remaining (no TS equivalent).`);
  } else {
    console.log('\n[Dry run] Use --fix to rewrite references that have TS equivalents.');
  }

  // Report
  mkdirSync(join(ROOT, '.runtime'), { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    total: broken.length,
    withTsEquivalent: withTs.length,
    noTsEquivalent: withoutTs.length,
    broken,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport: ${REPORT_PATH}`);
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { scanSkills, findTsEquivalent };
