#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const DEFAULT_ITEMS = [
  'src/content-operations',
  'tests/unit/content-operations.test.ts',
  'content/operations',
  'config/content-operations',
  'docs/operations',
  'scripts/content-operations',
];

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntry(name: string, data: Buffer): { local: Buffer; central: Buffer } {
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const nameBytes = Buffer.from(name.replaceAll('\\', '/'));
  const local = Buffer.alloc(30 + nameBytes.length + compressed.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  compressed.copy(local, 30 + nameBytes.length);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);
  return { local, central };
}

function filesUnder(root: string, item: string): string[] {
  const absolute = resolve(root, item);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(root, relative(root, join(absolute, entry.name)))
      : [join(absolute, entry.name)],
  );
}

export interface ExportKitOptions {
  root?: string;
  outputDir?: string;
  now?: Date;
  items?: string[];
}

export function exportKit(options: ExportKitOptions = {}): string {
  const root = resolve(options.root ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(root, '.runtime', 'exports'));
  const items = (options.items ?? DEFAULT_ITEMS).flatMap((item) => filesUnder(root, item));
  if (items.length === 0) throw new Error('No Content Operations files found.');
  mkdirSync(outputDir, { recursive: true });

  const stamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  const zipPath = join(outputDir, `gentle-vanguard-content-operations-${stamp}.zip`);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of items) {
    const entry = zipEntry(relative(root, file), readFileSync(file));
    locals.push(entry.local);
    const central = Buffer.from(entry.central);
    central.writeUInt32LE(offset, 42);
    centrals.push(central);
    offset += entry.local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  const output = Buffer.concat([...locals, centralDirectory, end]);
  writeFileSync(zipPath, output);
  return zipPath;
}

function main(): void {
  try {
    console.log(`Offline kit: ${exportKit()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && basename(process.argv[1]).startsWith('export-kit.')) main();
