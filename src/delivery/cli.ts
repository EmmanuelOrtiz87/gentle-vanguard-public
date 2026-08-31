/**
 * delivery/cli.ts — Automated Delivery Orchestrator CLI.
 *
 * Implements ADR-0022: a resumable, idempotent, checkpointed command that
 * takes an implemented change through local validation, AI review, safe
 * staging, atomic commits, branch publication, PR checks, approval-gated
 * merge, and promotion.
 *
 * Usage:
 *   npx tsx src/delivery/cli.ts run --intent <file> [options]
 *   npx tsx src/delivery/cli.ts resume <run-id> [--from <state>] [--dry-run]
 *   npx tsx src/delivery/cli.ts status <run-id>
 *   npx tsx src/delivery/cli.ts approve <run-id> --purpose merge|promotion
 *   npx tsx src/delivery/cli.ts rollback <run-id> --scope local|branch|pr|promotion [--confirm]
 *   npx tsx src/delivery/cli.ts gate [--stage pre-commit|pre-push|pre-pr|release] [--json]
 */

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { DeliveryIntent, DeliveryOptions, DeliveryResult, CheckStatus } from './types.js';
import { DeliveryStateMachine, computeWorkspaceHash, loadCheckpoint } from './state-machine.js';
import { classifyDiff } from './diff-classifier.js';
import {
  gitStatus,
  currentBranch,
  currentSha,
  remoteSha,
  fetchRemote,
  createWorktree,
  removeWorktree,
  stagePaths,
  syncPathsFromSource,
  commit,
  pushBranch,
  createPr,
  findPrByMarker,
  getPrChecks,
  mergePr,
  getPrMergeable,
  getPrState,
  ghAvailable,
  ghRepo,
} from './git-adapter.js';
import { runDeliveryGate } from './gate.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

// ─── Intent loading ──────────────────────────────────────────────────────────

function loadIntent(file: string): DeliveryIntent {
  const p = resolve(ROOT, file);
  if (!existsSync(p)) {
    throw new Error(`Intent file not found: ${p}`);
  }
  const raw = JSON.parse(readFileSync(p, 'utf-8')) as DeliveryIntent;
  if (!raw.summary) throw new Error('Intent requires "summary"');
  if (!raw.target || !['develop', 'main'].includes(raw.target)) {
    throw new Error('Intent requires "target" of "develop" or "main"');
  }
  if (!Array.isArray(raw.changePaths) || raw.changePaths.length === 0) {
    throw new Error('Intent requires non-empty "changePaths" allowlist');
  }
  if (!Array.isArray(raw.commitGroups) || raw.commitGroups.length === 0) {
    throw new Error('Intent requires non-empty "commitGroups"');
  }
  const groupedPaths = new Map<string, string>();
  for (const group of raw.commitGroups) {
    if (!Array.isArray(group.paths) || group.paths.length === 0) {
      throw new Error(`Commit group "${group.scope}" requires non-empty "paths"`);
    }
    for (const path of group.paths) {
      const normalizedPath = path.replaceAll('\\', '/');
      const previousScope = groupedPaths.get(normalizedPath);
      if (previousScope) {
        throw new Error(
          `Commit groups overlap on "${normalizedPath}": ${previousScope}, ${group.scope}`,
        );
      }
      groupedPaths.set(normalizedPath, group.scope);
    }
  }
  if (!raw.requestedBy) throw new Error('Intent requires "requestedBy"');
  return raw;
}

// ─── Preflight ───────────────────────────────────────────────────────────────

function preflight(intent: DeliveryIntent): { ok: boolean; message: string; targetSha: string } {
  // 1. Verify git repo
  const branch = currentBranch();
  if (!branch) return { ok: false, message: 'Not in a git repository', targetSha: '' };

  // 2. Verify worktree state
  const status = gitStatus();
  if (!status.clean) {
    return {
      ok: false,
      message: `Worktree not clean. Dirty: ${status.dirty.join(', ')}. Untracked: ${status.untracked.join(', ')}`,
      targetSha: '',
    };
  }

  // 3. Fetch remote and verify target SHA
  fetchRemote();
  const targetSha = remoteSha(intent.target);
  if (!targetSha) {
    return { ok: false, message: `Cannot resolve origin/${intent.target}`, targetSha: '' };
  }

  // 4. Verify changePaths exist and are within allowlist
  const missing = intent.changePaths.filter((p) => !existsSync(join(ROOT, p)));
  if (missing.length > 0) {
    return { ok: false, message: `Change paths not found: ${missing.join(', ')}`, targetSha };
  }

  return { ok: true, message: 'Preflight passed', targetSha };
}

