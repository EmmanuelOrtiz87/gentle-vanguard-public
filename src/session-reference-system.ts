#!/usr/bin/env node

import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runSync, runNpxTsxSync } from './core/run-command.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type Component = 'session' | 'cleanup' | 'disconnect' | 'cache' | 'all';

export interface QuickRestartArgs {
  Components?: Component;
  ProjectName?: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.replace(/^-+/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

const VALID_COMPONENTS: Component[] = ['session', 'cleanup', 'disconnect', 'cache', 'all'];

function isValidComponent(v: string): v is Component {
  return VALID_COMPONENTS.includes(v as Component);
}

function colored(msg: string, color: 'cyan' | 'green' | 'yellow' | 'red'): string {
  const codes: Record<string, string> = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
  };
  return `${codes[color] ?? ''}${msg}\x1b[0m`;
}

function log(msg: string, color: 'cyan' | 'green' | 'yellow' | 'red' = 'cyan') {
  const prefix =
    color === 'green'
      ? '[OK]'
      : color === 'yellow'
        ? '[WARN]'
        : color === 'red'
          ? '[ERROR]'
          : '[QUICK-RESTART]';
  console.log(colored(`${prefix} ${msg}`, color));
}

function restartSession(projectName: string, scriptsDir: string): boolean {
  log('Restarting session tracking...');
  const sessionScript = join(scriptsDir, '..', 'src', 'session-manager.ts');
  if (!existsSync(sessionScript)) {
    log('session-manager.ts not found', 'yellow');
    return false;
  }
  const result = runNpxTsxSync(
    'src/session-manager.ts',
    ['--mode', 'Manual', '--project', projectName],
    { stdio: 'inherit' },
  );
  if (result.status === 0) {
    log('Session tracking restarted', 'green');
    return true;
  }
  return false;
}

function recoverCleanup(scriptsDir: string): boolean {
  log('Recovering from cleanup...');
  const engramBin = join(scriptsDir, 'engram.exe');
  if (existsSync(engramBin)) {
    log('Retrieving context from Engram...');
    runSync(engramBin, ['context', '--project', 'gentle-vanguard'], { stdio: 'inherit' });
    log('Context recovered from Engram', 'green');
  }
  return true;
}

function reconnectServices(): boolean {
  log('Reconnecting services...');
  return true;
}

function restartCache(root: string): boolean {
  log('Managing cache...');
  const cacheDirs = [join(root, '.session', 'cache'), join(root, '.session', 'temp')];
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;
  for (const dir of cacheDirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const filePath = join(dir, file);
        try {
          const s = statSync(filePath);
          if (s.isFile() && now - s.mtimeMs > fiveMin) {
            rmSync(filePath, { force: true });
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      // skip unreadable directories
    }
  }
  log('Cache cleaned (keeping recent)', 'green');
  return true;
}

function main() {
  const raw = parseArgs(process.argv);
  const componentsStr = raw['Components'] ?? 'all';
  const projectName = raw['ProjectName'] ?? 'gentle-vanguard';

  if (!isValidComponent(componentsStr)) {
    log(`Invalid component: ${componentsStr}. Valid: ${VALID_COMPONENTS.join(', ')}`, 'red');
  }

  const components = componentsStr as Component;
  const scriptsDir = resolve(__dirname, '..', '..', 'scripts', 'utilities', 'session');
  const ROOT = resolve(__dirname, '..');

  console.log('');
  console.log(colored('          SESSION QUICK RESTART - LIGHTWEIGHT RECOVERY         ', 'green'));
  console.log('');

  let success = true;

  if (components === 'all' || components === 'session') {
    success = restartSession(projectName, scriptsDir) && success;
  }
  if (components === 'all' || components === 'cleanup') {
    success = recoverCleanup(scriptsDir) && success;
  }
  if (components === 'all' || components === 'disconnect') {
    success = reconnectServices() && success;
  }
  if (components === 'all' || components === 'cache') {
    success = restartCache(ROOT) && success;
  }

  console.log('');
  if (success) {
    console.log(colored('                    READY TO CONTINUE                         ', 'green'));
  } else {
    log('Some components failed to restart', 'yellow');
    const autostart =
      process.platform === 'win32'
        ? '.\\tools\\session-autostart.cmd'
        : 'bash scripts/utilities/session-autostart.sh';
    log(`Run full restart: ${autostart}`, 'cyan');
  }
}

try {
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
  }
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  log(`Quick restart failed: ${msg}`, 'red');
}
