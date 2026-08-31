#!/usr/bin/env node
/**
 * RDD Core — Native Receipt-Driven Development for Gentle-Vanguard
 *
 * This is the entry point and coordinator for RDD:
 *   1. Risk Classification (evidence-based, not size-based)
 *   2. Review Orchestration (0/1/4 lenses based on risk)
 *   3. Receipt Issuance (content-bound to Git SHA)
 *   4. Gate Validation (5 delivery gates)
 *
 * No dependency on gentle-ai CLI.
 * 100% native Gentle-Vanguard implementation.
 */

import { pathToFileURL } from 'url';
import { runSync, runSyncShell, runNpxTsxSync } from '../core/run-command.js';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import {
  recordContinuation,
  nextTransition,
  stageAck,
  getPendingAck,
  acknowledge,
  pruneContinuations,
  type AckResult,
} from '../core/continuation.js';
import { refusal, describe as describeRefusal, type TypedRefusal } from '../core/typed-refusal.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RDDWorkflow {
  workflowId: string;
  status: 'started' | 'risk-classified' | 'reviewing' | 'receipt-issued' | 'completed' | 'failed';
  classification: {
    tier: 'low' | 'standard' | 'high';
    score: number;
    reviewLenses: number;
  } | null;
  receipt: {
    id: string;
    candidateSha: string;
    approved: boolean;
  } | null;
  gates: {
    'post-apply': boolean;
    'pre-commit': boolean;
    'pre-push': boolean;
    'pre-pr': boolean;
    release: boolean;
  };
  startedAt: string;
  completedAt: string | null;
  /** Set when the receipt's pending acknowledgement was burned (ack-before-burn). */
  acknowledgedAt: string | null;
}

export type WorkflowAction =
  'start' | 'classify' | 'review' | 'receipt' | 'gate' | 'ack' | 'status' | 'abort' | 'prune';

// ─── Config ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const RDD_DIR = join(ROOT, '.session', 'rdd');

// ─── Logger ─────────────────────────────────────────────────────────────────--

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colors: Record<string, string> = {
    INFO: '\u001b[36m',
    WARN: '\u001b[33m',
    ERROR: '\u001b[31m',
    SUCCESS: '\u001b[32m',
  };
  console.log(`${colors[level]}[${timestamp}] [RDD-CORE] [${level}] ${message}\u001b[0m`);
}

// ─── Workflow Management ──────────────────────────────────────────────────────

function generateWorkflowId(): string {
  // Honest outside git (absorbed from gentle-ai #3899/#3885): a workspace with
  // no repository still gets a truthful, stable workflow id instead of an
  // empty-sha id or a crash. Both failure shapes count: git missing (throw)
  // and git present-but-not-a-repo (non-zero exit → empty stdout).
  try {
    const sha = runSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).stdout.trim();
    if (sha) return `rdd-${sha}-${Date.now()}`;
  } catch {
    /* git unavailable → fallback below */
  }
  const cwdHash = createHash('sha256').update(ROOT).digest('hex').slice(0, 7);
  return `rdd-nogit-${cwdHash}-${Date.now()}`;
}

/**
 * Publish the machine-executable re-entry for the workflow's next step
 * (absorbed from gentle-ai v2.5.0-rc.3: "re-entry ships with the freeze").
 * The command is returned verbatim — no prose reconstruction by the operator.
 */
function publishNextTransition(
  workflow: RDDWorkflow,
  nextAction: WorkflowAction,
  gate?: string,
): void {
  const args = gate
    ? ` --workflow=${workflow.workflowId} --gate=${gate}`
    : ` --workflow=${workflow.workflowId}`;
  recordContinuation({
    workflowId: workflow.workflowId,
    operation: `rdd.${nextAction}`,
    args: gate ? { workflow: workflow.workflowId, gate } : { workflow: workflow.workflowId },
    command: `npx tsx src/rdd/rdd-core.ts ${nextAction}${args}`,
    revision: workflow.receipt?.candidateSha ?? undefined,
    root: ROOT,
  });
}