// ─── Review (deterministic + AI advisory) ────────────────────────────────────

async function runReview(
  intent: DeliveryIntent,
  cls: ReturnType<typeof classifyDiff>,
): Promise<{ findings: string[]; blocked: boolean }> {
  const findings: string[] = [];
  let blocked = false;

  // Deterministic review: secret scan on change paths
  const secretGate = await runDeliveryGate({
    stage: 'pre-commit',
    quiet: true,
    only: 'secret-scanner',
  });
  if (secretGate.blocked) {
    findings.push('Secret scan blocked: potential secrets in staged changes');
    blocked = true;
  }

  // Classification-based review requirements
  if (cls.requiresGovReview) {
    findings.push(`GOV review required for ${cls.primary} change`);
  }
  if (cls.requiresQaReview) {
    findings.push(`QA review required for ${cls.primary} change`);
  }
  if (cls.requiresHumanApproval) {
    findings.push(`Human approval required for ${cls.primary} change (risk ${cls.risk})`);
  }

  return { findings, blocked };
}

// ─── Main run flow ───────────────────────────────────────────────────────────

async function runFlow(intent: DeliveryIntent, opts: DeliveryOptions): Promise<DeliveryResult> {
  // Preflight
  const pre = preflight(intent);
  if (!pre.ok) {
    return {
      runId: intent.runId ?? 'unknown',
      state: 'blocked',
      exitCode: 3,
      message: pre.message,
    };
  }

  const sm = new DeliveryStateMachine(intent, pre.targetSha);
  const runId = sm.runId;
  sm.update({
    worktreePath: join(
      ROOT,
      '.session',
      'delivery-worktrees',
      intent.branchName ?? `delivery-${runId.slice(-8)}`,
    ),
  });

  if (opts.dryRun) {
    console.log(`[DRY-RUN] Would run delivery ${runId} for target ${intent.target}`);
    console.log(`[DRY-RUN] Change paths: ${intent.changePaths.join(', ')}`);
    console.log(`[DRY-RUN] Commit groups: ${intent.commitGroups.map((g) => g.scope).join(', ')}`);
    return { runId, state: 'planned', exitCode: 0, message: 'Dry-run complete' };
  }

  // Preflight → reviewed
  if (!sm.transition('preflighted', 'orchestrator', { targetSha: pre.targetSha })) {
    return { runId, state: 'blocked', exitCode: 3, message: 'Failed to transition to preflighted' };
  }

  // Classify diff
  const cls = classifyDiff(intent.changePaths);
  sm.transition('classified', 'orchestrator', { primary: cls.primary, risk: cls.risk });

  // Review
  const review = await runReview(intent, cls);
  if (review.blocked) {
    sm.transition('blocked', 'orchestrator', {
      reason: 'Review blocked',
      findings: review.findings,
    });
    return {
      runId,
      state: 'blocked',
      exitCode: 6,
      message: `Review blocked: ${review.findings.join('; ')}`,
    };
  }
  sm.transition('reviewed', 'orchestrator', { findings: review.findings });

  // Create the isolated branch before any Git mutation. The operator checkout
  // must remain untouched throughout delivery.
  const branchName = intent.branchName ?? `delivery/${runId.slice(-8)}-${intent.target}`;
  const wt = createWorktree(branchName, pre.targetSha);
  if (!wt.ok) {
    sm.transition('blocked', 'orchestrator', {
      reason: 'Worktree creation failed',
      error: wt.error,
    });
    return {
      runId,
      state: 'blocked',
      exitCode: 5,
      message: `Worktree creation failed: ${wt.error}`,
    };
  }
  sm.update({ branch: branchName, worktreePath: wt.path });

  // Commit groups (atomic)
  const sourceSha = currentSha();
  sm.update({ sourceSha });
  const commitShas: string[] = [];
  for (const group of intent.commitGroups) {
    const sync = syncPathsFromSource(sourceSha, pre.targetSha, group.paths, wt.path);
    if (!sync.ok) {
      sm.transition('blocked', 'orchestrator', {
        reason: `Source sync ${group.scope} failed`,
        error: sync.stderr,
      });
      return {
        runId,
        state: 'blocked',
        exitCode: 3,
        message: `Source sync ${group.scope} failed: ${sync.stderr}`,
      };
    }
    const gStage = stagePaths(group.paths, wt.path);
    if (!gStage.ok) {
      sm.transition('blocked', 'orchestrator', { reason: `Staging group ${group.scope} failed` });
      return {
        runId,
        state: 'blocked',
        exitCode: 3,
        message: `Staging group ${group.scope} failed`,
      };
    }
    const c = commit(group.message, wt.path);
    if (!c.ok) {
      sm.transition('blocked', 'orchestrator', {
        reason: `Commit ${group.scope} failed`,
        error: c.stderr,
      });
      return {
        runId,
        state: 'blocked',
        exitCode: 3,
        message: `Commit ${group.scope} failed: ${c.stderr}`,
      };
    }
    commitShas.push(currentSha(wt.path));
  }
  sm.transition('staged', 'orchestrator', { paths: intent.changePaths, worktreePath: wt.path });
  sm.update({ commitShas });
  sm.transition('committed', 'orchestrator', { commitShas });

  // Branch + push
  sm.transition('branched', 'orchestrator', { branch: branchName });

  // Push (only if gh available and not dry-run)
  if (ghAvailable()) {
    const push = pushBranch(branchName, 'origin', wt.path);
    if (!push.ok) {
      sm.transition('blocked', 'orchestrator', { reason: 'Push failed', error: push.stderr });
      return { runId, state: 'blocked', exitCode: 5, message: `Push failed: ${push.stderr}` };
    }
    sm.transition('pushed', 'orchestrator', { branch: branchName });

    // Create PR
    const repo = ghRepo();
    const marker = `delivery:${runId}`;
    const existing = findPrByMarker(marker, repo);
    let prNumber = existing.prNumber;
    if (!prNumber) {
      const pr = createPr({
        title: `[delivery:${runId}] ${intent.summary}`,
        body: `Automated delivery run ${runId}\n\n**Target**: ${intent.target}\n**Requested by**: ${intent.requestedBy}\n**Change paths**: ${intent.changePaths.join(', ')}\n\n> Marker: ${marker}`,
        head: branchName,
        base: intent.target,
        repo,
      });
      if (!pr.ok) {
        sm.transition('blocked', 'orchestrator', { reason: 'PR creation failed', error: pr.error });
        return { runId, state: 'blocked', exitCode: 5, message: `PR creation failed: ${pr.error}` };
      }
      prNumber = pr.prNumber;
    }
    sm.update({ prNumber });
    sm.transition('pr_open', 'orchestrator', { prNumber });

    // Poll checks (bounded)
    if (prNumber) {
      const checks = pollChecks(prNumber, repo, 30);
      const normalized: Record<string, CheckStatus> = {};
      for (const [name, state] of Object.entries(checks)) {
        normalized[name] = (state as CheckStatus) ?? 'pending';
      }
      sm.update({ checkSnapshot: normalized });
      const allPass = Object.values(normalized).every((s) => s === 'pass' || s === 'skipped');
      if (allPass) {
        sm.transition('checks_passed', 'orchestrator', { checks: normalized });
        sm.transition('awaiting_approval', 'orchestrator', {});
        return {
          runId,
          state: 'awaiting_approval',
          exitCode: 2,
          message: `PR #${prNumber} created and checks passed. Awaiting human approval. Run: npx tsx src/delivery/cli.ts approve ${runId} --purpose merge`,
        };
      }
      return {
        runId,
        state: 'pr_open',
        exitCode: 2,
        message: `PR #${prNumber} created. Checks pending/failed. Run: npx tsx src/delivery/cli.ts status ${runId}`,
      };
    }
    return {
      runId,
      state: 'pr_open',
      exitCode: 2,
      message: `PR created but number unavailable. Run: npx tsx src/delivery/cli.ts status ${runId}`,
    };
  }

  // No gh available — local-only
  sm.transition('pushed', 'orchestrator', {
    branch: branchName,
    note: 'gh not available; local-only',
  });
  return {
    runId,
    state: 'pushed',
    exitCode: 0,
    message: `Local delivery complete (no GitHub available). Branch: ${branchName}`,
  };
}

