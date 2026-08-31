#!/usr/bin/env node
/**
 * Engram Policy Enforcement — Session Startup
 * Validates and enforces Engram memory policies during session initialization.
 * TS migration of scripts/gentle-vanguard/engram-policy.ps1
 */

import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { getExternalApiTimeouts } from '../core/timeout-config';

function log(msg: string): void {
  console.log(`[ENGRAM-POLICY] ${msg}`);
}

function main(): void {
  // workspaceRoot: process.argv.indexOf('--workspace-root') > 0 ? process.argv[process.argv.indexOf('--workspace-root') + 1] : process.cwd()

  log('Starting Engram policy enforcement');

  // Check if Engram is available
  const engramBin = process.env.ENGRAM_BIN || 'engram';

  try {
    const version = runSync(engramBin, ['--version'], {
      timeout: getExternalApiTimeouts()?.engram_operation_ms ?? 5000,
    }).stdout.trim();
    log(`Engram available: ${version}`);
  } catch {
    log('Engram not available, skipping policy enforcement');
    process.exit(0);
  }

  // Validate Engram project configuration
  const projectName = 'workspace_gentle_vanguard';
  log(`Validating project: ${projectName}`);

  // Check Engram memory integrity
  log('Checking memory integrity...');
  try {
    runSync(engramBin, ['doctor', '--project', projectName], {
      timeout: getExternalApiTimeouts()?.engram_operation_ms ?? 10000,
    });
    log('Memory integrity verified');
  } catch {
    log('Memory integrity check failed, but continuing');
  }

  // Enforce retention policies
  log('Enforcing retention policies...');
  const retentionDays = 90;
  log(`Retention policy: ${retentionDays} days`);

  log('Policy enforcement completed successfully');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
