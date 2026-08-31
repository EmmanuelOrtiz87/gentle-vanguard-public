#!/usr/bin/env tsx
/**
 * backlog — Backlog & Requirements Management CLI
 *
 * Manages incidents, bugs, warnings, errors, requirements, and tasks
 * via Nexus DB (SQLite). Provides full CRUD, search, triage, and reporting.
 *
 * Usage:
 *   npx tsx src/cli/getBacklog().ts add --type bug --title "..." --severity high
 *   npx tsx src/cli/getBacklog().ts list [--status open] [--severity high] [--tag ps1-migration]
 *   npx tsx src/cli/getBacklog().ts update <id> --status resolved --notes "Fixed in commit xyz"
 *   npx tsx src/cli/getBacklog().ts get <id>
 *   npx tsx src/cli/getBacklog().ts search <query>
 *   npx tsx src/cli/getBacklog().ts comment <id> --text "..."
 *   npx tsx src/cli/getBacklog().ts relate <id> <related-id> --type supersedes
 *   npx tsx src/cli/getBacklog().ts stats
 *   npx tsx src/cli/getBacklog().ts report [--format markdown]
 *   npx tsx src/cli/getBacklog().ts delete <id>
 */

import {
  DatabaseManager,
  DEFAULT_TENANT_ID,
} from '../../apps/web-dashboard/server/database/manager';
import { pathToFileURL } from 'url';
import type {
  BacklogItem,
  BacklogRepo,
} from '../../apps/web-dashboard/server/database/repositories/BacklogRepo';

// ─── Resolve (lazy: DatabaseManager is a heavy better-sqlite3 singleton;
//      importing this module must stay side-effect free) ─────────────
const TENANT_ID = process.env.GENTLE_TENANT_ID ?? DEFAULT_TENANT_ID;

let backlogInstance: BacklogRepo | null = null;

function getBacklog(): BacklogRepo {
  if (!backlogInstance) {
    const database = DatabaseManager.getInstance();
    database.runMigrations();
    backlogInstance = database.backlog;
  }
  return backlogInstance;
}

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

  const id = getBacklog().addItem(
    {
      type: type as BacklogItem['type'],
      title,
      description: args.description ?? '',
      severity: severity as BacklogItem['severity'],
      status: status as BacklogItem['status'],
      source: args.source ?? '',
      session_id: args.session ?? undefined,
      assignee_role: args.assignee ?? 'any',
      estimated_hours: args.estimate ? parseFloat(args.estimate) : undefined,
      priority: parseInt(args.priority ?? '3'),
      target_release: args.release ?? undefined,
      environment: args.env ?? 'all',
      reported_by: args.reporter ?? undefined,
      impact: args.impact ?? 'minor',
    },
    TENANT_ID,
  );

  if (args.tags)
    args.tags.split(',').forEach((t: string) => {
      const tag = t.trim();
      getBacklog().addTagToItem(id, tag, undefined, TENANT_ID);
    });
  if (args.comment) getBacklog().addComment(id, args.comment, 'system', TENANT_ID);

  console.log(`  ${C.green}✅ Created: ${id}${C.reset}`);
  console.log(`  ${title}  [${type}/${severity}]`);
}

function cmdList(args: Record<string, string>): void {
  const limit = parseInt(args.limit ?? '50');
  const offset = parseInt(args.offset ?? '0');
  const filter = {
    status: args.status,
    severity: args.severity,
    type: args.type,
    tag: args.tag,
    search: args.search,
    limit,
    offset,
  };
  const rows = getBacklog().listItems(filter, TENANT_ID);
  const count = getBacklog().countItems(filter, TENANT_ID);

  if (!rows.length) {
    console.log('No items match.');
    return;
  }
  console.log(`Found ${count} item(s):\n`);
  for (const r of rows) {
    const t = r.tags?.length ? ` [${r.tags.join(',')}]` : '';
    console.log(
      `  ${sevColor(r.severity)}${r.severity.padEnd(8)}${C.reset} ${staColor(r.status)}${r.status.padEnd(12)}${C.reset} ${r.id.padEnd(20)} ${r.title.substring(0, 70)}${t}`,
    );
  }
  console.log(`\nTotal: ${count}`);
}

function cmdGet(id: string): void {
  const r = getBacklog().getItem(id, TENANT_ID);
  if (!r) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }

  const comments = getBacklog().getComments(id, TENANT_ID);
  const history = getBacklog().getStatusHistory(id, TENANT_ID);
  const related = getBacklog().getRelatedItems(id, TENANT_ID);

  console.log(`\n  ID:       ${r.id}`);
  console.log(`  Type:     ${r.type}`);
  console.log(`  Title:    ${r.title}`);
  console.log(`  Severity: ${sevColor(r.severity)}${r.severity}${C.reset}`);
  console.log(`  Status:   ${staColor(r.status)}${r.status}${C.reset}`);
  if (r.description) console.log(`  Desc:     ${r.description}`);
  if (r.source) console.log(`  Source:   ${r.source}`);
  if (r.tags?.length) console.log(`  Tags:     ${r.tags.join(',')}`);
  console.log(`  Created:  ${r.created_at}`);
  if (r.resolved_at) console.log(`  Resolved: ${r.resolved_at}`);
  if (r.resolution_notes) console.log(`  Notes:    ${r.resolution_notes}`);

  if (comments.length) {
    console.log(`\n  Comments:`);
    comments.forEach((c) => console.log(`    [${c.author}] ${c.content}`));
  }
  if (history.length > 1) {
    console.log(`\n  History:`);
    history.forEach((h) =>
      console.log(`    ${h.created_at.substring(0, 16)}  ${h.from_status ?? '-'} → ${h.to_status}`),
    );
  }
  if (related.length) {
    console.log(`\n  Related:`);
    related.forEach((r) => console.log(`    ${r.related_item_id}  [${r.relation_type}]`));
  }
  console.log('');
}

