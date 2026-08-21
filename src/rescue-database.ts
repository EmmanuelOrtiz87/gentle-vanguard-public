import { runSync } from './core/run-command.js';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function log(m: string, c = 'white') {
  const cl: Record<string, string> = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    white: '\x1b[37m',
  };
  console.log(`${cl[c] || ''}${m}\x1b[0m`);
}

function findDBs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? findDBs(join(dir, e.name))
      : e.name.endsWith('.db') || e.name.endsWith('.sqlite')
        ? [join(dir, e.name)]
        : [],
  );
}

function checkSQLite(db: string, q: string): boolean {
  try {
    // Array form: SQL and db paths may contain spaces — shell quoting is unreliable.
    const r = runSync('sqlite3', [db, q], { timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

const targets = ['.codegraph', '.engram-data'];
const results: { n: string; s: string }[] = [];
let critical = false;

log('=== RESCUE DATABASE ===', 'cyan');

for (const t of targets) {
  const p = join(ROOT, t);
  if (!existsSync(p)) {
    results.push({ n: t, s: 'missing' });
    log(`  ${t}: no existe`, 'yellow');
    continue;
  }
  const dbs = findDBs(p);
  if (!dbs.length) {
    results.push({ n: t, s: 'no-db' });
    log(`  ${t}: sin .db`, 'yellow');
    continue;
  }

  const healthy = dbs.some((db) => checkSQLite(db, 'SELECT name FROM sqlite_master LIMIT 1'));
  if (healthy) {
    const count = checkSQLite(dbs[0], 'SELECT COUNT(*) FROM nodes')
      ? runSync('sqlite3', [dbs[0], 'SELECT COUNT(*) FROM nodes'], {}).stdout.trim()
      : '?';
    results.push({ n: t, s: 'ok' });
    log(`  ${t}: OK (${count})`, 'green');
  } else {
    results.push({ n: t, s: 'corrupt' });
    critical = true;
    const bk = join(ROOT, '.recovery', `backup-${TS}`, t);
    mkdirSync(bk, { recursive: true });
    cpSync(p, bk, { recursive: true, force: true });
    rmSync(p, { recursive: true, force: true });
    log(`  ${t}: CORRUPT → backupeada + eliminada`, 'red');
  }
}

// Restore point
const rp = join(ROOT, '.session', 'restore-points');
mkdirSync(rp, { recursive: true });
writeFileSync(
  join(rp, `${TS}.json`),
  JSON.stringify(
    {
      id: `restore-${TS}`,
      timestamp: TS,
      type: 'post-recovery-baseline',
      status: critical ? 'repaired' : 'healthy',
    },
    null,
    2,
  ),
);

// Recovery log
mkdirSync(join(ROOT, '.recovery'), { recursive: true });
writeFileSync(
  join(ROOT, '.recovery', 'recovery-log.json'),
  JSON.stringify(
    {
      timestamp: TS,
      action: 'rescue',
      results,
      repaired: critical,
      status: critical ? 'restart-needed' : 'healthy',
    },
    null,
    2,
  ),
);

log(
  `\n=== ${critical ? 'REPARADO — reinicia opencode' : 'TODO OK'} ===`,
  critical ? 'yellow' : 'green',
);
log(`Restore point: restore-${TS}`, 'green');
process.exit(critical ? 1 : 0);
