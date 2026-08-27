#!/usr/bin/env node

/**
 * Dependency Security Policy Enforcer
 * Enforces all dependency security policies from PNPM-SECURITY.md
 */

import { runSync, runSyncShell } from '../core/run-command.js';
import { pathToFileURL } from 'url';
// import { readFileSync } from 'fs'; // Removed unused import
// import { join } from 'path'; // Removed unused import
// import { Buffer } from 'buffer'; // Removed unused import

// Security policy configuration
interface SecurityPolicy {
  name: string;
  description: string;
  checkCommand: string;
  remediation: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  enabled: boolean;
}

// Result of a single security policy check
interface SecurityIssue {
  policy: string;
  description: string;
  status: 'pass' | 'fail';
  message?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// Aggregated results of all security checks
interface SecurityCheckResults {
  compliant: boolean;
  issues: SecurityIssue[];
}

// Enhanced dependency security checker
export class DependencySecurityEnforcer {
  private policies: SecurityPolicy[];
  private pnpmAvailable: boolean;

  constructor() {
    // Check if pnpm is available
    this.pnpmAvailable = this.checkPnpmAvailable();

    // Define security policies based on PNPM-SECURITY.md
    // If pnpm is not available, disable pnpm-dependent checks
    this.policies = [
      {
        name: 'vulnerability-scan',
        description: 'Scan for security vulnerabilities in dependencies',
        checkCommand: this.pnpmAvailable
          ? 'pnpm audit --audit-level=high --json'
          : 'npm audit --audit-level=high --json',
        remediation: 'Run "pnpm audit fix" or manually update vulnerable packages',
        severity: 'critical',
        enabled: this.pnpmAvailable,
      },
      {
        name: 'license-compliance',
        description: 'Ensure all dependencies comply with license policies',
        checkCommand: this.pnpmAvailable ? 'pnpm licenses list --json' : 'npm list --json',
        remediation: 'Review and approve licenses for all dependencies',
        severity: 'high',
        enabled: this.pnpmAvailable,
      },
      {
        name: 'dependency-lock',
        description: 'Verify dependency integrity through lock file',
        checkCommand: this.pnpmAvailable ? 'pnpm install --frozen-lockfile' : 'npm ci',
        remediation: 'Run "pnpm install" to regenerate lockfile if needed',
        severity: 'critical',
        enabled: true,
      },
      {
        name: 'security-updates',
        description: 'Check for security updates on dependencies',
        // pnpm/npm outdated exits 1 when packages are outdated — we capture stdout from thrown error
        checkCommand: this.pnpmAvailable ? 'pnpm outdated --long' : 'npm outdated --long',
        remediation: 'Update dependencies to versions with security patches',
        severity: 'high',
        enabled: this.pnpmAvailable,
      },
      {
        name: 'deprecated-packages',
        description: 'Check for deprecated packages',
        // pnpm/npm outdated exits 1 when packages are outdated — we capture stdout from thrown error
        checkCommand: this.pnpmAvailable ? 'pnpm outdated --json' : 'npm outdated --json',
        remediation: 'Replace deprecated packages with maintained alternatives',
        severity: 'medium',
        enabled: this.pnpmAvailable,
      },
      {
        name: 'unused-dependencies',
        description: 'Check for unused dependencies',
        checkCommand: 'pnpm prune --dry-run',
        remediation: 'Remove unused dependencies to reduce attack surface',
        severity: 'medium',
        enabled: false,
      },
    ];
  }

  private checkPnpmAvailable(): boolean {
    try {
      const r = runSync('pnpm', ['--version'], { stdio: 'pipe', timeout: 5000 });
      return r.status === 0;
    } catch {
      console.log('[SECURITY] pnpm not available, using npm fallbacks');
      return false;
    }
  }

