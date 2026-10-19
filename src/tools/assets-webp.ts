import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, relative, resolve, dirname, extname } from 'node:path';
import sharp from 'sharp';

const args = new Set(process.argv.slice(2));
const rootArg = process.argv.find((value) => value.startsWith('--root='))?.slice('--root='.length);
const root = resolve(rootArg || 'apps');
const write = args.has('--write');
const includeBrand = args.has('--include-brand');
const quality = Number(process.argv.find((value) => value.startsWith('--quality='))?.split('=')[1] || 82);
const rasterExtensions = new Set(['.png', '.jpg', '.jpeg']);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.runtime') continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (rasterExtensions.has(extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

const files = await walk(root);
let converted = 0;
let skipped = 0;
for (const source of files) {
  const normalized = source.replaceAll('\\', '/');
  if (!includeBrand && /\/assets\/brand\//i.test(normalized)) {
    skipped += 1;
    continue;
  }
  const target = source.slice(0, -extname(source).length) + '.webp';
  const sourceInfo = await stat(source);
  if (!write) {
    console.log(`[dry-run] ${relative(process.cwd(), source)} -> ${relative(process.cwd(), target)} (${sourceInfo.size} bytes)`);
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  await sharp(source).webp({ quality }).toFile(target);
  converted += 1;
}

console.log(JSON.stringify({ root, write, quality, candidates: files.length, converted, skippedBrand: skipped }, null, 2));
