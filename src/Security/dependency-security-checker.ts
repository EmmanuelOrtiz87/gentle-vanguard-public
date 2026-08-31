#!/usr/bin/env node

/**
 * Security policy checker for dependencies
 * Runs a REAL `pnpm audit --json` (fallback `npm audit --json`) and reports
 * high/critical vulnerabilities found in the dependency tree.
 *
 * Replaces the previous mock that always reported `compliant: true`.
 */

import { runSyncShell } from '../core/run-command.js';

export interface DependencySecurityResult {
  compliant: boolean;
  issues?: string[];
  recommendations?: string[];
  /** Real audit data: { source, high, critical, moderate, low, total } */
  audit?: {
    source: 'pnpm' | 'npm' | 'none';
    high: number;
    critical: number;
    moderate: number;
    low: number;
    total: number;
  };
}

function parseAuditOutput(output: string): {
  high: number;
  critical: number;
  moderate: number;
  low: number;
  total: number;
} {
  const counts = { high: 0, critical: 0, moderate: 0, low: 0, total: 0 };

  try {
    const parsed = JSON.parse(output);

    // pnpm v9+ shape: { metadata: { vulnerabilities: { high, critical, moderate, low } } }
    const meta = parsed.metadata?.vulnerabilities;
    if (meta && typeof meta === 'object') {
      counts.high = Number(meta.high ?? 0);
      counts.critical = Number(meta.critical ?? 0);
      counts.moderate = Number(meta.moderate ?? 0);
      counts.low = Number(meta.low ?? 0);
      counts.total = Object.keys(meta).reduce(
        (sum: number, k: string) => sum + Number(meta[k] ?? 0),
        0,
      );
      return counts;
    }

    // npm legacy shape: { vulnerabilities: { high: { length }, ... } }
    const legacy = parsed.vulnerabilities;
    if (legacy && typeof legacy === 'object') {
      counts.high = Number(legacy.high?.length ?? 0);
      counts.critical = Number(legacy.critical?.length ?? 0);
      counts.moderate = Number(legacy.moderate?.length ?? 0);
      counts.low = Number(legacy.low?.length ?? 0);
      counts.total =
        (legacy.high?.length ?? 0) +
        (legacy.critical?.length ?? 0) +
        (legacy.moderate?.length ?? 0) +
        (legacy.low?.length ?? 0);
      return counts;
    }

    // npm newer shape: { metadata: { vulnerabilities: { info, low, moderate, high, critical } } } (counts directly)
    const meta2 = parsed.metadata?.vulnerabilities;
    if (meta2 && typeof meta2 === 'object') {
      counts.high = Number(meta2.high ?? 0);
      counts.critical = Number(meta2.critical ?? 0);
      counts.moderate = Number(meta2.moderate ?? 0);
      counts.low = Number(meta2.low ?? 0);
      counts.total = Object.keys(meta2).reduce(
        (sum: number, k: string) => sum + Number(meta2[k] ?? 0),
        0,
      );
      return counts;
    }
  } catch {
    // Fall through to text parsing below.
  }

  // Legacy text output: "found 3 vulnerabilities (2 high, 1 critical)"
  const highMatch = output.match(/(\d+)\s+high/);
  const criticalMatch = output.match(/(\d+)\s+critical/);
  const moderateMatch = output.match(/(\d+)\s+moderate/);
  const lowMatch = output.match(/(\d+)\s+low/);
  const totalMatch = output.match(/found\s+(\d+)\s+vulnerabilit/);

  counts.high = highMatch ? Number(highMatch[1]) : 0;
  counts.critical = criticalMatch ? Number(criticalMatch[1]) : 0;
  counts.moderate = moderateMatch ? Number(moderateMatch[1]) : 0;
  counts.low = lowMatch ? Number(lowMatch[1]) : 0;
  counts.total = totalMatch
    ? Number(totalMatch[1])
    : counts.high + counts.critical + counts.moderate + counts.low;

  return counts;
}

/**
 * Run a real dependency security audit (pnpm audit --json, fallback npm audit --json).
 * Never throws: network/CLI failures surface as a non-compliant result with a clear issue.
 */
export function checkDependencySecurity(): DependencySecurityResult {
  const issues: string[] = [];
  const recommendations: string[] = [];

  const attempts: Array<{ source: 'pnpm' | 'npm'; cmd: string }> = [
    { source: 'pnpm', cmd: 'pnpm audit --json' },
    { source: 'npm', cmd: 'npm audit --json' },
  ];

  for (const attempt of attempts) {
    try {
      const result = runSyncShell(attempt.cmd, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      const output = result.stdout || '';
      const counts = parseAuditOutput(output);

      const highCritical = counts.high + counts.critical;
      const compliant = highCritical === 0;

      if (!compliant) {
        issues.push(
          `${counts.critical} critical + ${counts.high} high severity vulnerabilities found (${counts.total} total)`,
        );
        recommendations.push(
          `Run "pnpm audit fix" (or "npm audit fix") and address all high/critical vulnerabilities`,
        );
      }

      return {
        compliant,
        issues: issues.length > 0 ? issues : undefined,
        recommendations: recommendations.length > 0 ? recommendations : undefined,
        audit: { source: attempt.source, ...counts },
      };
    } catch (error: unknown) {
      // Try the next package manager if available
      if (attempt.source === 'npm') {
        issues.push(
          `Audit command failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        recommendations.push(
          'Ensure pnpm/npm is installed and the registry is reachable, then re-run the audit',
        );
      }
    }
  }

  // Both package managers unavailable or errored — fail open with a clear issue
  return {
    compliant: false,
    issues: issues.length > 0 ? issues : ['No package manager audit could be executed'],
    recommendations:
      recommendations.length > 0 ? recommendations : ['Install pnpm or npm and re-run'],
    audit: { source: 'none', high: 0, critical: 0, moderate: 0, low: 0, total: 0 },
  };
}

// If called directly, run the check
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = checkDependencySecurity();
  console.log(JSON.stringify(result, null, 2));
}