function cmdUpdate(args: Record<string, string>): void {
  const id = args._id;
  if (!id) {
    console.error('<id> required');
    process.exit(1);
  }
  if (!getBacklog().getItem(id, TENANT_ID)) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }
  const updates: Partial<BacklogItem> = {};
  if (args.status) updates.status = args.status as BacklogItem['status'];
  if (args.severity) updates.severity = args.severity as BacklogItem['severity'];
  if (args.title) updates.title = args.title;
  if (args.description) updates.description = args.description;
  if (args.notes) updates.resolution_notes = args.notes;
  if (args.assignee) updates.assignee_role = args.assignee;
  if (args.estimate) updates.estimated_hours = parseFloat(args.estimate);
  if (args.actual) updates.actual_hours = parseFloat(args.actual);
  if (args.priority) updates.priority = parseInt(args.priority);
  if (args.release) updates.target_release = args.release;
  if (args.env) updates.environment = args.env;
  if (args.reporter) updates.reported_by = args.reporter;
  if (args.impact) updates.impact = args.impact;

  if (!Object.keys(updates).length) {
    console.error('Nothing to update');
    process.exit(1);
  }
  getBacklog().updateItem(id, updates, TENANT_ID);

  if (args.comment) getBacklog().addComment(id, args.comment, 'system', TENANT_ID);
  if (args.tags)
    args.tags.split(',').forEach((t: string) => {
      const tag = t.trim();
      getBacklog().addTagToItem(id, tag, undefined, TENANT_ID);
    });

  console.log(`  ${C.green}✅ Updated: ${id}${C.reset}`);
}

function cmdComment(args: Record<string, string>): void {
  const id = args._id;
  if (!id || !args.text) {
    console.error('<id> and --text required');
    process.exit(1);
  }
  if (!getBacklog().getItem(id, TENANT_ID)) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }
  getBacklog().addComment(id, args.text, args.author ?? 'system', TENANT_ID);
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
  if (!getBacklog().getItem(args._id, TENANT_ID) || !getBacklog().getItem(args._related, TENANT_ID)) {
    console.error('Both items must belong to the selected tenant');
    process.exit(1);
  }
  getBacklog().relateItems(args._id, args._related, rel, TENANT_ID);
  console.log(`  ${C.green}✅ ${args._id} → ${rel} → ${args._related}${C.reset}`);
}

function cmdSearch(query: string): void {
  if (!query) {
    console.error('query required');
    process.exit(1);
  }
  const rows = getBacklog().searchSimilar(query, 10, TENANT_ID);
  if (!rows.length) {
    console.log(`No similar items for "${query}"`);
    return;
  }
  console.log(`Similar items for "${query}":\n`);
  rows.forEach((r) => console.log(`  ${r.id} [${r.type}/${r.severity}/${r.status}]  ${r.title}`));
}

function cmdStats(): void {
  const stats = getBacklog().getStats(TENANT_ID) as {
    total: number;
    open: number;
    byStatus: Array<{ status: string; count: number }>;
    bySeverity: Array<{ severity: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
  };
  const { total, open, byStatus, bySeverity, byType } = stats;

  console.log(`\n  Backlog Stats:`);
  console.log(`  ${C.cyan}Total: ${total}  |  Open: ${open}${C.reset}\n`);
  console.log('  By Status:');
  byStatus.forEach((s) =>
    console.log(`    ${staColor(s.status)}${s.status.padEnd(12)}${C.reset} ${s.count}`),
  );
  console.log('\n  By Severity:');
  bySeverity.forEach((s) =>
    console.log(`    ${sevColor(s.severity)}${s.severity.padEnd(10)}${C.reset} ${s.count}`),
  );
  console.log('\n  By Type:');
  byType.forEach((s) => console.log(`    ${s.type.padEnd(14)} ${s.count}`));
  console.log('');
}

function cmdReport(args: Record<string, string>): void {
  const fmt = args.format ?? 'table';
  const rows = getBacklog().listItems({}, TENANT_ID);

  if (fmt === 'markdown') {
    console.log('# Backlog Report\n');
    console.log(`Generated: ${new Date().toISOString().substring(0, 10)}\n`);
    console.log('| ID | Type | Severity | Status | Title | Tags |');
    console.log('|---|---|---|---|---|---|');
    rows.forEach((r) =>
      console.log(
        `| ${r.id} | ${r.type} | ${r.severity} | ${r.status} | ${r.title.replace(/\|/g, '/')} | ${r.tags?.join(',') ?? ''} |`,
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
  const r = getBacklog().getItem(id, TENANT_ID);
  if (!r) {
    console.error(`Not found: ${id}`);
    process.exit(1);
  }
  console.log(`Deleting: ${id} — ${r.title}`);
  getBacklog().deleteItem(id, TENANT_ID);
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

// CLI entry — guard keeps imports side-effect free when loaded as a library.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
