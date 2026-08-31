#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { runSync } from '../core/run-command.js';
import { ROOT } from '../core/repo-root';

export const DEFAULT_WITR_VERSION = 'v0.3.3';
export const WITR_INSTALL_TIMEOUT = 120_000;

export interface WitrPlatform {
  os: 'windows' | 'linux' | 'darwin';
  arch: 'amd64' | 'arm64';
  isWindows: boolean;
}

export function detectWitrPlatform(): WitrPlatform {
  const isWindows = process.platform === 'win32';
  if (isWindows)
    return { os: 'windows', arch: process.arch === 'arm64' ? 'arm64' : 'amd64', isWindows };
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error('Unsupported platform. witr supports Windows, Linux, macOS and FreeBSD.');
  }
  return { os: process.platform, arch: process.arch === 'arm64' ? 'arm64' : 'amd64', isWindows };
}

function readZipEntries(archive: Buffer): Array<{ name: string; data: Buffer }> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Invalid ZIP archive');
  const count = archive.readUInt16LE(end + 10);
  const directoryOffset = archive.readUInt32LE(end + 16);
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Invalid ZIP central directory');
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if ((flags & 1) !== 0) throw new Error('Encrypted ZIP entries are unsupported');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(start, start + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`Unsupported ZIP compression method: ${method}`);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractWitrZip(archive: Buffer, destination: string): string {
  const candidate = readZipEntries(archive).find(({ name }) => {
    const normalized = name.replaceAll('\\', '/');
    return normalized === 'witr.exe' || normalized.endsWith('/witr.exe');
  });
  if (!candidate) throw new Error('witr.exe not found inside Windows release archive');
  const safeName = basename(candidate.name);
  const target = join(destination, safeName);
  writeFileSync(target, candidate.data);
  return target;
}

async function download(url: string, timeout: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function checksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface InstallWitrOptions {
  version?: string;
  installDir?: string;
  force?: boolean;
  quiet?: boolean;
  timeout?: number;
}

export async function installWitr(options: InstallWitrOptions = {}): Promise<string> {
  const version = options.version ?? DEFAULT_WITR_VERSION;
  const platform = detectWitrPlatform();
  const destination = resolve(options.installDir ?? join(ROOT, '.runtime', 'tools', 'witr'));
  mkdirSync(destination, { recursive: true });
  const executable = join(destination, platform.isWindows ? 'witr.exe' : 'witr');
  if (existsSync(executable) && !options.force) return executable;

  const asset = platform.isWindows
    ? `witr-windows-${platform.arch}.zip`
    : `witr-${platform.os}-${platform.arch}`;
  const base = `https://github.com/pranshuparmar/witr/releases/download/${version}`;
  const timeout = options.timeout ?? WITR_INSTALL_TIMEOUT;
  const temporary = mkdtempSync(join(tmpdir(), 'witr-install-'));
  try {
    if (!options.quiet) console.log(`[witr] Downloading ${base}/${asset} ...`);
    const archive = await download(`${base}/${asset}`, timeout);
    try {
      const sums = (await download(`${base}/SHA256SUMS`, Math.min(timeout, 30_000))).toString(
        'utf8',
      );
      const expected = sums
        .split(/\r?\n/)
        .find((line) =>
          new RegExp(`\\s${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(line),
        )
        ?.trim()
        .split(/\s+/)[0]
        ?.toLowerCase();
      const actual = checksum(archive);
      if (expected && actual !== expected)
        throw new Error(`Checksum mismatch for ${asset}. Expected ${expected}, got ${actual}.`);
      if (!options.quiet) console.log(`[witr] Checksum verified for ${asset}`);
    } catch (error) {
      console.warn(
        `[witr] Checksum verification skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (platform.isWindows) {
      const staged = extractWitrZip(archive, temporary);
      cpSync(staged, executable, { force: true });
    } else {
      writeFileSync(executable, archive);
      chmodSync(executable, 0o755);
    }
    const versionResult = runSync(executable, ['--version'], { cwd: destination, timeout: 30_000 });
    const versionOutput = versionResult.stdout.trim() || versionResult.stderr.trim();
    if (versionResult.status !== 0)
      throw new Error(`Installed binary failed version check: ${versionOutput}`);
    if (!options.quiet) console.log(`[witr] Installed at ${executable} (${versionOutput})`);
    return executable;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArgs(args: string[]): InstallWitrOptions {
  const value = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    version: value('version'),
    installDir: value('install-dir'),
    force: args.includes('--force'),
    quiet: args.includes('--quiet'),
  };
}

if (process.argv[1] && basename(process.argv[1]).startsWith('witr-installer.')) {
  installWitr(parseArgs(process.argv.slice(2)))
    .then(console.log)
    .catch((error: unknown) => {
      console.error(
        `[witr] Installation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