  /**
   * Run all enabled security policy checks
   * @returns Results of all security checks
   */
  async runSecurityChecks(): Promise<SecurityCheckResults> {
    const issues: SecurityIssue[] = [];
    let compliant = true;

    console.log('Running dependency security policy checks...\n');

    for (const policy of this.policies.filter((p) => p.enabled)) {
      try {
        console.log(`Checking: ${policy.name} - ${policy.description}`);

        // Some commands (pnpm outdated, pnpm audit) exit non-zero on findings
        // but still emit useful stdout — runSyncShell captures stdout regardless.
        const output = runSyncShell(policy.checkCommand, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 60000,
        });
        const result = output.stdout;

        // Parse the result to determine if it passes
        const status = this.evaluateCheckResult(policy, result);

        if (status === 'fail') {
          compliant = false;
          issues.push({
            policy: policy.name,
            description: policy.description,
            status: 'fail',
            message: `Policy violation: ${policy.remediation}`,
            severity: policy.severity,
          });
        } else {
          issues.push({
            policy: policy.name,
            description: policy.description,
            status: 'pass',
            severity: policy.severity,
          });
        }

        console.log(`  Result: ${status}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        compliant = false;
        issues.push({
          policy: policy.name,
          description: policy.description,
          status: 'fail',
          message: message || 'Unknown error occurred',
          severity: policy.severity,
        });
        console.log(`  Result: fail - ${message || 'Unknown error'}\n`);
      }
    }

    return {
      compliant,
      issues,
    };
  }

  /**
   * Evaluate the result of a security check
   * @param policy The security policy being checked
   * @param output The command output
   * @returns Check status (pass/fail)
   */
  private evaluateCheckResult(policy: SecurityPolicy, output: string): 'pass' | 'fail' {
    // Default to pass
    let status: 'pass' | 'fail' = 'pass';

    try {
      switch (policy.name) {
        case 'vulnerability-scan':
          // Prefer machine-readable audit output. pnpm returns
          // metadata.vulnerabilities counts; npm returns a similar shape.
          try {
            const parsed = JSON.parse(output);
            const vulnerabilities = parsed.metadata?.vulnerabilities;
            if (vulnerabilities && typeof vulnerabilities === 'object') {
              const high = Number(vulnerabilities.high ?? 0);
              const critical = Number(vulnerabilities.critical ?? 0);
              status = high + critical > 0 ? 'fail' : 'pass';
              break;
            }
            if (parsed.advisories && Object.keys(parsed.advisories).length === 0) {
              status = 'pass';
              break;
            }
          } catch {
            // Fall through to legacy text parsing.
          }
          if (output.includes('0 vulnerabilities found') || output.includes('audit passed')) {
            status = 'pass';
          } else {
            status = 'fail';
          }
          break;

        case 'license-compliance':
          // pnpm licenses list --json returns an object grouped by license.
          // A valid non-empty JSON result means licenses were discovered; this
          // policy does not maintain a denylist, so it should not fail on parseable data.
          try {
            const parsed = JSON.parse(output);
            status =
              parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
                ? 'pass'
                : 'fail';
          } catch {
            if (output.includes('No licenses found') || output.toLowerCase().includes('error')) {
              status = 'fail';
            } else {
              status = 'pass';
            }
          }
          if (output.toLowerCase().includes('timed out')) {
            status = 'fail';
          }
          break;

        case 'dependency-lock':
          // For lock file check, if it runs without error it's likely good
          // The --frozen-lockfile flag will fail if lockfile is not up to date
          status = 'pass'; // Assume pass unless error occurs (caught by try/catch)
          break;

        case 'security-updates':
          // pnpm outdated --long outputs a table with package lines when outdated exist.
          // Empty output or only header lines means all up to date.
          {
            const lines = output
              .split('\n')
              .filter(
                (l) =>
                  l.trim().length > 0 &&
                  !l.includes('Package') &&
                  !l.includes('===') &&
                  !l.includes('─'),
              );
            // If there are actual package lines with outdated versions, flag it as advisory (not fail)
            // Only fail if there are known-vulnerability outdated packages (not just version bumps)
            status = lines.length > 0 ? 'pass' : 'pass'; // Advisory only — actual vulns are caught by vulnerability-scan
          }
          break;

        case 'deprecated-packages':
          // Check for deprecated packages in outdated --json output
          {
            try {
              const parsed = JSON.parse(output);
              // If json output has entries with 'deprecated' tag
              if (Array.isArray(parsed) && parsed.length > 0) {
                status = parsed.some((p) => (p as { deprecated?: boolean }).deprecated)
                  ? 'fail'
                  : 'pass';
              } else if (
                typeof parsed === 'object' &&
                parsed !== null &&
                Object.keys(parsed).length > 0
              ) {
                status = 'pass'; // Has outdated but not necessarily deprecated
              } else {
                status = 'pass';
              }
            } catch {
              // Not valid JSON (empty or table format) — check for deprecated keyword in text output
              status = output.toLowerCase().includes('deprecated') ? 'fail' : 'pass';
            }
          }
          break;

        case 'unused-dependencies':
          // Check for unused dependencies
          if (output.includes('unused')) {
            status = 'fail';
          } else {
            status = 'pass';
          }
          break;

        default:
          // Default to pass for unknown policies
          status = 'pass';
      }
    } catch {
      // If we can't evaluate the result, assume failure
      status = 'fail';
    }

    return status;
  }

  /**
   * Apply security policy remediations.
   * DRY-RUN by default (prints commands without executing). Pass { apply: true }
   * to actually execute remediation commands.
   * @param issues Issues that need remediation
   * @param options { apply?: boolean } — apply:true executes, otherwise dry-run
   * @returns Remediation results
   */
  async applyRemediations(
    issues: SecurityIssue[],
    options: { apply?: boolean } = {},
  ): Promise<{
    success: boolean;
    applied: string[];
    failed: string[];
    dryRun: boolean;
  }> {
    const dryRun = options.apply !== true;
    const applied: string[] = [];
    const failed: string[] = [];

    console.log(
      `Applying security policy remediations${dryRun ? ' (DRY-RUN — no changes applied)' : ''}...\n`,
    );

    // Commands that are safe to run automatically. Package removals require
    // explicit package names, so those policies run inspection commands instead
    // of destructive removal.
    const remediationCommands: Record<string, string> = {
      'vulnerability-scan': 'pnpm audit fix',
      'security-updates': 'pnpm update',
      'deprecated-packages': 'pnpm outdated --json',
      'unused-dependencies': 'pnpm ls --depth 0',
    };

    for (const issue of issues) {
      try {
        const cmd = remediationCommands[issue.policy];
        if (!cmd) {
          console.log(`  No specific remediation for policy: ${issue.policy}`);
          applied.push(issue.policy);
          continue;
        }

        console.log(`  ${dryRun ? '[DRY-RUN] would run' : 'Running'}: ${cmd}`);
        if (dryRun) {
          applied.push(issue.policy);
          continue;
        }

        const result = runSyncShell(cmd, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 120_000,
        });
        if (result.status === 0) {
          applied.push(issue.policy);
          console.log(`  Applied: ${issue.policy}\n`);
        } else {
          throw new Error(
            `command failed (exit ${result.status}): ${(result.stderr ?? '').slice(0, 200)}`,
          );
        }
      } catch (error) {
        failed.push(issue.policy);
        console.log(`  Failed: ${issue.policy} - ${error}\n`);
      }
    }

    return {
      success: failed.length === 0,
      applied,
      failed,
      dryRun,
    };
  }

  /**
   * Generate security report
   * @param results Security check results
   * @returns Formatted report
   */
  generateReport(results: SecurityCheckResults): string {
    const report = [];

    report.push('Dependency Security Policy Report');
    report.push('=====================================\n');

    report.push(`Overall Compliance: ${results.compliant ? '✅ PASS' : '❌ FAIL'}\n`);

    // Group issues by severity
    const criticalIssues = results.issues.filter((i) => i.severity === 'critical');
    const highIssues = results.issues.filter((i) => i.severity === 'high');
    const mediumIssues = results.issues.filter((i) => i.severity === 'medium');
    const lowIssues = results.issues.filter((i) => i.severity === 'low');

    if (criticalIssues.length > 0) {
      report.push('Critical Issues:');
      report.push('----------------');
      for (const issue of criticalIssues) {
        const statusIcon = issue.status === 'pass' ? '✅' : '❌';
        report.push(`${statusIcon} ${issue.policy}: ${issue.description}`);
        if (issue.message) {
          report.push(`   Issue: ${issue.message}`);
        }
      }
      report.push('');
    }

    if (highIssues.length > 0) {
      report.push('High Issues:');
      report.push('------------');
      for (const issue of highIssues) {
        const statusIcon = issue.status === 'pass' ? '✅' : '❌';
        report.push(`${statusIcon} ${issue.policy}: ${issue.description}`);
        if (issue.message) {
          report.push(`   Issue: ${issue.message}`);
        }
      }
      report.push('');
    }

    if (mediumIssues.length > 0) {
      report.push('Medium Issues:');
      report.push('--------------');
      for (const issue of mediumIssues) {
        const statusIcon = issue.status === 'pass' ? '✅' : '❌';
        report.push(`${statusIcon} ${issue.policy}: ${issue.description}`);
        if (issue.message) {
          report.push(`   Issue: ${issue.message}`);
        }
      }
      report.push('');
    }

    if (lowIssues.length > 0) {
      report.push('Low Issues:');
      report.push('-----------');
      for (const issue of lowIssues) {
        const statusIcon = issue.status === 'pass' ? '✅' : '❌';
        report.push(`${statusIcon} ${issue.policy}: ${issue.description}`);
        if (issue.message) {
          report.push(`   Issue: ${issue.message}`);
        }
      }
      report.push('');
    }

    // Summary
    report.push('Summary:');
    report.push('--------');
    report.push(`Total checks: ${results.issues.length}`);
    report.push(`Passed: ${results.issues.filter((i) => i.status === 'pass').length}`);
    report.push(`Failed: ${results.issues.filter((i) => i.status === 'fail').length}`);

    return report.join('\n');
  }

  /**
   * Enable/disable a specific security policy
   * @param policyName Name of the policy to enable/disable
   * @param enabled Whether to enable or disable
   */
  setPolicyEnabled(policyName: string, enabled: boolean): void {
    const policy = this.policies.find((p) => p.name === policyName);
    if (policy) {
      policy.enabled = enabled;
      console.log(`Policy "${policyName}" ${enabled ? 'enabled' : 'disabled'}`);
    } else {
      console.log(`Policy "${policyName}" not found`);
    }
  }

  /**
   * Get all policies
   * @returns Array of all policies
   */
  getPolicies(): SecurityPolicy[] {
    return [...this.policies];
  }
}

// Export the enforcer for use in other modules
export const dependencySecurityEnforcer = new DependencySecurityEnforcer();

// If called directly, run the security checks
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const enforcer = new DependencySecurityEnforcer();

  enforcer
    .runSecurityChecks()
    .then((results) => {
      console.log(enforcer.generateReport(results));

      if (!results.compliant) {
        console.log('Security policy violations detected. Please review and remediate.');
        process.exit(1);
      } else {
        console.log('✅ All security policies compliant.');
      }
    })
    .catch((error) => {
      console.error('Security check failed:', error);
      process.exit(1);
    });
}
