#!/usr/bin/env node
/**
 * Process Exit Fixer
 *
 * Automatically replaces process.exit() calls with proper error throwing
 * in critical pipeline files to prevent breaking the session-autostart pipeline.
 *
 * Usage: npx tsx src/fix-process-exits.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

// Files that are part of the pipeline and need fixing
const CRITICAL_FILES = [
  'src/security-initializer.ts',
  'src/security/dependency-security-initializer.ts',
  'src/session-manager.ts',
  'src/session-reference-system.ts',
  'src/session-scoring.ts',
  'src/safety-guardrails.ts',
  'src/system-check.ts',
];

interface FixResult {
  file: string;
  fixed: number;
  errors: string[];
}

function fixProcessExits(filePath: string, dryRun: boolean): FixResult {
  const fullPath = join(ROOT, filePath);
  const result: FixResult = { file: filePath, fixed: 0, errors: [] };

  if (!existsSync(fullPath)) {
    result.errors.push('File not found');
    return result;
  }

  let content = readFileSync(fullPath, 'utf-8');
  const originalContent = content;

  // Pattern 1: process.exit(0) at end of main function - replace with return
  content = content.replace(
    /(main\(\)\s*\.then\([^)]+\)\s*\.catch\([^)]+\)\s*);\s*process\.exit\(0\);/g,
    '$1;',
  );

  // Pattern 2: process.exit(1) in catch blocks - replace with throw
  content = content.replace(/catch\s*\([^)]*\)\s*\{[^}]*process\.exit\(1\);/g, (match) =>
    match.replace('process.exit(1);', 'throw new Error("Process failed");'),
  );

  // Pattern 3: Direct process.exit(1) in main - wrap in try-catch or replace
  content = content.replace(
    /if\s*\([^)]+\)\s*\{[^}]*console\.error\([^)]+\);\s*process\.exit\(1\);\s*\}/g,
    (match) => {
      // Replace with throw instead of exit
      return match.replace(/process\.exit\(1\);/, 'throw new Error("Validation failed");');
    },
  );

  // Pattern 4: process.exit() at module level in CLI check
  content = content.replace(
    /if\s*\(process\.argv\[1\]\s*&&\s*import\.meta\.url[^)]+\)\s*\{[^}]*\}\s*$/gm,
    (match) => {
      // Remove any process.exit() inside the if block
      return match.replace(/process\.exit\([^)]*\);/g, '');
    },
  );

  // Pattern 5: Simple process.exit(0) or process.exit(1)
  content = content.replace(/^\s*process\.exit\([01]\);?\s*$/gm, '');

  // Count changes
  const changes =
    (originalContent.match(/process\.exit\(/g) || []).length -
    (content.match(/process\.exit\(/g) || []).length;
  result.fixed = changes;

  if (!dryRun && changes > 0) {
    writeFileSync(fullPath, content);
  }

  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(`\n=== Process Exit Fixer ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  const results: FixResult[] = [];
  let totalFixed = 0;

  for (const file of CRITICAL_FILES) {
    const result = fixProcessExits(file, dryRun);
    results.push(result);
    totalFixed += result.fixed;

    if (result.fixed > 0) {
      console.log(`✅ ${file}: Fixed ${result.fixed} process.exit() calls`);
    } else if (result.errors.length === 0) {
      console.log(`⏭️  ${file}: No changes needed`);
    } else {
      console.log(`❌ ${file}: ${result.errors.join(', ')}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total files processed: ${CRITICAL_FILES.length}`);
  console.log(`Total process.exit() calls ${dryRun ? 'would be' : ''} fixed: ${totalFixed}`);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes');
  }

  console.log();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { fixProcessExits, CRITICAL_FILES };
