#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import { load as loadYaml } from 'js-yaml';

interface WorkflowLintResult {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface CliArgs {
  paths: string[];
  quiet: boolean;
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const REQUIRED_FIELDS = ['name', 'on', 'jobs'];

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

/**
 * Simple YAML key presence check at the root level.
 * Matches lines like `name: ...`, `on: ...`, `jobs: ...`
 * that start at column 0 (root-level keys in YAML).
 */
function findRootKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w[\w_-]*)\s*:/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function validateWorkflow(filePath: string): WorkflowLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(filePath)) {
    return { file: filePath, valid: false, errors: ['File not found'], warnings: [] };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { file: filePath, valid: false, errors: [message], warnings: [] };
  }

  // Check for required root-level fields
  const rootKeys = findRootKeys(content);
  for (const field of REQUIRED_FIELDS) {
    if (!rootKeys.has(field)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Strict YAML parse — catches constructs GitHub's server-side parser rejects,
  // e.g. ": " inside plain scalars (unquoted step names like `name: Scan (gate: fail)`),
  // which regex checks cannot see and which poison every caller workflow.
  try {
    loadYaml(content, { json: true });
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    errors.push(`Invalid YAML (GitHub would reject this file): ${message}`);
  }

  const fileName = filePath.replace(/^.*[/\\]/, '');

  // codeql-analysis.yml: check for 'powershell' language
  if (fileName === 'codeql-analysis.yml' && /language:\s*powershell/i.test(content)) {
    warnings.push(
      "'powershell' language may fail on ubuntu-latest — use 'actions' or 'javascript' instead",
    );
  }

  // trivy workflows: check for missing format:/output: parameters
  const trivyFlows = ['owasp-scan.yml', 'dependency-backup.yml'];
  if (trivyFlows.includes(fileName)) {
    if (/aquasecurity\/trivy-action/.test(content) && !/format:\s/.test(content)) {
      warnings.push(
        "Trivy action missing 'format:' and 'output:' parameters — report artifact may be empty",
      );
    }
  }

  return {
    file: filePath,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function main(): number {
  const { paths, quiet } = parseArgs();

  if (paths.length === 0) {
    if (!quiet) {
      console.log(`${RED}[ERROR] No workflow files specified${RESET}`);
    }
    return 1;
  }

  const files = paths.flatMap((path) => {
    if (!existsSync(path) || !statSync(path).isDirectory()) return [path];
    return readdirSync(path)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .map((name) => `${path}/${name}`);
  });
  const results = files.map(validateWorkflow);
  const failures = results.filter((r) => !r.valid);

  for (const result of results) {
    if (result.valid && result.warnings.length === 0) {
      if (!quiet) {
        console.log(`${GREEN}[OK]${RESET} ${result.file}`);
      }
    } else if (result.valid && result.warnings.length > 0) {
      console.log(`${YELLOW}[WARN]${RESET} ${result.file}`);
      for (const w of result.warnings) {
        console.log(`  ${YELLOW}warning:${RESET} ${w}`);
      }
    } else {
      console.log(`${RED}[ERROR]${RESET} ${result.file}`);
      for (const e of result.errors) {
        console.log(`  ${RED}error:${RESET} ${e}`);
      }
      for (const w of result.warnings) {
        console.log(`  ${YELLOW}warning:${RESET} ${w}`);
      }
    }
  }

  if (failures.length > 0) {
    if (!quiet) {
      console.log(`${RED}[FAIL] ${failures.length} file(s) have errors${RESET}`);
    }
    return 1;
  }

  if (!quiet) {
    console.log(`${GREEN}[OK] All workflow files valid${RESET}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as workflowLint };
