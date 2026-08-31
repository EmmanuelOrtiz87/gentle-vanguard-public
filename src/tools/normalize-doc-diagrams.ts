#!/usr/bin/env npx tsx

/** Add the shared accessible metadata contract to presentation SVG diagrams. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DIR = join(ROOT, 'docs', 'presentations', 'diagrams');

function label(file: string): string {
  return file
    .replace(/\.svg$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalize(file: string): boolean {
  const path = join(DIR, file);
  const original = readFileSync(path, 'utf8');
  if (/<title[^>]*>/.test(original) && /aria-labelledby=/.test(original)) return false;
  const name = label(file);
  const ids = `${file.replace(/\.svg$/i, '')}-title ${file.replace(/\.svg$/i, '')}-desc`;
  const updated = original.replace(
    /<svg([^>]*)>/i,
    `<svg$1 role="img" aria-labelledby="${ids}" focusable="false">\n<title id="${ids.split(' ')[0]}">${name}</title>\n<desc id="${ids.split(' ')[1]}">Gentle-Vanguard ${name} diagram showing the main components, relationships and operational flow.</desc>`,
  );
  writeFileSync(path, updated, 'utf8');
  return true;
}

const files = readdirSync(DIR).filter((file) => file.endsWith('.svg'));
const changed = files.filter(normalize);
console.log(`Normalized accessible diagrams: ${changed.length}/${files.length}`);