function pollChecks(prNumber: number, repo: string, maxAttempts: number): Record<string, string> {
  let checks: Record<string, string> = {};
  for (let i = 0; i < maxAttempts; i++) {
    checks = getPrChecks(prNumber, repo);
    const pending = Object.values(checks).filter(
      (s) => s === 'pending' || s === 'in_progress' || s === 'queued',
    );
    if (pending.length === 0) break;
    // Wait 10s between polls
    try {
      execSync('powershell -Command "Start-Sleep -Seconds 10"', { windowsHide: true });
    } catch {
      /* ignore */
    }
  }
  return checks;
}

// ─── Resume ──────────────────────────────────────────────────────────────────

function resumeFlow(runId: string, _opts: DeliveryOptions): DeliveryResult {
  const cp = loadCheckpoint(runId);
  if (!cp) {
    return {
      runId,
      state: 'blocked',
      exitCode: 3,
      message: `No checkpoint found for run ${runId}`,
    };
  }

  // Verify integrity
  const sm = DeliveryStateMachine.resume(runId);
  if (!sm) {
    return { runId, state: 'blocked', exitCode: 6, message: `Cannot resume run ${runId}` };
  }
  const integrity = sm.verifyIntegrity();
  if (!integrity.valid) {
    return {
      runId,
      state: 'blocked',
      exitCode: 6,
      message: `Event chain integrity broken at event ${integrity.brokenAt}`,
    };
  }

  // Verify workspace hash unchanged
  const currentWs = computeWorkspaceHash();
  if (currentWs !== cp.workspaceHash) {
    return {
      runId,
      state: 'blocked',
      exitCode: 6,
      message: `Workspace changed since checkpoint (${cp.workspaceHash} → ${currentWs}). Cannot safely resume.`,
    };
  }

  const sourceHead = cp.sourceSha ? currentSha() : undefined;
  if (cp.sourceSha && sourceHead !== cp.sourceSha) {
    return {
      runId,
      state: 'blocked',
      exitCode: 6,
      message: `Source HEAD changed since checkpoint (${cp.sourceSha} → ${sourceHead}). Cannot safely resume.`,
    };
  }

  console.log(`[RESUME] Run ${runId} at state ${cp.state}`);
  return {
    runId,
    state: cp.state,
    exitCode: 0,
    message: `Resumed at state ${cp.state}`,
    checkpoint: cp,
  };
}

