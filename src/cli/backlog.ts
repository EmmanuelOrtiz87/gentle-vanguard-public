#!/usr/bin/env tsx
/**
 * backlog — Backlog & Requirements Management CLI
 *
 * Manages incidents, bugs, warnings, errors, requirements, and tasks
 * via Nexus DB (SQLite). Provides full CRUD, search, triage, and reporting.
 *
 * Usage:
 *   npx tsx src/cli/backlog.ts add --type bug --title "..." --severity high
 *   npx tsx src/cli/backlog.ts list [--status open] [--severity high] [--tag ps1-migration]
 *   npx tsx src/cli/backlog.ts update <id> --status resolved --notes "Fixed in commit xyz"
 *   npx tsx src/cli/backlog.ts get <id>
 *   npx tsx src/cli/backlog.ts search <query>
 *   npx tsx src/cli/backlog.ts comment <id> --text "..."
 *   npx tsx src/cli/backlog.ts relate <id> <related-id> --type supersedes
 *   npx tsx src/cli/backlog.ts stats
 *   npx tsx src/cli/backlog.ts report [--format markdown]
 *   npx tsx src/cli/backlog.ts delete <id>
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// ─── Resolve ───────────────────────────────────────────────────────
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = join(ROOT, '.runtime', 'gentle-vanguard.db');

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

// (types are inferred from SQLite rows)

// ─── Colors ────────────────────────────────────────────────────────
const C = {
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  purple: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function sevColor(s: string): string {
  const m: Record<string, string> = { critical: C.red, high: C.yellow, medium: C.cyan, low: C.dim };
  return m[s] ?? C.reset;
}
function staColor(s: string): string {
  const m: Record<string, string> = {
    open: C.green,
    in_progress: C.cyan,
    resolved: C.dim,
    wont_fix: C.dim,
    backlog: C.purple,
    duplicate: C.red,
  };
  return m[s] ?? C.reset;
}

// ─── Commands ──────────────────────────────────────────────────────

function cmdAdd(args: Record<string, string>): void {
  const type = args.type ?? '';
  const title = args.title ?? '';
  const severity = args.severity ?? 'medium';
  const status = args.status ?? 'open';
  const types = ['incident', 'bug', 'warning', 'error', 'requirement', 'task', 'gap'];
  const sevs = ['critical', 'high', 'medium', 'low'];

  if (!type || !types.includes(type)) {
    console.error(`--type must be: ${types.join(', ')}`);
    process.exit(1);
  }
  if (!title) {
    console.error('--title is required');
    process.exit(1);
  }
  if (!sevs.includes(severity)) {
    console.error(`--severity must be: ${sevs.join(', ')}`);
    process.exit(1);
  }

  const id = `BL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const d = db();
  const assignee = args.assignee ?? 'any';
  const env = args.env ?? 'all';
  const impact = args.impact ?? 'minor';
  const priority = parseInt(args.priority ?? '3');

  d.prepare(
    `INSERT INTO backlog_items (id,type,title,description,severity,status,source,session_id,
      assignee_role,estimated_hours,priority,target_release,environment,reported_by,impact,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    type,
    title,
    args.description ?? '',
    severity,
    status,
    args.source ?? '',
    args.session ?? null,
    assignee,
    args.estimate ? parseFloat(args.estimate) : null,
    priority,
    args.release ?? null,
    env,
    args.reporter ?? null,
    impact,
    now,
    now,
  );
  d.prepare(
    'INSERT INTO backlog_status_history (item_id,from_status,to_status,reason) VALUES (?,NULL,?,?)',
  ).run(id, status, 'Item created');

  if (args.tags)
    args.tags.split(',').forEach((t: string) => {
      const tag = t.trim();
      d.prepare('INSERT OR IGNORE INTO backlog_tags (name) VALUES (?)').run(tag);
      const tid = (
        d.prepare('SELECT id FROM backlog_tags WHERE name = ?').get(tag) as { id: number }
      ).id;
      d.prepare('INSERT OR IGNORE INTO backlog_item_tags (item_id,tag_id) VALUES (?,?)').run(
        id,
        tid,
      );
    });
  if (args.comment)
    d.prepare('INSERT INTO backlog_comments (item_id,content,author) VALUES (?,?,?)').run(
      id,
      args.comment,
      'system',
    );

  console.log(`  ${C.green}✅ Created: ${id}${C.reset}`);
  console.log(`  ${title}  [${type}/${severity}]`);
}

function cmdList(args: Record<string, string>): void {
  const conds: string[] = [];
  const params: unknown[] = [];
  const limit = parseInt(args.limit ?? '50');
  const offset = parseInt(args.offset ?? '0');

  if (args.status) {
    conds.push('bi.status = ?');
    params.push(args.status);
  }
  if (args.severity) {
    conds.push('bi.severity = ?');
    params.push(args.severity);
  }
  if (args.type) {
    conds.push('bi.type = ?');
    params.push(args.type);
  }
  if (args.tag) {
    conds.push(
      'bi.id IN (SELECT bit.item_id FROM backlog_item_tags bit JOIN backlog_tags bt ON bit.tag_id=bt.id WHERE bt.name=?)',
    );
    params.push(args.tag);
  }
  if (args.search) {
    conds.push('(bi.title LIKE ? OR bi.description LIKE ?)');
    params.push(`%${args.search}%`, `%${args.search}%`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const d = db();
  const rows = d
    .prepare(
      `SELECT bi.*,GROUP_CONCAT(DISTINCT bt.name) as tags
    FROM backlog_items bi LEFT JOIN backlog_item_tags bit ON bi.id=bit.item_id LEFT JOIN backlog_tags bt ON bit.tag_id=bt.id
    ${where} GROUP BY bi.id
    ORDER BY CASE bi.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, bi.created_at DESC
    LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as any[];

  const count = (
    d.prepare(`SELECT COUNT(*) as c FROM backlog_items bi ${where}`).get(...params) as { c: number }
  ).c;

  if (!rows.length) {
    console.log('No items match.');
    return;
  }
  console.log(`Found ${count} item(s):\n`);
  for (const r of rows) {
    const t = r.tags ? ` [${r.tags}]` : '';
    console.log(
      `  ${sevColor(r.severity)}${r.severity.padEnd(8)}${C.reset} ${staColor(r.status)}${r.status.padEnd(12)}${C.reset} ${(r.id as string).padEnd(20)} ${(r.title as string).substring(0, 70)}${t}`,
    );
  }
  console.log(`\nTotal: ${count}`);
}

function cmdGet(id: string): void {
  const d = db();
  const r = d
    .prepare(
      `SELECT bi.*,GROUP_CONCAT(DISTINCT bt.name) as tags
    FROM backlog_items bi LEFT JOIN backlog_item_tags bit ON bi.id=bit.item_id LEFT JOIN backlog_tags bt ON bit.tag_id=bt.id
    WHERE bi.id=? GROUP BY bi.id`,
    )
    .get(id) as any;
  if (!r) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }

  const comments = d
    .prepare('SELECT * FROM backlog_comments WHERE item_id=? ORDER BY created_at')
    .all(id) as any[];
  const history = d
    .prepare('SELECT * FROM backlog_status_history WHERE item_id=? ORDER BY created_at')
    .all(id) as any[];
  const related = d
    .prepare('SELECT related_item_id,relation_type FROM backlog_related_items WHERE item_id=?')
    .all(id) as any[];

  console.log(`\n  ID:       ${r.id}`);
  console.log(`  Type:     ${r.type}`);
  console.log(`  Title:    ${r.title}`);
  console.log(`  Severity: ${sevColor(r.severity)}${r.severity}${C.reset}`);
  console.log(`  Status:   ${staColor(r.status)}${r.status}${C.reset}`);
  if (r.description) console.log(`  Desc:     ${r.description}`);
  if (r.source) console.log(`  Source:   ${r.source}`);
  if (r.tags) console.log(`  Tags:     ${r.tags}`);
  console.log(`  Created:  ${r.created_at}`);
  if (r.resolved_at) console.log(`  Resolved: ${r.resolved_at}`);
  if (r.resolution_notes) console.log(`  Notes:    ${r.resolution_notes}`);

  if (comments.length) {
    console.log(`\n  Comments:`);
    comments.forEach((c: any) => console.log(`    [${c.author}] ${c.content}`));
  }
  if (history.length > 1) {
    console.log(`\n  History:`);
    history.forEach((h: any) =>
      console.log(
        `    ${(h.created_at as string).substring(0, 16)}  ${h.from_status ?? '-'} → ${h.to_status}`,
      ),
    );
  }
  if (related.length) {
    console.log(`\n  Related:`);
    related.forEach((r: any) => console.log(`    ${r.related_item_id}  [${r.relation_type}]`));
  }
  console.log('');
}

function cmdUpdate(args: Record<string, string>): void {
  const id = args._id;
  if (!id) {
    console.error('<id> required');
    process.exit(1);
  }
  const d = db();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const fields: string[] = ['updated_at=?'];
  const params: unknown[] = [now];

  if (args.status) {
    const cur = d.prepare('SELECT status FROM backlog_items WHERE id=?').get(id) as any;
    fields.push('status=?');
    params.push(args.status);
    if (args.status === 'resolved') {
      fields.push('resolved_at=?');
      params.push(now);
    }
    d.prepare(
      'INSERT INTO backlog_status_history (item_id,from_status,to_status,reason) VALUES (?,?,?,?)',
    ).run(id, cur?.status ?? null, args.status, args.notes ?? '');
  }
  if (args.severity) {
    fields.push('severity=?');
    params.push(args.severity);
  }
  if (args.title) {
    fields.push('title=?');
    params.push(args.title);
  }
  if (args.description) {
    fields.push('description=?');
    params.push(args.description);
  }
  if (args.notes) {
    fields.push('resolution_notes=?');
    params.push(args.notes);
  }
  if (args.assignee) {
    fields.push('assignee_role=?');
    params.push(args.assignee);
  }
  if (args.estimate) {
    fields.push('estimated_hours=?');
    params.push(parseFloat(args.estimate));
  }
  if (args.actual) {
    fields.push('actual_hours=?');
    params.push(parseFloat(args.actual));
  }
  if (args.priority) {
    fields.push('priority=?');
    params.push(parseInt(args.priority));
  }
  if (args.release) {
    fields.push('target_release=?');
    params.push(args.release);
  }
  if (args.env) {
    fields.push('environment=?');
    params.push(args.env);
  }
  if (args.reporter) {
    fields.push('reported_by=?');
    params.push(args.reporter);
  }
  if (args.impact) {
    fields.push('impact=?');
    params.push(args.impact);
  }

  if (fields.length === 1) {
    console.error('Nothing to update');
    process.exit(1);
  }
  params.push(id);
  d.prepare(`UPDATE backlog_items SET ${fields.join(',')} WHERE id=?`).run(...params);

  if (args.comment)
    d.prepare('INSERT INTO backlog_comments (item_id,content,author) VALUES (?,?,?)').run(
      id,
      args.comment,
      'system',
    );
  if (args.tags)
    args.tags.split(',').forEach((t: string) => {
      const tag = t.trim();
      d.prepare('INSERT OR IGNORE INTO backlog_tags (name) VALUES (?)').run(tag);
      const tid = (d.prepare('SELECT id FROM backlog_tags WHERE name=?').get(tag) as { id: number })
        .id;
      d.prepare('INSERT OR IGNORE INTO backlog_item_tags (item_id,tag_id) VALUES (?,?)').run(
        id,
        tid,
      );
    });

  console.log(`  ${C.green}✅ Updated: ${id}${C.reset}`);
}

function cmdComment(args: Record<string, string>): void {
  const id = args._id;
  if (!id || !args.text) {
    console.error('<id> and --text required');
    process.exit(1);
  }
  db()
    .prepare('INSERT INTO backlog_comments (item_id,content,author) VALUES (?,?,?)')
    .run(id, args.text, args.author ?? 'system');
  console.log(`  ${C.green}✅ Comment added to ${id}${C.reset}`);
}

function cmdRelate(args: Record<string, string>): void {
  const types = ['duplicates', 'blocked_by', 'related', 'supersedes', 'child_of', 'parent_of'];
  if (!args._id || !args._related) {
    console.error('<id> <related-id> required');
    process.exit(1);
  }
  const rel = args.type ?? 'related';
  if (!types.includes(rel)) {
    console.error(`--type must be: ${types.join(', ')}`);
    process.exit(1);
  }
  db()
    .prepare(
      'INSERT OR IGNORE INTO backlog_related_items (item_id,related_item_id,relation_type) VALUES (?,?,?)',
    )
    .run(args._id, args._related, rel);
  console.log(`  ${C.green}✅ ${args._id} → ${rel} → ${args._related}${C.reset}`);
}

function cmdSearch(query: string): void {
  if (!query) {
    console.error('query required');
    process.exit(1);
  }
  const rows = db()
    .prepare(
      `SELECT bi.*,GROUP_CONCAT(DISTINCT bt.name) as tags
    FROM backlog_items bi LEFT JOIN backlog_item_tags bit ON bi.id=bit.item_id LEFT JOIN backlog_tags bt ON bit.tag_id=bt.id
    WHERE bi.title LIKE ? OR bi.description LIKE ? GROUP BY bi.id ORDER BY bi.created_at DESC LIMIT 10`,
    )
    .all(`%${query}%`, `%${query}%`) as any[];
  if (!rows.length) {
    console.log(`No similar items for "${query}"`);
    return;
  }
  console.log(`Similar items for "${query}":\n`);
  rows.forEach((r: any) =>
    console.log(`  ${r.id} [${r.type}/${r.severity}/${r.status}]  ${r.title}`),
  );
}

function cmdStats(): void {
  const d = db();
  const total = (d.prepare('SELECT COUNT(*) as c FROM backlog_items').get() as { c: number }).c;
  const open = (
    d
      .prepare(
        "SELECT COUNT(*) as c FROM backlog_items WHERE status NOT IN ('resolved','wont_fix','duplicate')",
      )
      .get() as { c: number }
  ).c;
  const byStatus = d
    .prepare('SELECT status,COUNT(*) as count FROM backlog_items GROUP BY status')
    .all() as any[];
  const bySeverity = d
    .prepare('SELECT severity,COUNT(*) as count FROM backlog_items GROUP BY severity')
    .all() as any[];
  const byType = d
    .prepare('SELECT type,COUNT(*) as count FROM backlog_items GROUP BY type')
    .all() as any[];

  console.log(`\n  Backlog Stats:`);
  console.log(`  ${C.cyan}Total: ${total}  |  Open: ${open}${C.reset}\n`);
  console.log('  By Status:');
  byStatus.forEach((s: any) =>
    console.log(`    ${staColor(s.status)}${s.status.padEnd(12)}${C.reset} ${s.count}`),
  );
  console.log('\n  By Severity:');
  bySeverity.forEach((s: any) =>
    console.log(`    ${sevColor(s.severity)}${s.severity.padEnd(10)}${C.reset} ${s.count}`),
  );
  console.log('\n  By Type:');
  byType.forEach((s: any) => console.log(`    ${s.type.padEnd(14)} ${s.count}`));
  console.log('');
}

function cmdReport(args: Record<string, string>): void {
  const fmt = args.format ?? 'table';
  const d = db();
  const rows = d
    .prepare(
      `SELECT bi.*,GROUP_CONCAT(DISTINCT bt.name) as tags
    FROM backlog_items bi LEFT JOIN backlog_item_tags bit ON bi.id=bit.item_id LEFT JOIN backlog_tags bt ON bit.tag_id=bt.id
    GROUP BY bi.id ORDER BY CASE bi.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, bi.created_at DESC`,
    )
    .all() as any[];

  if (fmt === 'markdown') {
    console.log('# Backlog Report\n');
    console.log(`Generated: ${new Date().toISOString().substring(0, 10)}\n`);
    console.log('| ID | Type | Severity | Status | Title | Tags |');
    console.log('|---|---|---|---|---|---|');
    rows.forEach((r: any) =>
      console.log(
        `| ${r.id} | ${r.type} | ${r.severity} | ${r.status} | ${(r.title as string).replace(/\|/g, '/')} | ${r.tags ?? ''} |`,
      ),
    );
    console.log(`\n*Total: ${rows.length} items*`);
  } else {
    cmdList(args);
  }
}

function cmdDelete(id: string): void {
  if (!id) {
    console.error('<id> required');
    process.exit(1);
  }
  const r = db().prepare('SELECT title FROM backlog_items WHERE id=?').get(id) as any;
  if (!r) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }
  console.log(`Deleting: ${id} — ${r.title}`);
  db().prepare('DELETE FROM backlog_items WHERE id=?').run(id);
  console.log(`  ${C.green}✅ Deleted: ${id}${C.reset}`);
}

// ─── Main ──────────────────────────────────────────────────────────

function main(): void {
  const cmd = process.argv[2];
  const args: Record<string, string> = {};
  for (let i = 3; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const [k, ...v] = a.substring(2).split('=');
      args[k] = v.join('=') || process.argv[++i] || '';
    } else if (!args._id) {
      args._id = a;
    } else if (!args._related) {
      args._related = a;
    }
  }

  switch (cmd) {
    case 'add':
      cmdAdd(args);
      break;
    case 'list':
    case 'ls':
      cmdList(args);
      break;
    case 'get':
    case 'show':
      cmdGet(args._id);
      break;
    case 'update':
    case 'up':
      cmdUpdate(args);
      break;
    case 'comment':
      cmdComment(args);
      break;
    case 'relate':
      cmdRelate(args);
      break;
    case 'search':
      cmdSearch(args._id);
      break;
    case 'stats':
      cmdStats();
      break;
    case 'report':
      cmdReport(args);
      break;
    case 'delete':
    case 'rm':
      cmdDelete(args._id);
      break;
    default:
      console.log(`
Backlog Management CLI — Nexus DB (SQLite)

Usage:
  add       --type <type> --title "<title>" [--severity <s>] [--description <d>]
            [--tags "t1,t2"] [--source <src>] [--session <id>] [--comment <t>]
  list      [--status <s>] [--severity <s>] [--type <t>] [--tag <t>]
            [--search <q>] [--limit N]
  get       <id>
  update    <id> [--status <s>] [--severity <s>] [--notes <t>] [--comment <t>]
  comment   <id> --text <text> [--author <name>]
  relate    <id> <related-id> --type <relation>
  search    <query>
  stats
  report    [--format markdown]
  delete    <id>

Types: incident, bug, warning, error, requirement, task, gap
Severities: critical, high, medium, low
Statuses: open, in_progress, resolved, wont_fix, backlog, duplicate
Relations: duplicates, blocked_by, related, supersedes, child_of, parent_of
`);
  }
}

main();
