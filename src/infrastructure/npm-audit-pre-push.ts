#!/usr/bin/env node

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
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

// Advisories verificados sin fix publicable en el registry — el gate no bloquea cuando
// TODOS los advisories bloqueantes están allowlisteados (ver lógica más abajo).
// - GHSA-vfj7-8cjw-p6xm (braces, stack-exhaustion DoS): el advisory declara patched >=3.0.4
//   pero 3.0.4 NO existe en el registry (latest 3.0.3, 2024-05). Transitive de secretlint/
//   tailwindcss/typescript-eslint (dev-only). Revisar cuando publique la versión parcheada.
const ALLOWLISTED_ADVISORIES = new Set<string>(['GHSA-vfj7-8cjw-p6xm']);

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

export function discoverAuditRoots(root: string): string[] {
  const appsRoot = join(root, 'apps');
  if (!existsSync(appsRoot)) return [root];

  const appRoots = readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(appsRoot, entry.name))
    .filter(
      (appRoot) =>
        existsSync(join(appRoot, 'package.json')) &&
        (existsSync(join(appRoot, 'pnpm-lock.yaml')) ||
          existsSync(join(appRoot, 'package-lock.json'))),
    )
    .sort();

  return [root, ...appRoots];
}

function sumVulnerabilities(results: AuditResult[]): VulnCounts {
  return results.reduce(
    (total, result) => ({
      critical: total.critical + result.metadata.vulnerabilities.critical,
      high: total.high + result.metadata.vulnerabilities.high,
      moderate: total.moderate + result.metadata.vulnerabilities.moderate,
      low: total.low + result.metadata.vulnerabilities.low,
    }),
    { critical: 0, high: 0, moderate: 0, low: 0 },
  );
}

function main(): number {
  const { auditLevel, verbose } = parseArgs();
  const cwd = process.cwd();

  const auditRoots = discoverAuditRoots(cwd);
  if (!existsSync(join(cwd, 'package.json'))) {
    console.log(`[npm-audit] No package.json found, skipping audit`);
    return 0;
  }

  const audits: AuditResult[] = [];
  for (const auditRoot of auditRoots) {
    const isPnpm = existsSync(join(auditRoot, 'pnpm-lock.yaml'));
    const pm = isPnpm ? 'pnpm' : 'npm';
    const relativeRoot = auditRoot === cwd ? '.' : auditRoot.slice(cwd.length + 1);
    console.log(`\n[npm-audit] Running ${pm} production vulnerability scan (${relativeRoot})...`);
    const args = isPnpm ? ['audit', '--prod', '--json'] : ['audit', '--omit=dev', '--json'];
    const auditResult = runSync(pm, args, { cwd: auditRoot });
    let audit: AuditResult | null = null;
    try {
      audit = JSON.parse(auditResult.stdout || '{}') as AuditResult;
    } catch {
      // JSON parse failure
    }
    if (!audit || !audit.metadata?.vulnerabilities) {
      console.log(`[npm-audit] Invalid audit JSON for ${relativeRoot}; retrying with text output...`);
      const textResult = runSync(pm, ['audit'], { cwd: auditRoot });
      console.log(textResult.stdout || textResult.stderr);
      if (textResult.status !== 0 && /vulnerabilities/i.test(textResult.stdout)) {
        console.log(`[BLOCKED] ${pm} audit found vulnerabilities in ${relativeRoot}`);
        return 1;
      }
      continue;
    }
    audits.push(audit);
  }

  const vulnerabilities = sumVulnerabilities(audits);

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
    const blockingAdvisories = audits.flatMap((audit) =>
      Object.entries(audit.advisories ?? {})
        .filter(([, adv]) => BLOCK_LEVELS[auditLevel].includes(adv.severity as AuditLevel))
        .map(([, adv]) => adv.github_advisory_id),
    );

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