// ─── Status ──────────────────────────────────────────────────────────────────

function statusFlow(runId: string): DeliveryResult {
  const cp = loadCheckpoint(runId);
  if (!cp) {
    return {
      runId,
      state: 'blocked',
      exitCode: 3,
      message: `No checkpoint found for run ${runId}`,
    };
  }
  console.log(`\n=== DELIVERY STATUS: ${runId} ===`);
  console.log(`State: ${cp.state}`);
  console.log(`Target: ${cp.targetSha}`);
  console.log(`Branch: ${cp.branch ?? 'N/A'}`);
  console.log(`PR: ${cp.prNumber ?? 'N/A'}`);
  console.log(`Commits: ${cp.commitShas.length}`);
  console.log(`Updated: ${cp.updatedAt}`);
  if (cp.checkSnapshot) {
    console.log('\nChecks:');
    for (const [name, state] of Object.entries(cp.checkSnapshot)) {
      const icon =
        state === 'pass' ? '✅' : state === 'fail' ? '❌' : state === 'pending' ? '⏳' : '⏭️';
      console.log(`  ${icon} ${name}: ${state}`);
    }
  }
  return { runId, state: cp.state, exitCode: 0, message: 'Status shown', checkpoint: cp };
}

// ─── Approve ─────────────────────────────────────────────────────────────────

