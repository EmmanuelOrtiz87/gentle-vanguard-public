#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { globSync } from 'glob';

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

  if (paths.length === 0) {
    paths.push(
      ...globSync(
        [
          'package.json',
          'opencode.json',
          '.mcp.json',
          'config/**/*.json',
          'rules/**/*.json',
          'schemas/**/*.json',
          'packages/**/package.json',
        ],
        { nodir: true, ignore: ['**/node_modules/**', '**/dist/**'] },
      ),
    );
  }

  return { paths: [...new Set(paths)].sort(), quiet };
}

export function findDuplicateJsonKeys(content: string): string[] {
  const duplicates: string[] = [];
  let cursor = 0;

  const skipWhitespace = () => {
    while (/\s/.test(content[cursor] ?? '')) cursor++;
  };
  const parseString = (): string => {
    const start = cursor++;
    while (cursor < content.length) {
      if (content[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (content[cursor++] === '"') break;
    }
    return JSON.parse(content.slice(start, cursor)) as string;
  };
  const parseValue = (path: string[]): void => {
    skipWhitespace();
    if (content[cursor] === '{') {
      cursor++;
      skipWhitespace();
      const keys = new Set<string>();
      while (content[cursor] !== '}' && cursor < content.length) {
        const key = parseString();
        if (keys.has(key)) duplicates.push([...path, key].join('.'));
        keys.add(key);
        skipWhitespace();
        cursor++;
        parseValue([...path, key]);
        skipWhitespace();
        if (content[cursor] === ',') {
          cursor++;
          skipWhitespace();
        }
      }
      cursor++;
      return;
    }
    if (content[cursor] === '[') {
      cursor++;
      let index = 0;
      skipWhitespace();
      while (content[cursor] !== ']' && cursor < content.length) {
        parseValue([...path, String(index++)]);
        skipWhitespace();
        if (content[cursor] === ',') {
          cursor++;
          skipWhitespace();
        }
      }
      cursor++;
      return;
    }
    if (content[cursor] === '"') {
      parseString();
      return;
    }
    while (cursor < content.length && !/[\s,\]}]/.test(content[cursor])) cursor++;
  };

  parseValue([]);
  return duplicates;
}

function validateJson(filePath: string): JsonLintResult {
  if (!existsSync(filePath)) {
    return { file: filePath, valid: false, error: 'File not found' };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    const duplicates = findDuplicateJsonKeys(content);
    if (duplicates.length > 0) {
      return {
        file: filePath,
        valid: false,
        error: `Duplicate key(s): ${duplicates.join(', ')}`,
      };
    }
    return { file: filePath, valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { file: filePath, valid: false, error: message };
  }
}

function main(): number {
  const { paths, quiet } = parseArgs();

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
