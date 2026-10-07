import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const apps = ['kairos-agenda', 'gv-agenda'];
const checks = [
  ['calculator edit exposes reminder choice', 'public/js/views/calculator.js', 'create_reminder'],
  ['calculator edit sends reminder intent', 'public/js/views/calculator.js', 'payload.create_reminder = payload.create_reminder === \'si\''],
  ['server updates linked reminder', 'server/api.mjs', 'const wantsReminder = Boolean(merged.create_reminder)'],
  ['local-first updates linked reminder', 'public/js/local-api.mjs', 'const wantsReminder = Boolean(merged.create_reminder)'],
  ['mobile search has dedicated row', 'public/css/base.css', 'flex: 0 0 100%'],
  ['service worker cache is versioned', 'public/sw.js', "const CACHE = '"],
] as const;

const failures: string[] = [];
for (const app of apps) {
  for (const [label, relativePath, needle] of checks) {
    const path = join(root, 'apps', app, relativePath);
    let content = '';
    try { content = readFileSync(path, 'utf8'); } catch { failures.push(`${app}: missing ${relativePath}`); continue; }
    if (!content.includes(needle)) failures.push(`${app}: ${label} (${relativePath})`);
  }
}

if (failures.length) {
  console.error('Agenda parity gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Agenda parity gate passed: Kairós Agenda and GV Agenda share the approved functional contract.');