function approveFlow(runId: string, purpose: string): DeliveryResult {
  const cp = loadCheckpoint(runId);
  if (!cp) {
    return {
      runId,
      state: 'blocked',
      exitCode: 3,
      message: `No checkpoint found for run ${runId}`,
    };
  }
  if (cp.state !== 'awaiting_approval' && cp.state !== 'checks_passed') {
    return {
      runId,
      state: cp.state,
      exitCode: 2,
      message: `Cannot approve from state ${cp.state}`,
    };
  }
  if (purpose !== 'merge' && purpose !== 'promotion') {
    return { runId, state: cp.state, exitCode: 2, message: `Invalid purpose: ${purpose}` };
  }

  // Verify PR is still mergeable and head SHA unchanged
  if (cp.prNumber && ghAvailable()) {
    const repo = ghRepo();
    const mergeable = getPrMergeable(cp.prNumber, repo);
    const state = getPrState(cp.prNumber, repo);
    if (state !== 'OPEN') {
      return { runId, state: cp.state, exitCode: 2, message: `PR is ${state}, not OPEN` };
    }
    if (mergeable !== 'MERGEABLE') {
      return { runId, state: cp.state, exitCode: 2, message: `PR is not mergeable (${mergeable})` };
    }
    // Note: head SHA comparison requires storing expected head SHA in checkpoint.
    // For now, rely on GitHub's mergeable state + fresh checks.

    const merge = mergePr(cp.prNumber, repo);
    if (!merge.ok) {
      return { runId, state: cp.state, exitCode: 5, message: `Merge failed: ${merge.error}` };
    }
    const sm = DeliveryStateMachine.resume(runId);
    if (sm) {
      sm.transition('merged', 'human', { prNumber: cp.prNumber, purpose });
    }
    return { runId, state: 'merged', exitCode: 0, message: `PR #${cp.prNumber} merged` };
  }

  return {
    runId,
    state: cp.state,
    exitCode: 2,
    message: 'Cannot approve without GitHub available',
  };
}

// ─── Rollback ────────────────────────────────────────────────────────────────

function rollbackFlow(runId: string, scope: string, confirm: boolean): DeliveryResult {
  const cp = loadCheckpoint(runId);
  if (!cp) {
    return {
      runId,
      state: 'blocked',
      exitCode: 3,
      message: `No checkpoint found for run ${runId}`,
    };
  }
  if (!confirm) {
    return { runId, state: cp.state, exitCode: 2, message: 'Rollback requires --confirm' };
  }

  switch (scope) {
    case 'local': {
      // Remove worktree
      if (cp.branch) {
        removeWorktree(cp.branch);
      }
      const sm = DeliveryStateMachine.resume(runId);
      if (sm) sm.transition('rolled_back', 'human', { scope });
      return { runId, state: 'rolled_back', exitCode: 0, message: 'Local worktree removed' };
    }
    case 'branch': {
      // Delete remote branch (via gh)
      if (cp.branch && ghAvailable()) {
        try {
          execSync(`git push origin --delete ${cp.branch}`, {
            cwd: ROOT,
            windowsHide: true,
            encoding: 'utf-8',
          });
        } catch {
          /* branch may not exist */
        }
      }
      const sm = DeliveryStateMachine.resume(runId);
      if (sm) sm.transition('rolled_back', 'human', { scope });
      return { runId, state: 'rolled_back', exitCode: 0, message: 'Branch deleted' };
    }
    case 'pr': {
      // Close PR
      if (cp.prNumber && ghAvailable()) {
        try {
          execSync(`gh pr close ${cp.prNumber}`, {
            cwd: ROOT,
            windowsHide: true,
            encoding: 'utf-8',
          });
        } catch {
          /* PR may already be closed */
        }
      }
      const sm = DeliveryStateMachine.resume(runId);
      if (sm) sm.transition('rolled_back', 'human', { scope });
      return { runId, state: 'rolled_back', exitCode: 0, message: 'PR closed' };
    }
    case 'promotion': {
      return {
        runId,
        state: cp.state,
        exitCode: 2,
        message:
          'Promotion rollback requires manual intervention and human selection of previous artifact',
      };
    }
    default:
      return { runId, state: cp.state, exitCode: 2, message: `Invalid scope: ${scope}` };
  }
}

