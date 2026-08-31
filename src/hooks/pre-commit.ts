#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync, runNpxTsxSync } from '../../adapters/command-runner.js';
import { join, basename } from 'path';

interface CriticalPattern {
  name: string;
  pattern: RegExp;
}

const CRITICAL_PATTERNS: CriticalPattern[] = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'Private Key', pattern: /-----BEGIN.*PRIVATE KEY-----/ },
  {
    name: 'Generic API Key',
    pattern: /(api[_-]?key|apikey)["\s]*[=:]["\s]*["'][A-Za-z0-9]{20,}["']/i,
  },
  { name: 'Database URL', pattern: /(mysql|postgres|mongodb):\/\/[^:]+:[^@]+@/i },
  { name: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/ },
];

const EXCLUDED_PATHS = new Set([
  'docs/reference/ARCHITECTURE.md',
  'src/hooks/pre-commit.ts',
  'src/hooks/pre-commit-privacy.ts',
  'src/security/check-security.ts',
  'src/cli/gv.ts',
  'skills/docker-devops-skill/SKILL.md',
  'skills/security-expert-skill/references/security-patterns.md',
  'config/security-privacy.json',
  'config/security-policy.json',
]);

function execGit(args: string[], cwd?: string): string {
  const r = runSync('git', args, { cwd: cwd ?? process.cwd() });
  return (r.stdout ?? '').toString().trim();
}

/** Run a script via npx tsx if TS exists, else pwsh if PS1 exists. Returns true on success. */
function runScript(scriptPath: string, cwd?: string): boolean {
  const tsPath = scriptPath.replace(/\.ps1$/i, '.ts').replace(/^scripts\//, 'src/');
  const tsFull = join(cwd || process.cwd(), tsPath);

  // Try TS first
  if (existsSync(tsFull)) {
    const r = runNpxTsxSync(tsPath, [], { cwd: cwd ?? process.cwd() });
    return r.status === 0;
  }

  // PS1 fallback
  if (existsSync(scriptPath)) {
    const result = runSync('pwsh', ['-NoProfile', '-File', scriptPath], {
      cwd: cwd ?? process.cwd(),
      stdio: 'inherit',
    });
    return result.status === 0;
  }

  console.log(`[SKIP] ${scriptPath} not found (no TS or PS1)`);
  return true; // non-blocking skip
}

function main(_args?: string[]): number {
  const cwd = process.cwd();
  const gitRoot = execGit(['rev-parse', '--show-toplevel'], cwd);
  if (!gitRoot) {
    console.log('[SKIP] Not in a git repository.');
    return 0;
  }

  console.log('');
  console.log('==========================================');
  console.log(' Gentle-Vanguard - Development Stack - Pre-commit');
  console.log('==========================================');
  console.log('');

  // Engram integrity check
  console.log('[PRE] Engram integrity verification...');
  const engramHook = join(gitRoot, 'src', 'knowledge', 'engram-integrity-check.ts');
  if (existsSync(engramHook)) {
    const engramOk = runScript(
      join(gitRoot, 'src', 'knowledge', 'engram-integrity-check.ts'),
      gitRoot,
    );
    if (!engramOk) return 1;
  } else {
    console.log('[SKIP] Engram integrity check not available');
  }

  // Run checks that have real TypeScript implementations. The former PS1
  // dimension scripts were removed during the migration; silently skipping
  // them made the hook look healthy while providing no coverage.
  console.log('[INFO] Running core checks...');

  const checks = [
    {
      ts: 'src/security/check-security.ts',
      ps1: 'src/security/check-security.ts',
      blocking: true,
      label: 'Security',
    },
  ];

  for (const check of checks) {
    const checkPathTs = check.ts ? join(gitRoot, check.ts) : '';
    const checkPathPs1 = join(gitRoot, check.ps1);

    if (checkPathTs && existsSync(checkPathTs)) {
      const ok = runScript(checkPathTs, gitRoot);
      if (!ok && check.blocking) return 1;
      if (!ok && !check.blocking) {
        console.log(`[WARN] ${check.label} check produced warnings`);
      }
    } else if (existsSync(checkPathPs1)) {
      const ok = runScript(checkPathPs1, gitRoot);
      if (!ok && check.blocking) return 1;
      if (!ok && !check.blocking) {
        console.log(`[WARN] ${check.label} check produced warnings`);
      }
    } else {
      console.log(`[SKIP] ${check.label} check not found`);
    }
  }

  console.log('[OK] Core checks completed.');
  console.log('');

  // README governance validation
  const stagedRaw = execGit(['diff', '--cached', '--name-only', '--diff-filter=ACM'], gitRoot);
  const stagedFiles = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];

  let readmeChanged = false;
  for (const f of stagedFiles) {
    if (basename(f) === 'README.md') {
      readmeChanged = true;
      break;
    }
  }

  if (readmeChanged) {
    console.log('[INFO] README.md changes detected - running governance validation...');

    // Try TS first
    const validateTs = join(gitRoot, 'src', 'tools', 'validate-readme.ts');
    if (existsSync(validateTs)) {
      const r = runNpxTsxSync('src/tools/validate-readme.ts', ['--repo', 'both'], { cwd: gitRoot });
      if (r.status !== 0) {
        console.log('[BLOCK] README governance validation failed. See rules/README-GOVERNANCE.md');
        return 1;
      }
      console.log('[OK] README governance validation passed');
    } else {
      // PS1 fallback
      const validateScript = join(
        gitRoot,
        'scripts',
        'utilities',
        'validate',
        'validate-readme.ps1',
      );
      if (!existsSync(validateScript)) {
        console.log('[WARN] validate-readme not found - skipping governance check');
      } else {
        const r = runSync(
          'pwsh',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', validateScript, '-Repo', 'both'],
          { cwd: gitRoot },
        );
        if (r.status !== 0) {
          console.log(
            '[BLOCK] README governance validation failed. See rules/README-GOVERNANCE.md',
          );
          return 1;
        }
        console.log('[OK] README governance validation passed');
      }
    }
  }

  // Secret scan
  if (!stagedRaw) {
    console.log('[OK] No files staged for commit.');
    return 0;
  }

  console.log('Scanning staged files...');
  console.log('');

  let secretFound = false;

  for (const file of stagedFiles) {
    if (EXCLUDED_PATHS.has(file)) continue;

    const content = execGit(['show', `:0:${file}`], gitRoot);
    if (!content) continue;

    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.pattern.test(content)) {
        console.log(`[CRITICAL] ${pattern.name} detected in: ${file}`);
        secretFound = true;
      }
    }
  }

  if (secretFound) {
    console.log('');
    console.log('==========================================');
    console.log(' COMMIT BLOCKED - Secrets detected!');
    console.log('==========================================');
    console.log('');
    return 1;
  }

  // Document analysis
  const docHookTs = join(gitRoot, 'src', 'document-analysis-init.ts');
  if (existsSync(docHookTs)) {
    try {
      const r = runNpxTsxSync('src/tools/document-analysis-init.ts', [], { cwd: gitRoot });
      if (r.status !== 0) {
        console.log('[WARN] Document analysis hook failed (non-blocking)');
      }
    } catch (e) {
      console.log(`[WARN] Document analysis hook: ${e}`);
    }
  } else {
    console.log('[SKIP] Document analysis not available');
  }

  console.log('[OK] Pre-commit checks passed!');
  console.log('');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

export { main as preCommit };
