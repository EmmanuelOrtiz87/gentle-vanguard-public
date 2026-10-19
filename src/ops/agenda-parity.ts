import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const root = process.cwd();
const apps = ['kairos-agenda', 'gv-agenda'];
const apply = process.argv.includes('--apply');

const checks = [
  ['calculator edit exposes reminder choice', 'public/js/views/calculator.js', 'create_reminder'],
  ['calculator edit sends reminder intent', 'public/js/views/calculator.js', 'payload.create_reminder = payload.create_reminder === \'si\''],
  ['server updates linked reminder', 'server/api.mjs', 'const wantsReminder = Boolean(merged.create_reminder)'],
  ['local-first updates linked reminder', 'public/js/local-api.mjs', 'const wantsReminder = Boolean(merged.create_reminder)'],
  ['mobile search has dedicated row', 'public/css/base.css', 'flex: 0 0 100%'],
  ['service worker cache is versioned', 'public/sw.js', "const CACHE = '"],
] as const;

const exactSharedFiles = [
  'server/calc.mjs',
  'server/recurrence.mjs',
  'public/js/core/calc.mjs',
  'public/js/core/validate.mjs',
  'public/css/btn-active.css',
  'tests/e2e-journey.mjs',
] as const;

const intentionalDriftChecks = [
  ['gv keeps Twilio WhatsApp validation', 'gv-agenda', 'server/validate.mjs', "import { validateWaConfig } from './wa-reminders.mjs'"],
  ['gv keeps WA bridge settings gate', 'gv-agenda', 'server/validate.mjs', 'body.wa_bridge != null'],
  ['gv keeps native WA scheduler', 'gv-agenda', 'server/server.mjs', 'dueReminderWhatsApp'],
  ['gv keeps GV storage keys', 'gv-agenda', 'public/js/store.js', 'gvag-'],
  ['kairos keeps client PWA docs', 'kairos-agenda', 'docs/PWA-UPGRADE.md', 'kairos-agenda.pages.dev'],
] as const;

const failures: string[] = [];

function filePath(app: string, relativePath: string) {
  return join(root, 'apps', app, relativePath);
}

function read(app: string, relativePath: string) {
  return readFileSync(filePath(app, relativePath), 'utf8');
}

function hash(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

for (const app of apps) {
  for (const [label, relativePath, needle] of checks) {
    let content = '';
    try { content = read(app, relativePath); } catch { failures.push(`${app}: missing ${relativePath}`); continue; }
    if (!content.includes(needle)) failures.push(`${app}: ${label} (${relativePath})`);
  }
}

for (const relativePath of exactSharedFiles) {
  let kairos = '';
  let gv = '';
  try {
    kairos = read('kairos-agenda', relativePath);
    gv = read('gv-agenda', relativePath);
  } catch {
    failures.push(`shared exact: missing ${relativePath}`);
    continue;
  }
  if (hash(kairos) !== hash(gv)) {
    if (apply) {
      const target = filePath('gv-agenda', relativePath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(filePath('kairos-agenda', relativePath), target);
      console.log(`Synced ${relativePath}: kairos-agenda -> gv-agenda`);
    } else {
      failures.push(`shared exact drift: ${relativePath} (run npm run agenda:sync after review)`);
    }
  }
}

for (const [label, app, relativePath, needle] of intentionalDriftChecks) {
  let content = '';
  try { content = read(app, relativePath); } catch { failures.push(`${app}: missing ${relativePath}`); continue; }
  if (!content.includes(needle)) failures.push(`${app}: ${label} (${relativePath})`);
}

if (failures.length) {
  console.error('Agenda parity gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  apply
    ? 'Agenda sync complete: exact shared files are aligned and protected drift invariants pass.'
    : 'Agenda parity gate passed: exact shared files are aligned and intentional drift invariants pass.',
);
