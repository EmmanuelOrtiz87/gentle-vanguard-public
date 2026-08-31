#!/usr/bin/env npx tsx

/** Normalize the self-contained documentation presentation pages. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const PRESENTATIONS = join(ROOT, 'docs', 'presentations');
const SHARED_CSS = 'assets/css/gv.css?v=2.1';

function pageTitle(file: string): string {
  return file
    .replace(/\.html$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalize(file: string): boolean {
  const path = join(PRESENTATIONS, file);
  let html = readFileSync(path, 'utf8');
  const original = html;
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || pageTitle(file);

  html = html.replace(/<html([^>]*)>/i, (_match, attrs: string) => {
    const withClass = /\bclass=["'][^"']*["']/i.test(attrs)
      ? attrs.replace(/class=["']([^"']*)["']/i, (_m, value) => {
          const classes = [...new Set(`${value} gv-document-page`.split(/\s+/).filter(Boolean))];
          return `class="${classes.join(' ')}"`;
        })
      : `${attrs} class="gv-document-page"`;
    return `<html${/\bdata-bs-theme=/i.test(withClass) ? withClass : `${withClass} data-bs-theme="dark"`}>`;
  });
  html = html.replace(/\s*<meta\s+name=["'](?:theme-color|description)["'][^>]*>/gi, '');
  html = html.replace(
    /<head([^>]*)>/i,
    (_match, attrs: string) =>
      `<head${attrs}>\n    <meta name="theme-color" content="#0b1020" />\n    <meta name="description" content="${title.replace(/"/g, '&quot;')} — Gentle-Vanguard documentation" />`,
  );
  if (!/<link[^>]+href=["']assets\/css\/gv\.css/i.test(html)) {
    html = html.replace(
      /<\/head>/i,
      `    <link rel="stylesheet" href="${SHARED_CSS}" />\n  </head>`,
    );
  }
  if (!/<title>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (head) => `${head}\n    <title>${title}</title>`);
  }
  if (html !== original) {
    writeFileSync(path, html, 'utf8');
    return true;
  }
  return false;
}

const pages = readdirSync(PRESENTATIONS).filter((file) => file.endsWith('.html'));
const changed = pages.filter(normalize);
console.log(`Normalized documentation pages: ${changed.length}/${pages.length}`);