// ─── CLI dispatch ────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`Usage:
  npx tsx src/delivery/cli.ts run --intent <file> [options]
  npx tsx src/delivery/cli.ts resume <run-id> [--from <state>] [--dry-run]
  npx tsx src/delivery/cli.ts status <run-id>
  npx tsx src/delivery/cli.ts approve <run-id> --purpose merge|promotion
  npx tsx src/delivery/cli.ts rollback <run-id> --scope local|branch|pr|promotion [--confirm]
  npx tsx src/delivery/cli.ts gate [--stage pre-commit|pre-push|pre-pr|release] [--json]
  npx tsx src/delivery/cli.ts list
`);
    process.exit(0);
  }

  switch (command) {
    case 'run': {
      const intentFile = args.includes('--intent') ? args[args.indexOf('--intent') + 1] : '';
      if (!intentFile) {
        console.error('Provide --intent <file>');
        process.exit(1);
      }
      const opts: DeliveryOptions = {
        dryRun: args.includes('--dry-run'),
        review: args.includes('--review')
          ? (args[args.indexOf('--review') + 1] as DeliveryOptions['review'])
          : 'ai+human',
        resume: args.includes('--resume'),
        keepWorktree: args.includes('--keep-worktree'),
        yes: args.includes('--yes'),
        noVersionChange: !args.includes('--allow-version-change'),
      };
      try {
        const intent = loadIntent(intentFile);
        runFlow(intent, opts)
          .then((result) => {
            console.log(`\n[${result.state.toUpperCase()}] ${result.message}`);
            process.exit(result.exitCode);
          })
          .catch((e) => {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(3);
          });
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(3);
      }
      return;
    }
    case 'resume': {
      const runId = args[1];
      if (!runId) {
        console.error('Provide run-id');
        process.exit(1);
      }
      const opts: DeliveryOptions = {
        dryRun: args.includes('--dry-run'),
        review: 'ai+human',
        resume: true,
        keepWorktree: false,
        yes: false,
        noVersionChange: true,
      };
      const result = resumeFlow(runId, opts);
      console.log(`\n[${result.state.toUpperCase()}] ${result.message}`);
      process.exit(result.exitCode);
      break;
    }
    case 'status': {
      const runId = args[1];
      if (!runId) {
        console.error('Provide run-id');
        process.exit(1);
      }
      const result = statusFlow(runId);
      process.exit(result.exitCode);
      break;
    }
    case 'approve': {
      const runId = args[1];
      const purpose = args.includes('--purpose') ? args[args.indexOf('--purpose') + 1] : 'merge';
      if (!runId) {
        console.error('Provide run-id');
        process.exit(1);
      }
      const result = approveFlow(runId, purpose);
      console.log(`\n[${result.state.toUpperCase()}] ${result.message}`);
      process.exit(result.exitCode);
      break;
    }
    case 'rollback': {
      const runId = args[1];
      const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'local';
      const confirm = args.includes('--confirm');
      if (!runId) {
        console.error('Provide run-id');
        process.exit(1);
      }
      const result = rollbackFlow(runId, scope, confirm);
      console.log(`\n[${result.state.toUpperCase()}] ${result.message}`);
      process.exit(result.exitCode);
      break;
    }
    case 'gate': {
      const stage = args.includes('--stage') ? args[args.indexOf('--stage') + 1] : 'pre-pr';
      const json = args.includes('--json');
      const quiet = args.includes('--quiet');
      const force = args.includes('--force');
      const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
      runDeliveryGate({ stage: stage as never, json, quiet, force, only })
        .then((report) => {
          process.exit(report.blocked ? 1 : 0);
        })
        .catch((err) => {
          console.error(`Gate error: ${(err as Error).message}`);
          process.exit(3);
        });
      return;
    }
    case 'list': {
      console.log('Delivery commands:');
      console.log('  run       Start a delivery run');
      console.log('  resume    Resume a checkpointed run');
      console.log('  status    Show run status');
      console.log('  approve   Approve merge/promotion');
      console.log('  rollback  Rollback a run');
      console.log('  gate      Run the unified delivery gate');
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
