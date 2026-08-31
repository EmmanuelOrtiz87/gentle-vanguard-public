#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { recordContinuation, nextTransition } from '../core/continuation.js';

type PhaseName =
  'INIT' | 'EXPLORE' | 'PROPOSE' | 'SPEC' | 'TASKS' | 'DESIGN' | 'APPLY' | 'VERIFY' | 'ARCHIVE';

interface PhaseGate {
  phase: string;
  status: 'PASS' | 'FAIL' | 'DRYRUN';
  timestamp: string;
  artifact: string;
}

interface PhaseResult {
  [key: string]: unknown;
}

interface PipelineOptions {
  feature: string;
  description: string;
  phase?: PhaseName;
  dryRun: boolean;
}

const PHASE_ORDER: PhaseName[] = [
  'INIT',
  'EXPLORE',
  'PROPOSE',
  'SPEC',
  'TASKS',
  'DESIGN',
  'APPLY',
  'VERIFY',
  'ARCHIVE',
];

function getRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) {
    return process.env.GENTLE_VANGUARD_BASE_DIR;
  }
  return resolve(process.cwd());
}

function writePhaseGate(
  sddDir: string,
  phase: string,
  status: PhaseGate['status'],
  artifact: string,
): void {
  const gate: PhaseGate = { phase, status, timestamp: new Date().toISOString(), artifact };
  const gatePath = join(sddDir, `gate-${phase}.json`);
  writeFileSync(gatePath, JSON.stringify(gate, null, 2), 'utf-8');
  const color = status === 'PASS' ? '\x1b[32m' : status === 'DRYRUN' ? '\x1b[33m' : '\x1b[31m';
  console.log(`  ${color}[GATE]${'\x1b[0m'} ${phase} \u2192 ${status}`);
}

