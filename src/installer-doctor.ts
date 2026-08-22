#!/usr/bin/env node

/** Deterministic post-install verification. Does not install or download anything. */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type Status = 'PASS' | 'WARN' | 'FAIL';
interface Check {
  id: string;
  status: Status;
  message: string;
  required: boolean;
}

const root = resolve(process.cwd());
const json = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

function commandVersion(command: string): string | null {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which';
  if (spawnSync(checker, [command], { stdio: 'ignore', windowsHide: true }).status !== 0)
    return null;
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0
    ? `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0]
    : 'available';
}

function tuple(value: string | null): number[] | null {
  const match = value?.match(/\d+\.\d+\.\d+/);
  return match ? match[0].split('.').map(Number) : null;
}

function atLeast(actual: string | null, expected: string): boolean {
  const a = tuple(actual);
  const e = tuple(expected);
  if (!a || !e) return true;
  return a[0] > e[0] || (a[0] === e[0] && (a[1] > e[1] || (a[1] === e[1] && a[2] >= e[2])));
}

function commandCheck(id: string, command: string, required: boolean, minimum?: string): Check {
  const version = commandVersion(command);
  if (!version)
    return {
      id,
      status: required ? 'FAIL' : 'WARN',
      message: `${command} no está instalado`,
      required,
    };
  if (minimum && !atLeast(version, minimum))
    return { id, status: required ? 'FAIL' : 'WARN', message: `${version} < ${minimum}`, required };
  return { id, status: 'PASS', message: version, required };
}

function pathCheck(id: string, relativePath: string, required: boolean): Check {
  const present = existsSync(join(root, relativePath));
  return {
    id,
    status: present ? 'PASS' : required ? 'FAIL' : 'WARN',
    message: present ? relativePath : `falta ${relativePath}`,
    required,
  };
}

function main(): void {
  const manifestPath = join(root, 'config', 'installer-manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('Falta config/installer-manifest.json');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    minimumNode: string;
    minimumPnpm: string;
    required: Array<{ id: string; command: string }>;
    optional: Array<{ id: string; command: string }>;
    runtime: { workspace: string[]; dashboard: string; configuration: string[] };
  };
  const checks: Check[] = [];
  for (const item of manifest.required)
    checks.push(
      commandCheck(
        item.id,
        item.command,
        true,
        item.id === 'node'
          ? manifest.minimumNode
          : item.id === 'pnpm'
            ? manifest.minimumPnpm
            : undefined,
      ),
    );
  for (const item of manifest.optional) checks.push(commandCheck(item.id, item.command, false));
  checks.push(pathCheck('node_modules', 'node_modules', true));
  checks.push(pathCheck('dashboard', manifest.runtime.dashboard, true));
  checks.push(pathCheck('lockfile', 'pnpm-lock.yaml', true));
  checks.push(pathCheck('database-driver', 'node_modules/better-sqlite3', true));
  for (const file of manifest.runtime.configuration) checks.push(pathCheck(file, file, true));
  for (const dir of manifest.runtime.workspace) checks.push(pathCheck(dir, dir, false));
  const failed = checks.filter((check) => check.status === 'FAIL');
  const report = {
    product: 'Gentle-Vanguard',
    root,
    status: failed.length === 0 ? 'ready' : 'incomplete',
    checks,
    next:
      failed.length === 0
        ? 'Run npm run db:init and npm run watchtower:health.'
        : 'Instala las dependencias requeridas y ejecuta este comando otra vez.',
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Gentle-Vanguard Installer Doctor — ${report.status.toUpperCase()}`);
    for (const check of checks) console.log(`[${check.status}] ${check.id}: ${check.message}`);
    console.log(`\nNext: ${report.next}`);
  }
  process.exit(strict && failed.length > 0 ? 1 : 0);
}

main();
