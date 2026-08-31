#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

interface Pattern {
  name: string;
  pattern: RegExp;
}

interface Violation {
  File: string;
  Pattern: string;
  Line?: number | string;
}

interface Violations {
  Critical: Violation[];
  MachineId: Violation[];
  UserId: Violation[];
}

const CRITICAL_PATTERNS: Pattern[] = [
  { name: 'AWS Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'Private Key', pattern: /-----BEGIN (RSA|EC|DSA|PRIVATE) KEY-----/ },
  { name: 'AWS Secret', pattern: /aws_secret_access_key/ },
  { name: 'SendGrid Key', pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
];

const EXCLUDED_PATHS = new Set([
  'config/security-privacy.json',
  'config/security-policy.json',
  'src/hooks/pre-commit-privacy.ts',
  'src/hooks/pre-commit.ts',
  'src/security/check-security.ts',
  'docs/reference/ARCHITECTURE.md',
  'src/cli/gv.ts',
  'skills/docker-devops-skill/SKILL.md',
  'skills/security-expert-skill/references/security-patterns.md',
]);

const MACHINE_PATTERNS: Pattern[] = [
  { name: 'ComputerName', pattern: /\$env:COMPUTERNAME/ },
  { name: 'UserProfile Path', pattern: /C:\\Users\\[^\\]+/ },
  { name: 'Unix Home', pattern: /\/home\/[^/]+/ },
  { name: 'Machine Ref', pattern: /\[System\.Environment\]::MachineName/ },
];

const USER_PATTERNS: Pattern[] = [
  { name: 'Username Env', pattern: /\$env:USERNAME/ },
  { name: 'UserName Ref', pattern: /\[System\.Environment\]::UserName/ },
];

function findLineNumber(content: string, pattern: RegExp): number | string {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return '?';
}

function isExcluded(normalizedFile: string): boolean {
  for (const excluded of EXCLUDED_PATHS) {
    if (normalizedFile.includes(excluded)) return true;
  }
  return false;
}

function invokePrivacyScan(files: string[]): Violations {
  const violations: Violations = { Critical: [], MachineId: [], UserId: [] };

  for (const file of files) {
    if (!existsSync(file)) continue;
    if (statSync(file).isDirectory()) continue;

    const normalizedFile = file.replace(/\\/g, '/');
    if (isExcluded(normalizedFile)) continue;

    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    for (const p of CRITICAL_PATTERNS) {
      if (p.pattern.test(content)) {
        violations.Critical.push({
          File: file,
          Pattern: p.name,
          Line: findLineNumber(content, p.pattern),
        });
      }
    }

    for (const p of MACHINE_PATTERNS) {
      if (p.pattern.test(content)) {
        violations.MachineId.push({ File: file, Pattern: p.name });
      }
    }

    for (const p of USER_PATTERNS) {
      if (p.pattern.test(content)) {
        violations.UserId.push({ File: file, Pattern: p.name });
      }
    }
  }

  return violations;
}

function main(args: string[]): number {
  const staged = args.includes('--staged');
  const filePaths = args.filter((a) => !a.startsWith('--') && !a.startsWith('-'));

  console.log('=== PRE-COMMIT PRIVACY SCAN ===');

  let files: string[];

  if (staged) {
    const result = runSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']);
    files = result.stdout ? result.stdout.trim().split('\n').filter(Boolean) : [];
  } else {
    files = filePaths;
  }

  if (files.length === 0) {
    console.log('No files to scan');
    return 0;
  }

  console.log(`Scanning ${files.length} files...`);

  const violations = invokePrivacyScan(files);

  if (violations.Critical.length > 0) {
    console.log('\n=== CRITICAL VIOLATIONS - COMMIT BLOCKED ===');
    for (const v of violations.Critical) {
      console.log(`  FILE: ${v.File}`);
      console.log(`  PATTERN: ${v.Pattern} at line ${v.Line}`);
      console.log('');
    }
    console.log('These patterns indicate hardcoded credentials or secrets.');
    console.log('Move secrets to environment variables or .env files.');
    console.log('Use: .gitignore to exclude .env from commits.');
    return 1;
  }

  const warnings = violations.MachineId.length + violations.UserId.length;

  if (warnings > 0) {
    console.log('\n=== PRIVACY WARNINGS ===');
    for (const v of violations.MachineId) {
      console.log(`  [MACHINE] ${v.File}: ${v.Pattern}`);
    }
    for (const v of violations.UserId) {
      console.log(`  [USER] ${v.File}: ${v.Pattern}`);
    }
    console.log('\nRecommendation: Use generic placeholders instead of machine-specific values.');
  }

  console.log('\n[OK] Privacy scan passed');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

export { main as preCommitPrivacy };
