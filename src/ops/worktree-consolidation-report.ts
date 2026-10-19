#!/usr/bin/env node
/**
 * Read-only dirty-worktree classifier.
 *
 * It does not stage, commit, delete, move, or rewrite files. The goal is to turn
 * a large mixed worktree into reviewable consolidation blocks.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ChangeState = 'modified' | 'untracked' | 'deleted' | 'renamed' | 'other';

export interface ClassifiedChange {
  path: string;
  state: ChangeState;
  status: string;
  block: string;
  rationale: string;
}

export interface ConsolidationBlock {
  id: string;
  title: string;
  commitHint: string;
  risk: 'low' | 'medium' | 'high';
  suggestedChecks: string[];
  files: ClassifiedChange[];
}

export interface ConsolidationReport {
  generatedAt: string;
  root: string;
  readOnly: true;
  totalFiles: number;
  blocks: ConsolidationBlock[];
  recommendations: string[];
}

interface BlockRule {
  id: string;
  title: string;
  commitHint: string;
  risk: 'low' | 'medium' | 'high';
  rationale: string;
  suggestedChecks: string[];
  match: (path: string) => boolean;
}

const RULES: BlockRule[] = [
  {
    id: 'gv-knowledge-ops',
    title: 'GV Knowledge Ops native app',
    commitHint: 'feat(gv-knowledge-ops): add native operational knowledge app',
    risk: 'medium',
    rationale: 'New native app, docs, visual evidence, scheduled refresh, and app lifecycle wiring.',
    suggestedChecks: [
      'cd apps/gv-knowledge-ops && npm test',
      'npm run -s stack:doctor -- --json',
      'node --import tsx src/ops/gv-knowledge-refresh-scheduled.ts --offline',
    ],
    match: (path) =>
      path.startsWith('apps/gv-knowledge-ops/') ||
      path.startsWith('docs/apps/GV-KNOWLEDGE-OPS') ||
      path.startsWith('docs/changelog/2026-10-13-gv-knowledge-ops') ||
      path.startsWith('docs/changelog/2026-10-14-gv-knowledge-ops') ||
      path.startsWith('reports/audits/gv-knowledge-ops-visual-') ||
      path === 'src/ops/gv-knowledge-refresh-scheduled.ts',
  },
  {
    id: 'codex-engram-doctor',
    title: 'Codex Engram runtime binding hardening',
    commitHint: 'fix(stack-doctor): verify codex engram runtime session binding',
    risk: 'medium',
    rationale: 'Prevents false PASS when Codex config is valid but the current runtime session is not registered.',
    suggestedChecks: [
      'node --import tsx --test tests/unit/stack-doctor.test.ts',
      'npm run -s stack:doctor -- --json',
    ],
    match: (path) =>
      path === 'src/ops/stack-doctor.ts' ||
      path === 'tests/unit/stack-doctor.test.ts' ||
      path === 'docs/architecture/codex-engram-runtime-binding.md',
  },
  {
    id: 'tool-operability-audit',
    title: 'Multi-tool operability evidence',
    commitHint: 'docs(audit): record multi-tool interoperability status',
    risk: 'low',
    rationale: 'Dated evidence for OpenCode, Codex, ZCode, MiniMax, Copilot, Antigravity, and model catalog state.',
    suggestedChecks: ['npm run -s tools:audit', 'npm run -s stack:doctor -- --json'],
    match: (path) =>
      path.startsWith('reports/audits/tool-interoperability-') ||
      path === 'reports/audits/model-catalog-latest.json',
  },
  {
    id: 'app-lifecycle',
    title: 'App lifecycle and Command Center wiring',
    commitHint: 'feat(command-center): register gv knowledge ops lifecycle',
    risk: 'medium',
    rationale: 'Command Center, keepalive, and bootstrap changes affect app startup and scheduled maintenance.',
    suggestedChecks: [
      'pnpm exec vitest run apps/command-center/tests/command-center.test.ts --exclude ".kilo/**"',
      'npm run -s stack:doctor -- --json',
    ],
    match: (path) =>
      path === 'apps/command-center/server.ts' ||
      path === 'apps/command-center/tests/command-center.test.ts' ||
      path === 'apps/gv-agenda/README.md' ||
      path === 'config/apps-keepalive.json' ||
      path === 'src/infrastructure/bootstrap.ts',
  },
  {
    id: 'consolidation-tooling',
    title: 'Worktree consolidation tooling',
    commitHint: 'chore(stack): add worktree consolidation report',
    risk: 'low',
    rationale: 'Read-only classifier and tests for splitting a large dirty worktree into reviewable blocks.',
    suggestedChecks: [
      'node --import tsx --test tests/unit/worktree-consolidation-report.test.ts',
      'npm run -s stack:consolidation',
    ],
    match: (path) =>
      path === 'src/ops/worktree-consolidation-report.ts' ||
      path === 'tests/unit/worktree-consolidation-report.test.ts' ||
      path === 'package.json' ||
      path.startsWith('reports/audits/worktree-consolidation-') ||
      path.startsWith('reports/audits/block-verification-'),
  },
  {
    id: 'academy-content',
    title: 'Academy content and registry updates',
    commitHint: 'content(academy): add knowledge operations material',
    risk: 'medium',
    rationale: 'Academy course, registry, package, service worker, and related learning content changes.',
    suggestedChecks: [
      'cd apps/academy-web && npm test',
      'npm run -s stack:doctor -- --json',
    ],
    match: (path) => path.startsWith('apps/academy-web/'),
  },
  {
    id: 'commercial-client-docs',
    title: 'Client commercial documentation',
    commitHint: 'docs(clientes): update whatsapp bot viandas deliverables',
    risk: 'high',
    rationale: 'Client-facing Markdown, PDF, DOCX, and render tooling require separate business review.',
    suggestedChecks: [
      'python docs/clientes/whatsapp-bot-viandas/_build/verificar_render.py',
      'manual business review of Markdown/PDF/DOCX deliverables',
    ],
    match: (path) =>
      path.startsWith('docs/clientes/whatsapp-bot-viandas/') ||
      path === 'rules/NORMATIVA-DOCUMENTACION-CLIENTES.md',
  },
  {
    id: 'brand-system',
    title: 'Brand system assets and docs',
    commitHint: 'brand: update official assets and tokens',
    risk: 'medium',
    rationale: 'Brand tokens, official assets, derived rasters, and brand documentation.',
    suggestedChecks: [
      'npm run design:check',
      'cd apps/gv-knowledge-ops && npm test',
    ],
    match: (path) => path.startsWith('assets/brand/') || path === 'assets/tokens.json' || path.startsWith('docs/brand/'),
  },
  {
    id: 'stack-docs',
    title: 'Stack manuals, presentations, and templates',
    commitHint: 'docs(stack): update manuals and knowledge presentations',
    risk: 'medium',
    rationale: 'Operating manuals and presentation surfaces affect shared stack knowledge.',
    suggestedChecks: ['npm run -s stack:doctor -- --json', 'npm run -s tools:audit'],
    match: (path) =>
      path === 'AGENTS.md' ||
      path === 'README.md' ||
      path.startsWith('docs/presentations/') ||
      path.startsWith('docs/stack-manual-') ||
      path.startsWith('docs/templates/'),
  },
  {
    id: 'session-records',
    title: 'Session records and metrics',
    commitHint: 'docs(session): record stack consolidation evidence',
    risk: 'low',
    rationale: 'Session handoff, generated summaries, and monthly token metric snapshots.',
    suggestedChecks: ['npm run -s stack:consolidation', 'npm run -s stack:doctor -- --json'],
    match: (path) => path.startsWith('docs/sessions/') || path.startsWith('knowledge-base/04-sessions/'),
  },
];

const FALLBACK_RULE: BlockRule = {
  id: 'uncategorized',
  title: 'Uncategorized changes',
  commitHint: 'chore: review uncategorized worktree changes',
  risk: 'high',
  rationale: 'No consolidation rule matched this path; review before staging.',
  suggestedChecks: ['manual classification before staging'],
  match: () => true,
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^"|"$/g, '');
}

function parseState(status: string): ChangeState {
  if (status === '??') return 'untracked';
  if (status.includes('D')) return 'deleted';
  if (status.includes('R')) return 'renamed';
  if (status.includes('M')) return 'modified';
  return 'other';
}

export function classifyPath(path: string): Omit<ConsolidationBlock, 'files'> & { rationale: string } {
  const normalized = normalizePath(path);
  const rule = RULES.find((candidate) => candidate.match(normalized)) ?? FALLBACK_RULE;
  return {
    id: rule.id,
    title: rule.title,
    commitHint: rule.commitHint,
    risk: rule.risk,
    suggestedChecks: rule.suggestedChecks,
    rationale: rule.rationale,
  };
}

function parseStatusLine(line: string): { status: string; path: string } | undefined {
  if (!line.trim()) return undefined;
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath;
  return { status, path: normalizePath(renamedPath) };
}

function readGitStatus(root: string): Array<{ status: string; path: string }> {
  const output = execFileSync('git', ['status', '--short', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return output.split(/\r?\n/).map(parseStatusLine).filter((item): item is { status: string; path: string } => Boolean(item));
}

export function buildReport(
  root: string,
  statusEntries: Array<{ status: string; path: string }>,
  generatedAt = new Date().toISOString(),
): ConsolidationReport {
  const byBlock = new Map<string, ConsolidationBlock>();
  for (const entry of statusEntries) {
    const block = classifyPath(entry.path);
    if (!byBlock.has(block.id)) {
      byBlock.set(block.id, {
        id: block.id,
        title: block.title,
        commitHint: block.commitHint,
        risk: block.risk,
        suggestedChecks: block.suggestedChecks,
        files: [],
      });
    }
    byBlock.get(block.id)?.files.push({
      path: normalizePath(entry.path),
      status: entry.status,
      state: parseState(entry.status),
      block: block.id,
      rationale: block.rationale,
    });
  }

  const blocks = [...byBlock.values()]
    .map((block) => ({ ...block, files: block.files.sort((a, b) => a.path.localeCompare(b.path)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    generatedAt,
    root: resolve(root),
    readOnly: true,
    totalFiles: statusEntries.length,
    blocks,
    recommendations: [
      'Run npm run guard:snapshot before destructive cleanup or massive staging.',
      'Commit one block at a time; do not mix client documents with infrastructure changes.',
      'Review high-risk blocks manually before staging binary or client-facing artifacts.',
      'Keep generated audit evidence with the block it proves, or leave it out intentionally.',
    ],
  };
}

function renderMarkdown(report: ConsolidationReport): string {
  const lines = [
    '# Worktree consolidation report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Root: \`${report.root}\``,
    '',
    `Total files: ${report.totalFiles}`,
    '',
    '## Blocks',
    '',
  ];
  for (const block of report.blocks) {
    lines.push(`### ${block.title}`, '');
    lines.push(`- id: \`${block.id}\``);
    lines.push(`- risk: \`${block.risk}\``);
    lines.push(`- commit hint: \`${block.commitHint}\``);
    lines.push('- suggested checks:');
    for (const check of block.suggestedChecks) lines.push(`  - \`${check}\``);
    lines.push(`- files: ${block.files.length}`, '');
    for (const file of block.files) {
      lines.push(`- \`${file.status}\` \`${file.path}\``);
    }
    lines.push('');
  }
  lines.push('## Recommendations', '');
  for (const recommendation of report.recommendations) lines.push(`- ${recommendation}`);
  lines.push('');
  return lines.join('\n');
}

function writeReport(root: string, report: ConsolidationReport): void {
  const day = report.generatedAt.slice(0, 10);
  const outDir = join(root, 'reports', 'audits');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `worktree-consolidation-${day}.json`), JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(join(outDir, `worktree-consolidation-${day}.md`), renderMarkdown(report), 'utf8');
}

function main(): void {
  const root = resolve(process.cwd());
  if (!existsSync(join(root, '.git'))) {
    console.error('worktree-consolidation: run from the repository root');
    process.exit(1);
  }
  const report = buildReport(root, readGitStatus(root));
  if (process.argv.includes('--write')) writeReport(root, report);
  if (process.argv.includes('--md')) console.log(renderMarkdown(report));
  else console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