export function startWorkflow(): RDDWorkflow {
  const workflow: RDDWorkflow = {
    workflowId: generateWorkflowId(),
    status: 'started',
    classification: null,
    receipt: null,
    gates: {
      'post-apply': false,
      'pre-commit': false,
      'pre-push': false,
      'pre-pr': false,
      release: false,
    },
    startedAt: new Date().toISOString(),
    completedAt: null,
    acknowledgedAt: null,
  };

  saveWorkflow(workflow);
  publishNextTransition(workflow, 'classify');
  log(`Started workflow ${workflow.workflowId}`, 'SUCCESS');
  log('Next transition (run verbatim):', 'INFO');
  log(`  npx tsx src/rdd/rdd-core.ts classify --workflow=${workflow.workflowId}`, 'INFO');

  return workflow;
}

function saveWorkflow(workflow: RDDWorkflow): void {
  mkdirSync(RDD_DIR, { recursive: true });
  writeFileSync(join(RDD_DIR, `${workflow.workflowId}.json`), JSON.stringify(workflow, null, 2));
}

function loadWorkflow(workflowId: string): RDDWorkflow | null {
  const path = join(RDD_DIR, `${workflowId}.json`);
  if (!existsSync(path)) return null;

  try {
    const workflow: RDDWorkflow = JSON.parse(readFileSync(path, 'utf-8'));
    return workflow;
  } catch {
    return null;
  }
}