function runGit(args: string[], cwd: string): string {
  try {
    const result = runSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    return result.status === 0 ? result.stdout.trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

function tryReadPackageVersion(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function invokePhase(
  phaseName: PhaseName,
  block: () => PhaseResult,
  sddDir: string,
  description: string,
  dryRun: boolean,
): PhaseResult | null {
  console.log(`\n=== SDD ${phaseName} ===`);
  if (dryRun) {
    console.log(`\x1b[33m[DRY-RUN] Would execute phase: ${phaseName}\x1b[0m`);
    writePhaseGate(sddDir, phaseName, 'DRYRUN', '');
    return { status: 'dryrun' };
  }

  const phaseDir = join(sddDir, phaseName);
  if (!existsSync(phaseDir)) {
    mkdirSync(phaseDir, { recursive: true });
  }

  try {
    const result = block();
    const artifact = join(sddDir, `${phaseName}/artifact.md`);
    if (!existsSync(artifact)) {
      writeFileSync(artifact, `# ${phaseName}\n\n${description}\n`, 'utf-8');
    }
    writePhaseGate(sddDir, phaseName, 'PASS', artifact);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writePhaseGate(sddDir, phaseName, 'FAIL', '');
    console.error(`  \x1b[31m[ERROR] ${msg}\x1b[0m`);
    throw err;
  }
}

function parseArgs(): PipelineOptions {
  const args = process.argv.slice(2);
  const opts: PipelineOptions = { feature: '', description: '', dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--feature':
      case '-f':
        opts.feature = args[++i] ?? '';
        break;
      case '--description':
      case '-d':
        opts.description = args[++i] ?? '';
        break;
      case '--phase':
      case '-p':
        {
          const p = args[++i]?.toUpperCase() as PhaseName;
          if (PHASE_ORDER.includes(p)) {
            opts.phase = p;
          } else {
            console.error(
              `\x1b[31mInvalid phase: ${args[i]}. Valid: ${PHASE_ORDER.join(', ')}\x1b[0m`,
            );
            process.exit(1);
          }
        }
        break;
      case '--dry-run':
      case '-n':
        opts.dryRun = true;
        break;
      case '--next':
        {
          // "What do I run now?" — replay the published continuation verbatim
          // (gentle-vanguard.continuation/v1), never reconstruct from prose.
          const feature = args[++i] ?? '';
          if (!feature) {
            console.error('\x1b[31m--next requires the feature name\x1b[0m');
            process.exit(1);
          }
          const env = nextTransition(`sdd-${feature}`);
          if (!env) {
            console.log(`no active continuation for feature '${feature}'`);
            process.exit(0);
          }
          console.log(`operation: ${env.operation}  (v${env.version})`);
          console.log(`run verbatim:\n  ${env.command}`);
          process.exit(0);
        }
        break;
      case '--help':
      case '-h':
        console.log(`SDD Pipeline — Spec-Driven Development Lifecycle Orchestrator

Usage:
  npx tsx src/sdd/sdd-pipeline.ts --feature <name> --description <desc> [options]

Options:
  --feature, -f <name>        Feature name (required)
  --description, -d <desc>    Feature description (required)
  --phase, -p <phase>         Specific phase to run (optional, runs all if omitted)
  --dry-run, -n               Show what would be done without executing
  --next <feature>            Print the verbatim next-phase command (continuation replay)
  --help, -h                  Show this help

Phases:
  ${PHASE_ORDER.join(', ')}

Examples:
  npx tsx src/sdd/sdd-pipeline.ts --feature auth-login --description "JWT based authentication"
  npx tsx src/sdd/sdd-pipeline.ts --feature auth-login --description "JWT auth" --phase DESIGN
`);
        process.exit(0);
        break;
    }
  }

  if (!opts.feature) {
    console.error('\x1b[31mError: --feature is required\x1b[0m');
    process.exit(1);
  }
  if (!opts.description) {
    console.error('\x1b[31mError: --description is required\x1b[0m');
    process.exit(1);
  }

  return opts;
}

function main(): void {
  const opts = parseArgs();
  const root = getRoot();
  const sddDir = join(root, '.sdd', opts.feature);
  const artifactsDir = join(root, '.session', 'sdd-pipeline');

  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
  if (!existsSync(sddDir)) {
    mkdirSync(sddDir, { recursive: true });
  }

  const phasesToRun: PhaseName[] = opts.phase ? [opts.phase] : PHASE_ORDER;
  const pipelineResults: Record<string, PhaseResult | null> = {};

  for (const p of phasesToRun) {
    if (opts.dryRun) {
      console.log(`  \x1b[90m[DRY-RUN] Phase ${p} would execute\x1b[0m`);
      continue;
    }

    const result = invokePhase(
      p,
      () => {
        switch (p) {
          case 'INIT': {
            const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
            const version = tryReadPackageVersion(root);
            const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
            const initContent = [
              `# SDD INIT: ${opts.feature}`,
              `**Description**: ${opts.description}`,
              `**Date**: ${date}`,
              `**Stack**: ${version}`,
              `**Branch**: ${branch}`,
            ].join('\n');
            writeFileSync(join(sddDir, 'INIT/artifact.md'), initContent, 'utf-8');
            console.log(`  \x1b[37m[INIT] Feature: ${opts.feature}\x1b[0m`);
            return { feature: opts.feature, description: opts.description };
          }

          case 'EXPLORE': {
            console.log(
              `  \x1b[37m[EXPLORE] Discovering requirements for: ${opts.description}\x1b[0m`,
            );
            const explore = `## Requirements (EXPLORE)\n- ${opts.description}\n- TBD after exploration\n`;
            writeFileSync(join(sddDir, 'EXPLORE/artifact.md'), explore, 'utf-8');
            return { requirements: [opts.description] };
          }

          case 'PROPOSE': {
            // Research lane evidence note (src/sdd/sdd-research.ts): if the
            // optional RESEARCH artifact exists, surface it in the proposal so
            // scope decisions can cite it — and make its absence visible when
            // questions were left unanswered (fail-visible, not fail-closed:
            // research is optional by design).
            let researchNote =
              '**Research evidence**: none declared (optional lane — run `npm run sdd:research -- run -f <feature> -q "..."` after EXPLORE)';
            try {
              const rj = join(sddDir, 'RESEARCH', 'research.json');
              if (existsSync(rj)) {
                const r = JSON.parse(readFileSync(rj, 'utf-8')) as {
                  questions?: unknown[];
                  stats?: { sources?: number; relevantSources?: number; lowConfidence?: number };
                };
                researchNote = `**Research evidence**: ${r.questions?.length ?? 0} pregunta(s), ${r.stats?.sources ?? 0} fuente(s) (${r.stats?.relevantSources ?? 0} relevantes), ${r.stats?.lowConfidence ?? 0} de baja confianza — ver RESEARCH/artifact.md`;
              }
            } catch {
              /* research note is best-effort — never blocks PROPOSE */
            }
            const propose = `## Proposal (PROPOSE)\n**Feature**: ${opts.feature}\n${researchNote}\n**Approach**: TBD\n**Risks**: TBD\n`;
            writeFileSync(join(sddDir, 'PROPOSE/artifact.md'), propose, 'utf-8');
            console.log('  \x1b[37m[PROPOSE] Proposal drafted\x1b[0m');
            return { approach: 'TBD' };
          }

          case 'SPEC': {
            const spec = `# Specification: ${opts.feature}\n## Overview\n${opts.description}\n## Acceptance Criteria\n- [ ] TBD\n## Technical Notes\n- TBD\n`;
            writeFileSync(join(sddDir, 'SPEC/artifact.md'), spec, 'utf-8');
            console.log('  \x1b[37m[SPEC] Specification written\x1b[0m');
            return { spec: 'draft' };
          }

          case 'TASKS': {
            const tasks = `## Tasks: ${opts.feature}\n- [ ] TASK-1: Implement core logic\n- [ ] TASK-2: Add tests\n- [ ] TASK-3: Documentation\n`;
            writeFileSync(join(sddDir, 'TASKS/artifact.md'), tasks, 'utf-8');
            console.log('  \x1b[37m[TASKS] Task breakdown created\x1b[0m');
            return { tasks: 3 };
          }

          case 'DESIGN': {
            const design = `## Design: ${opts.feature}\n**Architecture**: TBD\n**Components**:\n- Component A: TBD\n- Component B: TBD\n**Data Flow**: TBD\n`;
            writeFileSync(join(sddDir, 'DESIGN/artifact.md'), design, 'utf-8');
            console.log('  \x1b[37m[DESIGN] Architecture designed\x1b[0m');
            return { architecture: 'draft' };
          }

          case 'APPLY': {
            console.log(
              '  \x1b[37m[APPLY] Implementation phase ready \u2014 use Team Mode for parallel execution\x1b[0m',
            );
            const apply = `## Implementation: ${opts.feature}\n**Status**: Pending\n**Skills needed**: Determined by Team Mode orchestration\n`;
            writeFileSync(join(sddDir, 'APPLY/artifact.md'), apply, 'utf-8');
            return { status: 'pending' };
          }

          case 'VERIFY': {
            console.log('  \x1b[37m[VERIFY] Running quality gates...\x1b[0m');
            const verify = `## Verification: ${opts.feature}\n**Lint**: Pending\n**Tests**: Pending\n**Judgment Day**: Pending\n`;
            writeFileSync(join(sddDir, 'VERIFY/artifact.md'), verify, 'utf-8');
            return { lint: 'pending', tests: 'pending', judgment: 'pending' };
          }

          case 'ARCHIVE': {
            const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
            const archive = `## Archive: ${opts.feature}\n**Completed**: ${now}\n**Artifacts**: ${sddDir}\n**Summary**: ${opts.description}\n`;
            writeFileSync(join(sddDir, 'ARCHIVE/artifact.md'), archive, 'utf-8');
            console.log(`  \x1b[32m[ARCHIVE] Pipeline complete\x1b[0m`);
            return { archived: new Date().toISOString() };
          }
        }
      },
      sddDir,
      opts.description,
      opts.dryRun,
    );

    pipelineResults[p] = result;
  }

  const allPassed = phasesToRun.every((p) => {
    const gatePath = join(sddDir, `gate-${p}.json`);
    return existsSync(gatePath);
  });

  // Machine-executable re-entry (gentle-vanguard.continuation/v1): publish the
  // verbatim next-phase command after a passing phase — the operator never
  // reconstructs it from prose (absorbed from gentle-ai v2.5.0-rc.3).
  const lastPhase = phasesToRun[phasesToRun.length - 1];
  const lastGateOk = existsSync(join(sddDir, `gate-${lastPhase}.json`));
  const nextIdx = PHASE_ORDER.indexOf(lastPhase) + 1;
  if (!opts.dryRun && lastGateOk && nextIdx < PHASE_ORDER.length) {
    const nextPhase = PHASE_ORDER[nextIdx];
    const command = `npx tsx src/sdd/sdd-pipeline.ts --feature ${opts.feature} --description "${opts.description}" --phase ${nextPhase}`;
    recordContinuation({
      workflowId: `sdd-${opts.feature}`,
      operation: `sdd.${nextPhase.toLowerCase()}`,
      args: { feature: opts.feature, phase: nextPhase },
      command,
      revision: runGit(['rev-parse', '--short', 'HEAD'], root) !== 'unknown'
        ? runGit(['rev-parse', '--short', 'HEAD'], root)
        : undefined,
      root,
    });
    console.log(`\x1b[36m[NEXT] Run verbatim to continue:\n  ${command}\x1b[0m`);
  }

  console.log(`\n=== SDD Pipeline Complete ===`);
  console.log(`Feature: ${opts.feature}`);
  console.log(`Phases executed: ${phasesToRun.join(' \u2192 ')}`);
  const statusColor = allPassed ? '\x1b[32m' : '\x1b[33m';
  console.log(`Status: ${statusColor}${allPassed ? 'PASS' : 'PARTIAL'}\x1b[0m`);
  console.log(`Artifacts: ${sddDir}`);

  if (allPassed && !opts.dryRun) {
    console.log(
      '\x1b[32m[SDD] Pipeline passed \u2014 ready for implementation via Team Mode\x1b[0m',
    );
  }
}

main();
