#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';

interface JsonLintResult {
  file: string;
  valid: boolean;
  error?: string;
}

interface CliArgs {
  paths: string[];
  quiet: boolean;
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const paths: string[] = [];
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quiet') {
      quiet = true;
    } else if (!args[i].startsWith('--')) {
      paths.push(args[i]);
    }
  }

  return { paths, quiet };
}

function validateJson(filePath: string): JsonLintResult {
  if (!existsSync(filePath)) {
    return { file: filePath, valid: false, error: 'File not found' };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return { file: filePath, valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { file: filePath, valid: false, error: message };
  }
}

function main(): number {
  const { paths, quiet } = parseArgs();

  if (paths.length === 0) {
    if (!quiet) {
      console.log(`${RED}[ERROR] No JSON files specified${RESET}`);
    }
    return 1;
  }

  const results = paths.map(validateJson);
  const failures = results.filter((r) => !r.valid);

  for (const result of results) {
    if (result.valid) {
      if (!quiet) {
        console.log(`${GREEN}[OK]${RESET} ${result.file}`);
      }
    } else {
      console.log(`${RED}[ERROR]${RESET} ${result.file} - ${result.error}`);
    }
  }

  if (failures.length > 0) {
    if (!quiet) {
      console.log(`${RED}[FAIL] ${failures.length} file(s) have invalid JSON${RESET}`);
    }
    return 1;
  }

  if (!quiet) {
    console.log(`${GREEN}[OK] All JSON files valid${RESET}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as jsonLint };