function loadLatestWorkflow(): RDDWorkflow | null {
  if (!existsSync(RDD_DIR)) return null;

  try {
    const files = runSyncShell('ls -t *.json 2>/dev/null || echo ""', {
      cwd: RDD_DIR,
    })
      .stdout.trim()
      .split('\n')
      .filter((f) => f);

    if (files.length === 0) return null;

    const latest = files[0];
    return JSON.parse(readFileSync(join(RDD_DIR, latest), 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Retention ────────────────────────────────────────────────────────────────

export interface PruneResult {
  pruned: string[];
  kept: string[];
  retentionDays: number;
}

/**
 * Retention policy for RDD review artifacts (lesson from gentle-ai #1656:
 * lineages accumulate with no retention policy). Two closures per run:
 *
 *   1. TERMINAL-EVENT CLOSURE (lesson from gentle-ai v2.5.0-rc.1 — "the
 *      lifecycle closes where proof ends"): workflows stuck in a
 *      non-terminal state (started / risk-classified / reviewing /
 *      receipt-issued) older than the retention window are marked `failed`
 *      (aborted) — a review that produced no receipt in N days is dead, not
 *      pending. The state file is kept for audit (only truly terminal
 *      workflows get deleted on the next pass).
 *   2. PRUNE: terminal workflows (completed/failed) older than the window are
 *      deleted.
 *
 * NEVER touches disable-log.jsonl (audit), the DISABLED flag or any non-json
 * config. `dir` is injectable for unit tests.
 */
export function pruneWorkflows(retentionDays = 30, dir: string = RDD_DIR): PruneResult {
  const result: PruneResult = { pruned: [], kept: [], retentionDays };
  if (!existsSync(dir)) return result;
  const cutoff = Date.now() - retentionDays * 24 * 3_600_000;
  const TERMINAL: RDDWorkflow['status'][] = ['completed', 'failed'];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue; // disable-log.jsonl / DISABLED are untouchable
    const p = join(dir, f);
    try {
      const wf = JSON.parse(readFileSync(p, 'utf-8')) as RDDWorkflow;
      const last = new Date(wf.completedAt ?? wf.startedAt).getTime();
      if (isNaN(last) || last >= cutoff) {
        result.kept.push(f);
        continue;
      }
      if (TERMINAL.includes(wf.status)) {
        unlinkSync(p);
        result.pruned.push(f);
      } else {
        // stuck review: close the lifecycle at a terminal event instead of
        // letting it linger forever — keep the file, flip the status
        wf.status = 'failed';
        wf.completedAt = new Date().toISOString();
        writeFileSync(p, JSON.stringify(wf, null, 2), 'utf-8');
        result.kept.push(`${f} (aborted-stale)`);
      }
    } catch {
      result.kept.push(f); // unreadable files are never deleted blindly
    }
  }
  return result;
}

// ─── Workflow Steps ────────────────────────────────────────────────────────────

async function stepClassify(workflow: RDDWorkflow): Promise<RDDWorkflow> {
  log('Running risk classification...', 'INFO');

  try {
    // Import and run risk classifier
    const { classifyRisk } = await import('./risk-classifier.js');
    const classification = classifyRisk(false); // committed changes

    workflow.classification = {
      tier: classification.tier,
      score: classification.score,
      reviewLenses: classification.reviewLenses,
    };
    workflow.status = 'risk-classified';

    log(
      `Classified as ${classification.tier.toUpperCase()} risk (${classification.reviewLenses} lens(es))`,
      'SUCCESS',
    );

    if (classification.tier === 'low') {
      log('Low risk: proceeding to auto-approve', 'INFO');
    }

    saveWorkflow(workflow);
  } catch (err) {
    log(`Risk classification failed: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
    workflow.status = 'failed';
  }

  return workflow;
}

async function stepReview(workflow: RDDWorkflow): Promise<RDDWorkflow> {
  if (!workflow.classification) {
    log('Must classify risk first', 'ERROR');
    workflow.status = 'failed';
    return workflow;
  }

  const { tier, reviewLenses } = workflow.classification;

  if (tier === 'low') {
    log('Low risk: skipping review', 'INFO');
    workflow.status = 'reviewing';
    saveWorkflow(workflow);
    return workflow;
  }

  if (reviewLenses === 1) {
    log('Starting focused 1-lens review...', 'INFO');
    log('Review recommendation: Focus on highest risk category', 'INFO');
  } else if (reviewLenses === 4) {
    log('Starting full 4R review...', 'INFO');
  }

  workflow.status = 'reviewing';
  saveWorkflow(workflow);

  return workflow;
}

async function stepReceipt(workflow: RDDWorkflow): Promise<RDDWorkflow> {
  log('Issuing receipt...', 'INFO');

  try {
    // Run receipt manager
    runNpxTsxSync('scripts/utilities/ops/REVIEW/receipt-manager.ts', ['create', '--approved'], {
      cwd: ROOT,
    });

    // The receipt manager persists receipts inside .session/receipts/index.json
    // (append-only receipts[] array) — read the index and take the newest entry
    // instead of scanning for per-receipt files that were never written.
    const receiptsIndex = join(ROOT, '.session', 'receipts', 'index.json');
    if (existsSync(receiptsIndex)) {
      const idx = JSON.parse(readFileSync(receiptsIndex, 'utf-8')) as {
        receipts?: Array<{ id: string; candidateHash: string; approved: boolean }>;
      };
      const newest = idx.receipts?.[idx.receipts.length - 1];
      if (newest) {
        workflow.receipt = {
          id: newest.id,
          candidateSha: newest.candidateHash,
          approved: newest.approved,
        };
      }
    }

    workflow.status = 'receipt-issued';
    log('Receipt issued', 'SUCCESS');

    // Ack-before-burn (absorbed from gentle-ai v2.5.0-rc.2): the receipt is
    // staged, NOT delivered. Only the exact acknowledgement token burns its
    // authority; a restarted status replays the same token and revision.
    const revision = workflow.receipt?.candidateSha ?? workflow.startedAt;
    const pending = stageAck(`rdd.${workflow.workflowId}`, revision);
    log('Receipt staged — acknowledge to burn its authority:', 'INFO');
    log(
      `  npx tsx src/rdd/rdd-core.ts ack --workflow=${workflow.workflowId} --token=${pending.token}`,
      'INFO',
    );

    saveWorkflow(workflow);
  } catch (err) {
    log(`Receipt issuance failed: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
  }

  return workflow;
}

async function stepGate(workflow: RDDWorkflow, gate: string): Promise<RDDWorkflow> {
  if (!workflow.receipt) {
    log('Must issue receipt first', 'ERROR');
    return workflow;
  }

  // The receipt's authority burns only on acknowledgement; a delivery gate
  // consumes it, so an unacknowledged receipt refuses here — typed, naming its
  // way forward, creating nothing (gentle-vanguard.ack/v1).
  if (!workflow.acknowledgedAt && getPendingAck(`rdd.${workflow.workflowId}`)) {
    const r: TypedRefusal = refusal(
      'authority',
      'rdd.receipt-not-acknowledged',
      'receipt is staged but not acknowledged — its authority is not burned yet',
      {
        nothingStarted: true,
        remediation: {
          command: `npx tsx src/rdd/rdd-core.ts status --workflow=${workflow.workflowId}`,
          description: 'status replays the same acknowledgement token and command',
        },
      },
    );
    log(describeRefusal(r), 'WARN');
    return workflow;
  }

  log(`Validating ${gate} gate...`, 'INFO');

  try {
    runNpxTsxSync('src/rdd/rdd-gates.ts', ['validate', gate, `--receipt=${workflow.receipt.id}`], {
      cwd: ROOT,
    });

    log(`Gate ${gate}: passed`, 'SUCCESS');
    workflow.gates[gate as keyof typeof workflow.gates] = true;
    saveWorkflow(workflow);
  } catch (err) {
    // Gate failed
    if (err instanceof Error && 'status' in err) {
      log(`Gate ${gate}: failed (exit ${err.status})`, 'WARN');
      console.log(err.message);
    }
  }

  // Check if all gates passed
  const allGates = Object.entries(workflow.gates);
  const passedGates = allGates.filter(([_, v]) => v).length;

  if (passedGates === allGates.length) {
    workflow.status = 'completed';
    workflow.completedAt = new Date().toISOString();
    log('All gates passed! Workflow complete', 'SUCCESS');
    saveWorkflow(workflow);
    generateReleaseProvenance(workflow);
  }

  return workflow;
}

/**
 * Generate SLSA provenance for the release artifacts when the workflow completes.
 * Best-effort: does NOT block workflow completion on failure.
 * Attests sbom.json (if present) + the workflow receipt against the current git SHA.
 * Exported for unit testing.
 */
export function generateReleaseProvenance(workflow: RDDWorkflow): void {
  try {
    const artifacts: string[] = [];
    const sbomPath = join(ROOT, 'sbom', 'gentle-vanguard-sbom.json');
    if (existsSync(sbomPath)) artifacts.push(sbomPath);

    const receiptsDir = join(ROOT, '.session', 'receipts');
    if (workflow.receipt) {
      const receiptPath = join(receiptsDir, `${workflow.receipt.id}.json`);
      if (existsSync(receiptPath)) artifacts.push(receiptPath);
    }

    if (artifacts.length === 0) {
      log('Provenance: no release artifacts found (sbom/receipt missing) — skipped', 'WARN');
      return;
    }

    runNpxTsxSync(
      'src/security/slsa-provenance.ts',
      ['generate', '-a', ...artifacts, '--invocation-id', `rdd-${workflow.workflowId}`],
      { cwd: ROOT },
    );
    log(`Provenance generated for ${artifacts.length} release artifact(s)`, 'SUCCESS');

    // Sign the provenance (DSSE + Ed25519) if the private key exists — best-effort.
    const privateKey = join(ROOT, '.runtime', 'provenance', 'private-key.pem');
    if (existsSync(privateKey)) {
      runNpxTsxSync(
        'src/security/slsa-signer.ts',
        [
          'sign',
          '-f',
          'provenance/gentle-vanguard-provenance.json',
          '-k',
          privateKey,
          '-o',
          'provenance/gentle-vanguard-provenance.signed.json',
        ],
        { cwd: ROOT },
      );
      log('Provenance signed (DSSE + Ed25519)', 'SUCCESS');
    } else {
      log('Provenance signing skipped (no private key at .runtime/provenance/)', 'WARN');
    }
  } catch (err) {
    log(
      `Provenance generation failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
      'WARN',
    );
  }
}

// ─── Workflow Runner ──────────────────────────────────────────────────────────

export async function runWorkflow(
  action: WorkflowAction,
  options: { gate?: string; workflowId?: string; retentionDays?: number } = {},
): Promise<RDDWorkflow | null> {
  let workflow: RDDWorkflow | null = options.workflowId
    ? loadWorkflow(options.workflowId)
    : loadLatestWorkflow();

  if (action === 'start') {
    workflow = startWorkflow();
  }

  // prune is a maintenance action: it must run even with no active workflow
  if (action === 'prune') {
    const days = options.retentionDays ?? 30;
    const res = pruneWorkflows(days);
    log(
      `Prune: ${res.pruned.length} eliminado(s), ${res.kept.length} retenido(s) (>${days}d)${res.pruned.length > 0 ? ` — ${res.pruned.join(', ')}` : ''}`,
      'SUCCESS',
    );
    // Continuations and staged acks share the retention window: resolved
    // records are deleted, stale actives are closed honestly, undelivered
    // acks burn (a token nobody delivered in N days never arrives).
    const cont = pruneContinuations(days);
    if (cont.prunedResolved + cont.closedStaleActive + cont.burnedStaleAcks > 0) {
      log(
        `Continuations: ${cont.prunedResolved} pruned, ${cont.closedStaleActive} closed-stale, ${cont.burnedStaleAcks} acks burned (>${days}d)`,
        'SUCCESS',
      );
    }
    return null;
  }

  if (!workflow && action !== 'status') {
    log('No active workflow. Run "start" first', 'ERROR');
    return null;
  }

  if (!workflow) return null;

  switch (action) {
    case 'start':
      // Already started above
      break;
    case 'classify':
      workflow = await stepClassify(workflow);
      if (workflow.status === 'risk-classified') publishNextTransition(workflow, 'review');
      break;
    case 'review':
      workflow = await stepReview(workflow);
      if (workflow.status === 'reviewing') publishNextTransition(workflow, 'receipt');
      break;
    case 'receipt':
      workflow = await stepReceipt(workflow);
      if (workflow.status === 'receipt-issued')
        publishNextTransition(workflow, 'gate', 'post-apply');
      break;
    case 'gate':
      if (options.gate) {
        workflow = await stepGate(workflow, options.gate);
        if (!workflow) break;
        const currentWorkflow = workflow;
        // A passed gate advances workflow.gates even when status text is
        // unchanged — publish the continuation on the gate map, not the status.
        const gatePassed =
          currentWorkflow.gates[options.gate as keyof typeof currentWorkflow.gates] === true;
        if (gatePassed && currentWorkflow.status !== 'completed') {
          const order = ['post-apply', 'pre-commit', 'pre-push', 'pre-pr', 'release'] as const;
          const nextGate = order.find((g) => !currentWorkflow.gates[g]);
          if (nextGate) publishNextTransition(currentWorkflow, 'gate', nextGate);
        }
      }
      break;
    case 'ack': {
      // handled by acknowledgeWorkflow (needs a typed-refusal exit path)
      break;
    }
    case 'abort':
      workflow.status = 'failed';
      workflow.completedAt = new Date().toISOString();
      saveWorkflow(workflow);
      log('Workflow aborted', 'WARN');
      break;
  }

  return workflow;
}

// ─── Status Display ────────────────────────────────────────────────────────────

/**
 * Acknowledge a staged receipt (ack-before-burn). Only the exact token burns
 * the authority; wrong, stale or replayed acks refuse and create nothing.
 * Exported for unit testing and the CLI exit path.
 */
export function acknowledgeWorkflow(workflow: RDDWorkflow, token: string): AckResult {
  const result = acknowledge(`rdd.${workflow.workflowId}`, token);
  if (result.ok) {
    workflow.acknowledgedAt = new Date().toISOString();
    saveWorkflow(workflow);
    log('Acknowledgement burned — receipt authority consumed', 'SUCCESS');
  } else {
    log(describeRefusal(result.refusal), 'WARN');
  }
  return result;
}

export function formatStatus(workflow: RDDWorkflow): string {
  const lines: string[] = [];

  lines.push('╔════════════════════════════════════════════════════════════════════════╗');
  lines.push('║              RDD WORKFLOW STATUS                                       ║');
  lines.push('╚════════════════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Workflow: ${workflow.workflowId}`);
  lines.push(`Status:   ${workflow.status.toUpperCase()}`);
  lines.push(`Started:  ${new Date(workflow.startedAt).toLocaleString()}`);

  if (workflow.completedAt) {
    lines.push(`Completed: ${new Date(workflow.completedAt).toLocaleString()}`);
  }

  lines.push('');

  if (workflow.classification) {
    lines.push('CLASSIFICATION:');
    lines.push(`  Tier:  ${workflow.classification.tier.toUpperCase()}`);
    lines.push(`  Score: ${workflow.classification.score}/100`);
    lines.push(`  Lenses: ${workflow.classification.reviewLenses}`);
    lines.push('');
  }

  if (workflow.receipt) {
    lines.push('RECEIPT:');
    lines.push(`  ID: ${workflow.receipt.id}`);
    lines.push(`  SHA: ${workflow.receipt.candidateSha.slice(0, 7)}`);
    lines.push(`  Approved: ${workflow.receipt.approved ? 'YES' : 'NO'}`);
    lines.push(
      `  Acknowledged: ${workflow.acknowledgedAt ? new Date(workflow.acknowledgedAt).toLocaleString() : 'PENDING'}`,
    );
    lines.push('');
  }

  // Replay surface (gentle-vanguard.ack/v1): a restarted status returns the
  // SAME pending token and command until the exact acknowledgement burns it.
  const pending = getPendingAck(`rdd.${workflow.workflowId}`);
  if (pending) {
    lines.push('PENDING ACKNOWLEDGEMENT (run verbatim to burn the receipt authority):');
    lines.push(
      `  npx tsx src/rdd/rdd-core.ts ack --workflow=${workflow.workflowId} --token=${pending.token}`,
    );
    lines.push('');
  }

  // Machine-executable re-entry (gentle-vanguard.continuation/v1): the next
  // command is published by the transaction, never reconstructed from prose.
  const next = nextTransition(workflow.workflowId);
  if (next) {
    lines.push('NEXT TRANSITION (run verbatim):');
    lines.push(`  ${next.command}`);
    lines.push('');
  }

  lines.push('GATES:');
  for (const [gate, passed] of Object.entries(workflow.gates)) {
    const icon = passed ? '✓' : '○';
    lines.push(`  ${icon} ${gate}`);
  }

  lines.push('');
  lines.push('─'.repeat(70));

  return lines.join('\n');
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const action = (args[0] as WorkflowAction) || 'status';

    try {
      const workflowId = args.find((a) => a.startsWith('--workflow='))?.split('=')[1];
      const gate = args.find((a) => a.startsWith('--gate='))?.split('=')[1];
      const token = args.find((a) => a.startsWith('--token='))?.split('=')[1];
      const retentionDays = parseInt(
        args.find((a) => a.startsWith('--retention-days='))?.split('=')[1] ?? '30',
        10,
      );

      if (action === 'ack') {
        if (!token) {
          log('ack requires --token= (status replays the pending token)', 'ERROR');
          process.exit(1);
        }
        const wf = workflowId ? loadWorkflow(workflowId) : loadLatestWorkflow();
        if (!wf) {
          log('No workflow found for acknowledgement', 'ERROR');
          process.exit(1);
        }
        const result = acknowledgeWorkflow(wf, token);
        process.exit(result.ok ? 0 : 1);
      }

      const workflow = await runWorkflow(action, { workflowId, gate, retentionDays });

      if (workflow) {
        if (args.includes('--json')) {
          console.log(JSON.stringify(workflow, null, 2));
        } else {
          console.log(formatStatus(workflow));
        }
      }

      process.exit(workflow?.status === 'failed' ? 1 : 0);
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
      process.exit(1);
    }
  })();
}
