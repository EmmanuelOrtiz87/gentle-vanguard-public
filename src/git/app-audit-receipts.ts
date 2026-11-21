import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, release } from 'node:os';
import { runSync } from '../core/run-command.js';
import { classifyAppScope } from './prepush-app-scope.js';

const CONTRACT = 'config/app-validation-contracts.json';
const RUNNERS = new Set([
  'src/git/app-audit-receipts.ts',
  'src/git/prepush-app-scope.ts',
  'src/ops/stack-audit-apps.ts',
  'src/core/run-command.ts',
]);
const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function gitFiles(root: string): string[] {
  const result = runSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: root,
    timeout: 10000,
  });
  if (result.status !== 0) throw new Error('Git inputs unavailable');
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

function contents(root: string, path: string): Buffer {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return Buffer.from('missing\0');
  if (lstatSync(absolute).isSymbolicLink())
    throw new Error(`External input: ${readlinkSync(absolute)}`);
  return Buffer.concat([Buffer.from('file\0'), readFileSync(absolute)]);
}

/** Hash-only: environment/config secrets never enter the receipt. */
export function appAuditEnvironment(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        node: process.version,
        executable: process.execPath,
        platform: process.platform,
        arch: process.arch,
        host: hostname(),
        release: release(),
        env: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)),
      }),
    )
    .digest('hex');
}

/** Content, not HEAD/status: unrelated app commits preserve this identity. */
export function appAuditFingerprint(
  root: string,
  app: string,
  plan: unknown,
  environment: string,
  files?: string[],
): string | null {
  try {
    files ??= gitFiles(root);
    const allApps = new Set(files.flatMap((path) => /^apps\/([^/]+)\//.exec(path)?.[1] ?? []));
    const dependencies = new Set([app]);
    // Relative imports and shell/package-script references are consumers too.
    // Generic app launchers conservatively consume all apps.
    for (const consumer of dependencies) {
      for (const path of files.filter(
        (file) =>
          file.startsWith(`apps/${consumer}/`) && /\.(?:[cm]?[jt]sx?|json|sh|html|css)$/.test(file),
      )) {
        const text = contents(root, path).toString('utf8');
        if (/['"]apps['"]|apps\/\$\{|apps\/\*/.test(text))
          for (const name of allApps) dependencies.add(name);
        for (const match of text.matchAll(/(?:apps\/|(?:\.\.\/)+)([\w-]+)(?=\/|['"\s])/g)) {
          if (allApps.has(match[1])) dependencies.add(match[1]);
        }
      }
    }
    const hash = createHash('sha256').update(
      JSON.stringify({ version: VERSION, app, plan, environment }),
    );
    const add = (path: string, data = contents(root, path)) =>
      hash
        .update('\0')
        .update(path)
        .update('\0')
        .update(String(data.length))
        .update('\0')
        .update(data);
    for (const path of [...new Set(files)].sort()) {
      const owner = /^apps\/([^/]+)\//.exec(path)?.[1];
      if (
        owner
          ? dependencies.has(owner)
          : path !== CONTRACT && (RUNNERS.has(path) || classifyAppScope([path]).mode !== 'none')
      )
        add(path);
    }
    const contract = JSON.parse(readFileSync(join(root, CONTRACT), 'utf8')) as Record<
      string,
      unknown
    >;
    const known = new Set([
      'version',
      'safeLocalTestScripts',
      'nativeTestSuites',
      'naDeclarations',
    ]);
    if (contract.version !== 1 || Object.keys(contract).some((key) => !known.has(key))) return null;
    for (const name of [...dependencies].sort()) {
      add(
        `${CONTRACT}:${name}`,
        Buffer.from(
          JSON.stringify(
            Object.fromEntries(
              [...known].map((section) => [
                section,
                section === 'version'
                  ? contract.version
                  : (contract[section] as Record<string, unknown> | undefined)?.[name],
              ]),
            ),
          ),
        ),
      );
    }
    // Ignored local configuration and dependency-install markers are inputs too.
    for (const dir of ['', ...[...dependencies].sort().map((name) => `apps/${name}/`)]) {
      for (const name of readdirSync(join(root, dir))
        .filter((name) => /^\.env(?:\.|$)/.test(name))
        .sort())
        add(`${dir}${name}`);
      for (const name of [
        '.npmrc',
        'node_modules/.package-lock.json',
        'node_modules/.modules.yaml',
      ])
        add(`${dir}${name}`);
      const modules = join(root, dir, 'node_modules');
      add(
        `${dir}node_modules:installation`,
        Buffer.from(existsSync(modules) ? String(lstatSync(modules).mtimeMs) : 'missing'),
      );
    }
    return hash.digest('hex');
  } catch {
    return null;
  } // Unreadable/unknown input never grants reuse.
}

type Audit = { app: string; status: string; checks: Array<{ status: string }> };
function green(value: unknown, app: string): value is Audit {
  const audit = value as Audit | null;
  return (
    !!audit &&
    audit.app === app &&
    audit.status === 'PASS' &&
    Array.isArray(audit.checks) &&
    audit.checks.length > 0 &&
    audit.checks.every((check) => check?.status === 'PASS')
  );
}

/** Each successful app survives failures elsewhere; no global-result promotion. */
export function withAppAuditReceipt<T extends Audit>(
  root: string,
  app: string,
  fingerprint: () => string | null,
  run: () => T,
): { audit: T; reused: boolean } {
  const before = fingerprint();
  const path =
    before && /^[a-f0-9]{64}$/.test(before) && /^[\w-]+$/.test(app)
      ? join(root, '.runtime', 'app-audit-receipts', app, `${before}.json`)
      : null;
  if (path) {
    try {
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      const age = Date.now() - Date.parse(receipt.at);
      if (
        receipt.version === VERSION &&
        receipt.key === before &&
        age >= 0 &&
        age <= MAX_AGE_MS &&
        green(receipt.audit, app)
      ) {
        return { audit: receipt.audit as T, reused: true };
      }
    } catch {
      /* Missing, partial or corrupt receipt: run this app. */
    }
  }
  const audit = run();
  if (path && green(audit, app) && fingerprint() === before) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ version: VERSION, key: before, at: new Date().toISOString(), audit }),
      );
    } catch {
      /* Evidence is optional; its absence never becomes a pass. */
    }
  }
  return { audit, reused: false };
}
