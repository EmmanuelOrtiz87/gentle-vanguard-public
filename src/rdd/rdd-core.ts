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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

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
}

export type WorkflowAction =
  'start' | 'classify' | 'review' | 'receipt' | 'gate' | 'status' | 'abort';

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
  const sha = runSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).stdout.trim();
  return `rdd-${sha}-${Date.now()}`;
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
  };

  saveWorkflow(workflow);
  log(`Started workflow ${workflow.workflowId}`, 'SUCCESS');

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

    // Find the created receipt
    const receiptsDir = join(ROOT, '.session', 'receipts');
    const files = runSyncShell('ls -t *.json 2>/dev/null || echo ""', {
      cwd: receiptsDir,
    })
      .stdout.trim()
      .split('\n')
      .filter((f) => f);

    if (files.length > 0) {
      const receiptData = JSON.parse(readFileSync(join(receiptsDir, files[0]), 'utf-8'));
      workflow.receipt = {
        id: receiptData.id,
        candidateSha: receiptData.candidateHash,
        approved: receiptData.approved,
      };
    }

    workflow.status = 'receipt-issued';
    log('Receipt issued', 'SUCCESS');
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
      'src/slsa-provenance.ts',
      ['generate', '-a', ...artifacts, '--invocation-id', `rdd-${workflow.workflowId}`],
      { cwd: ROOT },
    );
    log(`Provenance generated for ${artifacts.length} release artifact(s)`, 'SUCCESS');

    // Sign the provenance (DSSE + Ed25519) if the private key exists — best-effort.
    const privateKey = join(ROOT, '.runtime', 'provenance', 'private-key.pem');
    if (existsSync(privateKey)) {
      runNpxTsxSync(
        'src/slsa-signer.ts',
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
  options: { gate?: string; workflowId?: string } = {},
): Promise<RDDWorkflow | null> {
  let workflow: RDDWorkflow | null = options.workflowId
    ? loadWorkflow(options.workflowId)
    : loadLatestWorkflow();

  if (action === 'start') {
    workflow = startWorkflow();
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
      break;
    case 'review':
      workflow = await stepReview(workflow);
      break;
    case 'receipt':
      workflow = await stepReceipt(workflow);
      break;
    case 'gate':
      if (options.gate) {
        workflow = await stepGate(workflow, options.gate);
      }
      break;
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

      const workflow = await runWorkflow(action, { workflowId, gate });

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
