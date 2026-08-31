#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

const CRITICAL_PATTERNS: SecretPattern[] = [
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

function execGit(args: string[], cwd: string = process.cwd()): string {
  const result = runSync('git', args, { cwd });
  return result.stdout?.trim() ?? '';
}

function main(): number {
  const cwd = process.cwd();
  const stagedRaw = execGit(['diff', '--cached', '--name-only', '--diff-filter=ACM'], cwd);
  if (!stagedRaw) {
    return 0;
  }

  let secretFound = false;
  const stagedFiles = stagedRaw.split('\n').filter(Boolean);

  for (const file of stagedFiles) {
    if (EXCLUDED_PATHS.has(file)) continue;

    const content = execGit(['show', `:0:${file}`], cwd);
    if (!content) continue;

    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.pattern.test(content)) {
        console.log(`[CRITICAL] ${pattern.name} detected in: ${file}`);
        secretFound = true;
      }
    }
  }

  if (existsSync('package.json')) {
    const auditResult = runSync('npm', ['audit', '--json'], { cwd });
    try {
      const audit = JSON.parse(auditResult.stdout || '{}');
      if (audit.metadata?.vulnerabilities?.critical > 0) {
        console.log(`[CRITICAL] Vulnerabilidades críticas detectadas en dependencias (npm audit)`);
        secretFound = true;
      }
    } catch {
      // JSON parse failure — skip audit check
    }
  }

  return secretFound ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as checkSecurity };
