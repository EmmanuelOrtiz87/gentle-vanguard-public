#!/usr/bin/env npx tsx

/** Apply the canonical index navigation/footer/i18n shell to every presentation. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DIR = join(ROOT, 'docs', 'presentations');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const shell = read('index.html');
const canonicalNav = shell.match(/<nav[\s\S]*?<\/nav>/i)?.[0];
const canonicalFooter = shell.match(/<footer[\s\S]*?<\/footer>/i)?.[0];

if (!canonicalNav || !canonicalFooter) throw new Error('Canonical index nav/footer not found');
const navTemplate = canonicalNav;
const footerTemplate = canonicalFooter;

function normalize(file: string): boolean {
  const path = join(DIR, file);
  const original = readFileSync(path, 'utf8');
  let html = original;
  let nav: string = navTemplate;
  if (file !== 'index.html') nav = nav.replace(/href="#diagrams"/g, 'href="index.html#diagrams"');
  html = /<nav[\s\S]*?<\/nav>/i.test(html)
    ? html.replace(/<nav[\s\S]*?<\/nav>/i, nav)
    : html.replace(/<body([^>]*)>/i, (_match, attrs: string) => `<body${attrs}>\n${nav}`);
  html = /<footer[\s\S]*?<\/footer>/i.test(html)
    ? html.replace(/<footer[\s\S]*?<\/footer>/i, footerTemplate)
    : html.replace(/<\/body>/i, `${footerTemplate}\n  </body>`);

  const scripts = [
    'assets/js/i18n-content.js?v=2.1',
    'assets/js/i18n-extra.js?v=2.1',
    'assets/js/i18n.js?v=2.1',
  ];
  html = html.replace(
    /\s*<script[^>]+src=["']assets\/js\/i18n(?:-content|-extra)?\.js[^"']*["'][^>]*><\/script>/gi,
    '',
  );
  html = html.replace(
    /<\/head>/i,
    `    <script src="${scripts[0]}"></script>\n    <script src="${scripts[1]}"></script>\n    <script src="${scripts[2]}"></script>\n  </head>`,
  );
  if (html !== original) {
    writeFileSync(path, html, 'utf8');
    return true;
  }
  return false;
}

const pages = readdirSync(DIR).filter((file) => file.endsWith('.html'));
const changed = pages.filter(normalize);
console.log(`Normalized canonical HTML shell: ${changed.length}/${pages.length}`);
