#!/usr/bin/env node
/**
 * RDD Delivery Gates — Five validation checkpoints for Receipt-Driven Development
 *
 * Every gate validates the same content-bound receipt.
 * The candidate is frozen at review start, preventing scope/identity drift.
 *
 * Gates:
 *   1. post-apply:    After code implementation
 *   2. pre-commit:    Before git commit
 *   3. pre-push:      Before git push
 *   4. pre-pr:        Before pull request
 *   5. release:       Before release/tag
 *
 * Philosophy: Trust the receipt, not the narration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync, runSyncShell } from '../core/run-command.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DeliveryGate = 'post-apply' | 'pre-commit' | 'pre-push' | 'pre-pr' | 'release';

export interface GateValidation {
  gate: DeliveryGate;
  valid: boolean;
  receiptId: string | null;
  candidateSha: string;
  currentSha: string;
  errors: string[];
  warnings: string[];
  timestamp: string;
}

export interface GateConfig {
  gate: DeliveryGate;
  required: boolean;
  blockOnFailure: boolean;
  allowBypass: boolean;
  bypassRequiresReason: boolean;
}

export interface FrozenCandidate {
  sha: string;
  treeSha: string;
  files: string[];
  contentHash: string;
  timestamp: string;
}

// ─── Config ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const GATES_DIR = join(ROOT, '.session', 'rdd-gates');

const GATE_CONFIGS: Record<DeliveryGate, GateConfig> = {
  'post-apply': {
    gate: 'post-apply',
    required: true,
    blockOnFailure: false,
    allowBypass: false,
    bypassRequiresReason: false,
  },
  'pre-commit': {
    gate: 'pre-commit',
    required: true,
    blockOnFailure: true,
    allowBypass: true,
    bypassRequiresReason: true,
  },
  'pre-push': {
    gate: 'pre-push',
    required: true,
    blockOnFailure: true,
    allowBypass: true,
    bypassRequiresReason: true,
  },
  'pre-pr': {
    gate: 'pre-pr',
    required: true,
    blockOnFailure: true,
    allowBypass: true,
    bypassRequiresReason: true,
  },
  release: {
    gate: 'release',
    required: true,
    blockOnFailure: true,
    allowBypass: false,
    bypassRequiresReason: false,
  },
};

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colors: Record<string, string> = {
    INFO: '\u001b[36m',
    WARN: '\u001b[33m',
    ERROR: '\u001b[31m',
    SUCCESS: '\u001b[32m',
  };
  console.log(`${colors[level]}[${timestamp}] [RDD-GATE] [${level}] ${message}\u001b[0m`);
}

// ─── Git Operations ───────────────────────────────────────────────────────────

function getCurrentSha(): string {
  try {
    return runSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).stdout.trim();
  } catch (err) {
    throw new Error(
      `Failed to get current SHA: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function getTreeSha(sha?: string): string {
  try {
    const target = sha || 'HEAD';
    return runSync('git', ['rev-parse', `${target}^{tree}`], { cwd: ROOT }).stdout.trim();
  } catch (err) {
    throw new Error(`Failed to get tree SHA: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Receipt Operations ────────────────────────────────────────────────────────

interface ReceiptData {
  id: string;
  candidateHash: string;
  contentHash: string;
  approved: boolean;
}

function loadReceipt(receiptId: string): ReceiptData | null {
  const receiptPath = join(ROOT, '.session', 'receipts', `${receiptId}.json`);
  if (!existsSync(receiptPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(receiptPath, 'utf-8'));
  } catch {
    return null;
  }
}

function findLatestReceipt(): ReceiptData | null {
  const receiptsDir = join(ROOT, '.session', 'receipts');
  if (!existsSync(receiptsDir)) {
    return null;
  }

  try {
    const files = runSyncShell('ls -t *.json 2>/dev/null || dir /b /o-d *.json 2>nul', {
      cwd: receiptsDir,
    })
      .stdout.trim()
      .split('\n');

    if (files.length === 0 || files[0] === '') {
      return null;
    }

    const latestFile = files[0].trim();
    return JSON.parse(readFileSync(join(receiptsDir, latestFile), 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Gate Validation ───────────────────────────────────────────────────────────

export function validateGate(gate: DeliveryGate, receiptId?: string): GateValidation {
  const currentSha = getCurrentSha();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Find receipt
  let receipt: ReceiptData | null = null;
  if (receiptId) {
    receipt = loadReceipt(receiptId);
  } else {
    receipt = findLatestReceipt();
  }

  if (!receipt) {
    errors.push('No receipt found. Run review first: receipt-manager create --approved');
    return {
      gate,
      valid: false,
      receiptId: null,
      candidateSha: '',
      currentSha,
      errors,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }

  const candidateSha = receipt.candidateHash;

  // Gate-specific validations
  switch (gate) {
    case 'post-apply': {
      // post-apply: verify receipt exists and is valid
      // Allow drift since we're still implementing
      if (!receipt.approved) {
        warnings.push('Receipt not yet approved. Review in progress.');
      }
      break;
    }

    case 'pre-commit': {
      // pre-commit: SHA must match exactly (staged files)
      const stagedSha = getCurrentSha();
      if (candidateSha !== stagedSha) {
        errors.push(
          `SHA mismatch: receipt=${candidateSha.slice(0, 7)}, current=${stagedSha.slice(0, 7)}`,
        );
        errors.push('Files may have changed since review. Re-run review.');
      }
      break;
    }

    case 'pre-push': {
      // pre-push: verify commit history includes reviewed SHA
      try {
        runSync('git', ['merge-base', '--is-ancestor', candidateSha, 'HEAD'], { cwd: ROOT });
      } catch {
        errors.push(`Candidate ${candidateSha.slice(0, 7)} not in current history`);
        errors.push('Reviewed commit may have been rebased or lost');
      }
      break;
    }

    case 'pre-pr': {
      // pre-pr: verify receipt matches both local and remote
      const currentTree = getTreeSha();
      const candidateTree = getTreeSha(candidateSha);

      if (currentTree !== candidateTree) {
        errors.push('Tree hash mismatch: files changed since review');
        errors.push('Re-run review on current state');
      }

      // Check for unreviewed commits
      try {
        const unreviewed = runSync(
          'git',
          ['log', `${candidateSha}..HEAD`, '--oneline', '--no-decorate'],
          { cwd: ROOT },
        ).stdout.trim();

        if (unreviewed) {
          const count = unreviewed.split('\n').filter((l) => l).length;
          errors.push(`${count} unreviewed commits since ${candidateSha.slice(0, 7)}`);
        }
      } catch {
        // No unreviewed commits (or other error)
      }
      break;
    }

    case 'release': {
      // release: strict validation, no changes allowed
      const releaseTree = getTreeSha();
      const reviewTree = getTreeSha(candidateSha);

      if (releaseTree !== reviewTree) {
        errors.push('CRITICAL: Tree hash mismatch at release gate');
        errors.push('Release candidate differs from reviewed state');
      }

      if (!receipt.approved) {
        errors.push('Receipt not approved. Cannot release unreviewed code.');
      }

      // Verify no critical findings
      const criticalCount =
        (receipt as any).findings?.filter((f: any) => f.severity === 'critical').length || 0;

      if (criticalCount > 0) {
        errors.push(`${criticalCount} critical findings must be resolved before release`);
      }
      break;
    }
  }

  const valid = errors.length === 0;

  if (valid) {
    log(`Gate ${gate}: PASSED`, 'SUCCESS');
  } else {
    log(`Gate ${gate}: FAILED with ${errors.length} error(s)`, 'ERROR');
  }

  // Record validation
  recordValidation(gate, valid, receipt.id, candidateSha, currentSha, errors, warnings);

  return {
    gate,
    valid,
    receiptId: receipt.id,
    candidateSha,
    currentSha,
    errors,
    warnings,
    timestamp: new Date().toISOString(),
  };
}

function recordValidation(
  gate: DeliveryGate,
  valid: boolean,
  receiptId: string,
  candidateSha: string,
  currentSha: string,
  errors: string[],
  warnings: string[],
): void {
  mkdirSync(GATES_DIR, { recursive: true });

  const validation: GateValidation = {
    gate,
    valid,
    receiptId,
    candidateSha,
    currentSha,
    errors,
    warnings,
    timestamp: new Date().toISOString(),
  };

  const fileName = `${gate}-${Date.now()}.json`;
  writeFileSync(join(GATES_DIR, fileName), JSON.stringify(validation, null, 2));
}

// ─── Git Hooks Integration ─────────────────────────────────────────────────────

export function installGitHooks(): void {
  const hooksDir = join(ROOT, '.git', 'hooks');

  if (!existsSync(hooksDir)) {
    log('Not a git repository or no .git directory found', 'ERROR');
    return;
  }

  // pre-commit hook
  const preCommitHook = `#!/bin/sh
# RDD pre-commit gate
npm run rdd:gate -- pre-commit || exit 1
`;

  // pre-push hook
  const prePushHook = `#!/bin/sh
# RDD pre-push gate
npm run rdd:gate -- pre-push || exit 1
`;

  writeFileSync(join(hooksDir, 'pre-commit'), preCommitHook);
  writeFileSync(join(hooksDir, 'pre-push'), prePushHook);

  // Make executable (Unix only)
  try {
    runSyncShell(`chmod +x ${join(hooksDir, 'pre-commit')} ${join(hooksDir, 'pre-push')}`);
  } catch {
    // Windows doesn't need chmod
  }

  log('Git hooks installed: pre-commit, pre-push', 'SUCCESS');
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const action = args[0] ?? 'validate';

    try {
      switch (action) {
        case 'validate': {
          const gate = (args[1] as DeliveryGate) || 'pre-commit';
          const receiptId = args.find((a) => a.startsWith('--receipt='))?.split('=')[1];

          if (!GATE_CONFIGS[gate]) {
            console.error(`Unknown gate: ${gate}`);
            console.error('Valid gates: post-apply, pre-commit, pre-push, pre-pr, release');
            process.exit(1);
          }

          const result = validateGate(gate, receiptId);

          if (args.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`\nGate: ${gate}`);
            console.log(`Valid: ${result.valid ? 'YES' : 'NO'}`);
            console.log(`Receipt: ${result.receiptId || 'none'}`);
            console.log(`Candidate SHA: ${result.candidateSha.slice(0, 7) || 'n/a'}`);
            console.log(`Current SHA: ${result.currentSha.slice(0, 7)}`);

            if (result.errors.length > 0) {
              console.log('\nErrors:');
              result.errors.forEach((e) => console.log(`  ✗ ${e}`));
            }

            if (result.warnings.length > 0) {
              console.log('\nWarnings:');
              result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
            }
          }

          process.exit(result.valid ? 0 : 1);
        }

        case 'install-hooks': {
          installGitHooks();
          break;
        }

        case 'status': {
          // Show last validation for each gate
          const gates: DeliveryGate[] = [
            'post-apply',
            'pre-commit',
            'pre-push',
            'pre-pr',
            'release',
          ];

          console.log('RDD Gate Status:\n');

          for (const gate of gates) {
            const config = GATE_CONFIGS[gate];
            console.log(
              `${gate.toUpperCase().padEnd(12)} ${config.required ? '[REQ]' : '[OPT]'} ${config.blockOnFailure ? '[BLOCK]' : '[WARN]'}`,
            );
          }

          console.log('\nLast validations:');

          if (!existsSync(GATES_DIR)) {
            console.log('  No validations recorded');
          } else {
            // Find latest for each gate
            for (const gate of gates) {
              try {
                const files = runSyncShell(`ls -t ${gate}-*.json 2>/dev/null || echo ""`, {
                  cwd: GATES_DIR,
                }).stdout.trim();

                if (files) {
                  const latestFile = files.split('\n')[0];
                  const validation: GateValidation = JSON.parse(
                    readFileSync(join(GATES_DIR, latestFile), 'utf-8'),
                  );

                  const status = validation.valid ? '✓ PASS' : '✗ FAIL';
                  const time = new Date(validation.timestamp).toLocaleTimeString();
                  console.log(`  ${gate.padEnd(12)} ${status} at ${time}`);
                } else {
                  console.log(`  ${gate.padEnd(12)} — no validation`);
                }
              } catch {
                console.log(`  ${gate.padEnd(12)} — error reading`);
              }
            }
          }
          break;
        }

        default:
          console.log('Usage: rdd-gates.ts <action> [options]');
          console.log('');
          console.log('Actions:');
          console.log('  validate <gate> [--receipt=<id>] [--json]');
          console.log('  install-hooks       Install git hooks for pre-commit/pre-push');
          console.log('  status              Show gate status and recent validations');
          console.log('');
          console.log('Gates: post-apply, pre-commit, pre-push, pre-pr, release');
          console.log('');
          console.log('Examples:');
          console.log('  npx tsx src/rdd/rdd-gates.ts validate pre-commit');
          console.log('  npx tsx src/rdd/rdd-gates.ts validate pre-push --receipt=rcpt-123456');
          process.exit(1);
      }
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
      process.exit(1);
    }
  })();
}
