#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';
import { extname, basename, dirname, join } from 'path';

interface FormatCommand {
  cmd: string;
  args: string[];
  ext: string;
}

interface FormatterConfig {
  name: string;
  checkFiles?: string[];
  formats: FormatCommand[];
}

const FORMATTERS: Record<string, FormatterConfig> = {
  '.ps1': {
    name: 'PowerShell',
    formats: [
      {
        cmd: 'pwsh',
        args: [
          '-NoProfile',
          '-Command',
          `Get-Content 'FILEPATH' | Out-String | Set-Content 'FILEPATH' -Encoding UTF8`,
        ],
        ext: '.ps1',
      },
    ],
  },
  '.js': {
    name: 'JavaScript',
    checkFiles: ['package.json', 'prettier.config.*', '.prettierrc*'],
    formats: [
      { cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.js' },
      { cmd: 'npx', args: ['eslint', '--fix', 'FILEPATH'], ext: '.js' },
    ],
  },
  '.ts': {
    name: 'TypeScript',
    checkFiles: ['package.json', 'tsconfig.json', 'prettier.config.*'],
    formats: [
      { cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.ts' },
      { cmd: 'npx', args: ['eslint', '--fix', 'FILEPATH'], ext: '.ts' },
    ],
  },
  '.tsx': {
    name: 'React/TSX',
    checkFiles: ['package.json', 'tsconfig.json'],
    formats: [{ cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.tsx' }],
  },
  '.jsx': {
    name: 'React/JSX',
    checkFiles: ['package.json'],
    formats: [{ cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.jsx' }],
  },
  '.py': {
    name: 'Python',
    checkFiles: ['setup.py', 'pyproject.toml', 'requirements.txt', '.python-version'],
    formats: [
      { cmd: 'python', args: ['-m', 'black', 'FILEPATH'], ext: '.py' },
      { cmd: 'python', args: ['-m', 'ruff', '--fix', 'FILEPATH'], ext: '.py' },
    ],
  },
  '.go': {
    name: 'Go',
    checkFiles: ['go.mod'],
    formats: [
      { cmd: 'gofmt', args: ['-w', 'FILEPATH'], ext: '.go' },
      { cmd: 'go', args: ['fmt', 'FILEPATH'], ext: '.go' },
    ],
  },
  '.rs': {
    name: 'Rust',
    checkFiles: ['Cargo.toml'],
    formats: [{ cmd: 'rustfmt', args: ['FILEPATH'], ext: '.rs' }],
  },
  '.java': {
    name: 'Java',
    checkFiles: ['pom.xml', 'build.gradle', 'gradlew'],
    formats: [{ cmd: 'google-java-format', args: ['-i', 'FILEPATH'], ext: '.java' }],
  },
  '.cs': {
    name: 'C#',
    checkFiles: ['*.sln', '*.csproj'],
    formats: [{ cmd: 'dotnet', args: ['format', 'FILEPATH'], ext: '.cs' }],
  },
  '.json': {
    name: 'JSON',
    formats: [
      {
        cmd: 'pwsh',
        args: [
          '-NoProfile',
          '-Command',
          `Get-Content 'FILEPATH' | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Set-Content 'FILEPATH' -Encoding UTF8`,
        ],
        ext: '.json',
      },
    ],
  },
  '.md': {
    name: 'Markdown',
    formats: [{ cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.md' }],
  },
  '.yaml': {
    name: 'YAML',
    formats: [{ cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.yaml' }],
  },
  '.yml': {
    name: 'YAML',
    formats: [{ cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.yml' }],
  },
  '.css': {
    name: 'CSS',
    formats: [
      { cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.css' },
      { cmd: 'npx', args: ['stylelint', '--fix', 'FILEPATH'], ext: '.css' },
    ],
  },
  '.html': {
    name: 'HTML',
    formats: [{ cmd: 'npx', args: ['prettier', '--write', 'FILEPATH'], ext: '.html' }],
  },
  '.sql': {
    name: 'SQL',
    formats: [{ cmd: 'npx', args: ['sqlformat', '--write', 'FILEPATH'], ext: '.sql' }],
  },
  '.sh': {
    name: 'Shell',
    formats: [{ cmd: 'shfmt', args: ['-w', 'FILEPATH'], ext: '.sh' }],
  },
};

function substitutePath(args: string[], filePath: string): string[] {
  return args.map((a) => (a === 'FILEPATH' ? filePath : a));
}

function checkConfigExists(dir: string, checkFiles: string[]): boolean {
  for (const check of checkFiles) {
    if (check.includes('*')) {
      const pattern = check.replace(/\.\*/g, '.*').replace(/\*/g, '');
      const files = [
        'package.json',
        'tsconfig.json',
        'prettier.config.js',
        '.prettierrc',
        '.prettierrc.json',
        'go.mod',
        'Cargo.toml',
      ];
      for (const f of files) {
        if (f.includes(pattern.replace(/\./g, '')) || pattern === '.*') {
          if (existsSync(join(dir, f))) return true;
        }
      }
    } else if (existsSync(join(dir, check))) {
      return true;
    }
  }
  return false;
}

function getFileFormatter(filePath: string): FormatterConfig | null {
  const ext = extname(filePath).toLowerCase();
  const config = FORMATTERS[ext];
  if (!config) return null;

  if (config.checkFiles) {
    const dir = dirname(filePath);
    if (!checkConfigExists(dir, config.checkFiles)) {
      console.log(`[PreTool-Format] Skipping ${filePath} - no formatter config found`);
      return null;
    }
  }

  return config;
}

function invokeFormatter(filePath: string, formatter: FormatterConfig, dryRun: boolean): boolean {
  if (dryRun) {
    console.log(`[PreTool-Format] [DRY-RUN] Would format: ${filePath} with ${formatter.name}`);
    return true;
  }

  for (const formatCmd of formatter.formats) {
    try {
      const args = substitutePath(formatCmd.args, filePath);
      const result = runSync(formatCmd.cmd, args, {
        stdio: 'pipe',
      });
      if (result.status === 0 || result.status === null) {
        console.log(`[PreTool-Format] Formatted: ${basename(filePath)}`);
        return true;
      }
    } catch {
      // formatter not found or failed - try next
    }
  }

  return false;
}

function main(): number {
  const args = process.argv.slice(2);

  let filePath = '';
  let dryRun = false;
  let detailed = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
      case '-f':
        filePath = args[++i] ?? '';
        break;
      case '--dry-run':
      case '-d':
        dryRun = true;
        break;
      case '--detailed':
      case '-v':
        detailed = true;
        break;
      default:
        if (!filePath && !args[i].startsWith('-')) {
          filePath = args[i];
        }
        break;
    }
  }

  if (!filePath) {
    console.log('[PreTool-Format] No file path provided');
    return 1;
  }

  if (!existsSync(filePath)) {
    console.log(`[PreTool-Format] File not found: ${filePath}`);
    return 0;
  }

  let originalContent: string;
  try {
    originalContent = readFileSync(filePath, 'utf-8');
  } catch {
    console.log(`[PreTool-Format] Could not read: ${filePath}`);
    return 0;
  }

  const formatter = getFileFormatter(filePath);
  if (!formatter) {
    console.log(`[PreTool-Format] No formatter for: ${filePath}`);
    return 0;
  }

  console.log(`[PreTool-Format] Processing: ${filePath}`);

  const wasFormatted = invokeFormatter(filePath, formatter, dryRun);

  if (wasFormatted && !dryRun) {
    try {
      const newContent = readFileSync(filePath, 'utf-8');
      if (originalContent !== newContent) {
        console.log(`[PreTool-Format] Format applied: ${basename(filePath)}`);
        if (detailed) {
          const originalLines = originalContent.split('\n').length;
          const newLines = newContent.split('\n').length;
          console.log(`[PreTool-Format] Lines: ${originalLines} -> ${newLines}`);
        }
      }
    } catch {
      // skip post-format check on read failure
    }
  }

  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as preToolFormat };
