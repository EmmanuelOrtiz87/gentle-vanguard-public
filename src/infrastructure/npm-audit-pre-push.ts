#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

interface VulnCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

interface AuditResult {
  metadata: {
    vulnerabilities: VulnCounts;
  };
  advisories?: Record<
    string,
    {
      module_name: string;
      severity: string;
      github_advisory_id: string;
    }
  >;
}

const VALID_LEVELS = ['critical', 'high', 'moderate', 'low'] as const;
type AuditLevel = (typeof VALID_LEVELS)[number];

const BLOCK_LEVELS: Record<AuditLevel, AuditLevel[]> = {
  critical: ['critical'],
  high: ['critical', 'high'],
  moderate: ['critical', 'high', 'moderate'],
  low: ['critical', 'high', 'moderate', 'low'],
};

/**
 * Allowlist of advisories with NO available fix (patched version does not exist
 * in the npm registry). These are documented exceptions: the hook will NOT block
 * when the ONLY blocking advisories are in this list.
 *
 * image-size (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq):
 *   - Affects image-size@<=2.0.2 (transitive via pptxgenjs, devDependency only)
 *   - Patched version is >=2.0.3, but that version is NOT published on npm
 *     (latest is 2.0.2). Overrides are therefore impossible.
 *   - DoS (CWE-835) in ICNS/JXL/HEIF parsers; only used at build time for
 *     presentation generation, not in production runtime.
 *   - REVISIT when image-size@>=2.0.3 is published, then remove from this list.
 */
const ALLOWLISTED_ADVISORIES = new Set<string>(['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq']);

function parseArgs(): { auditLevel: AuditLevel; verbose: boolean } {
  const args = process.argv.slice(2);
  let auditLevel: AuditLevel = 'moderate';
  let verbose = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--audit-level' && args[i + 1]) {
      const level = args[i + 1].toLowerCase() as AuditLevel;
      if (VALID_LEVELS.includes(level)) {
        auditLevel = level;
      }
      i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    }
  }
  return { auditLevel, verbose };
}

function main(): number {
  const { auditLevel, verbose } = parseArgs();
  const cwd = process.cwd();

  // Detect package manager: pnpm (pnpm-lock.yaml) vs npm (package-lock.json)
  const isPnpm = existsSync('pnpm-lock.yaml');
  const pm = isPnpm ? 'pnpm' : 'npm';
  console.log(`\n[npm-audit] Running ${pm} vulnerability scan...`);

  if (!existsSync('package.json')) {
    console.log(`[npm-audit] No package.json found, skipping audit`);
    return 0;
  }

  const auditResult = runSync(pm, ['audit', '--json'], {
    cwd,
  });

  let audit: AuditResult | null = null;
  try {
    audit = JSON.parse(auditResult.stdout || '{}') as AuditResult;
  } catch {
    // JSON parse failure
  }

  if (!audit || !audit.metadata?.vulnerabilities) {
    console.log(`[npm-audit] Invalid audit JSON, retrying with text output...`);
    const textResult = runSync(pm, ['audit'], {
      cwd,
    });
    console.log(textResult.stdout || textResult.stderr);

    if (textResult.status !== 0 && /vulnerabilities/i.test(textResult.stdout)) {
      console.log(`[BLOCKED] ${pm} audit found vulnerabilities`);
      console.log(`\nTo fix vulnerabilities:`);
      console.log(`  ${pm} audit fix`);
      console.log(`  ${pm} audit fix --force  (if needed)`);
      return 1;
    }
    return 0;
  }

  const vulnerabilities = audit.metadata.vulnerabilities;

  if (verbose) {
    console.log(`[npm-audit] Vulnerability summary:`);
    console.log(`  Critical:  ${vulnerabilities.critical}`);
    console.log(`  High:      ${vulnerabilities.high}`);
    console.log(`  Moderate:  ${vulnerabilities.moderate}`);
    console.log(`  Low:       ${vulnerabilities.low}`);
  }

  const hasBlockingVuln = BLOCK_LEVELS[auditLevel].some((level) => vulnerabilities[level] > 0);

  if (hasBlockingVuln) {
    // Collect the advisory IDs that are at/above the blocking level.
    const blockingAdvisories = Object.entries(audit.advisories ?? {})
      .filter(([, adv]) => BLOCK_LEVELS[auditLevel].includes(adv.severity as AuditLevel))
      .map(([, adv]) => adv.github_advisory_id);

    // If EVERY blocking advisory is allowlisted (no fix available), do not block.
    if (
      blockingAdvisories.length > 0 &&
      blockingAdvisories.every((id) => ALLOWLISTED_ADVISORIES.has(id))
    ) {
      console.log(
        `[OK] npm audit passed (audit-level: ${auditLevel}) — ${blockingAdvisories.length} allowlisted advisory(ies) with no available fix:`,
      );
      for (const id of blockingAdvisories) {
        console.log(`  - ${id}`);
      }
      return 0;
    }

    console.log(`\n[BLOCKED] npm audit found vulnerabilities at ${auditLevel} level or above`);
    console.log(`\nTo fix:`);
    console.log(`  1. Run: npm audit fix`);
    console.log(`  2. Review changes to package-lock.json`);
    console.log(`  3. Test changes: npm test`);
    console.log(
      `  4. Commit: git add package-lock.json && git commit -m 'fix(security): resolve npm vulnerabilities'`,
    );
    console.log(`  5. Push again`);
    console.log(`\nFor force push (not recommended):`);
    console.log(`  git push --no-verify`);
    return 1;
  }

  console.log(`[OK] npm audit passed (audit-level: ${auditLevel})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as npmAuditPrePush };
