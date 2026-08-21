#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

/* ── Interfaces ── */

interface FTRecord {
  instruction: string;
  input: string;
  output: string;
  domain: string;
  source: string;
  sourceRef: string;
  timestamp: string;
}

interface SkillEmbedding {
  terms?: string[];
  [key: string]: unknown;
}

/* ── Root resolution ── */

function resolveProjectRoot(): string {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return __dirname;
}

/* ── Helpers ── */

const results: FTRecord[] = [];

function addRecord(
  instruction: string,
  input: string,
  output: string,
  domain: string,
  source: string,
  sourceRef: string,
) {
  results.push({
    instruction,
    input,
    output,
    domain,
    source,
    sourceRef,
    timestamp: new Date().toISOString(),
  });
}

function readFileSafe(p: string): string | null {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

/* ── Collectors ── */

function collectSessionLogs(projectRoot: string) {
  console.log(`\x1b[90m  [FT] Collecting session logs...\x1b[0m`);
  const ctxDir = join(projectRoot, '.session', 'context-log');
  if (!existsSync(ctxDir)) return;

  const sessions = readdirSync(ctxDir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && d.name !== 'live-traceability-session' && d.name !== '__archive',
  );

  for (const s of sessions) {
    const sessionDir = join(ctxDir, s.name);
    let turnFiles: string[];
    try {
      turnFiles = readdirSync(sessionDir)
        .filter((f) => f.startsWith('turn-') && f.endsWith('.md'))
        .sort();
    } catch {
      continue;
    }

    const summaryPath = join(sessionDir, 'context-summary.md');
    const summary = readFileSafe(summaryPath) ?? '';

    for (const turnFile of turnFiles) {
      const turnPath = join(sessionDir, turnFile);
      const content = readFileSafe(turnPath) ?? '';
      if (!content) continue;

      const inTokensMatch = content.match(/Input Tokens\s*\|\s*(\d+)/);
      const inTokens = inTokensMatch ? parseInt(inTokensMatch[1], 10) : 0;
      const outTokensMatch = content.match(/Output Tokens\s*\|\s*(\d+)/);
      const outTokens = outTokensMatch ? parseInt(outTokensMatch[1], 10) : 0;
      (void inTokens, outTokens);

      addRecord(
        `Process turn in session ${s.name}`,
        summary.substring(0, Math.min(500, summary.length)),
        content,
        'DEV',
        'session-log',
        turnPath,
      );
    }
  }
  console.log(`\x1b[32m  [FT] Collected session logs\x1b[0m`);
}

function collectEngram(projectRoot: string) {
  console.log(`\x1b[90m  [FT] Collecting Engram observations...\x1b[0m`);
  const memDir = join(projectRoot, '.engram');
  if (!existsSync(memDir)) return;

  const files: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.json') || entry.name.endsWith('.md')) files.push(full);
      }
    } catch {
      // skip
    }
  }
  walk(memDir);

  let count = 0;
  for (const f of files) {
    const content = readFileSafe(f);
    if (!content || content.length < 50) continue;

    let domain = 'DEV';
    if (/\b(BA|business analyst|requirements|explore)\b/i.test(content)) domain = 'BA';
    else if (/\b(SAD|architect|design|spec|proposal)\b/i.test(content)) domain = 'SAD';
    else if (/\b(QA|test|verify|validate|bug)\b/i.test(content)) domain = 'QA';

    const titleMatch = content.match(/^#+\s+(.+)$/m);
    const title = titleMatch
      ? titleMatch[1]
      : (f
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.\w+$/, '') ?? '');

    addRecord(
      `Learn from past observation: ${title}`,
      `Domain: ${domain}. Source: Engram memory.`,
      content.substring(0, Math.min(1000, content.length)),
      domain,
      'engram',
      f,
    );
    count++;
  }
  console.log(`\x1b[32m  [FT] Collected ${count} Engram observations\x1b[0m`);
}

function collectSkills(projectRoot: string) {
  console.log(`\x1b[90m  [FT] Collecting skills...\x1b[0m`);
  const atlDir = join(projectRoot, '.atl');
  const regPath = join(atlDir, 'skill-registry.md');
  const embedPath = join(atlDir, 'skill-embeddings.json');

  if (existsSync(regPath)) {
    const content = readFileSafe(regPath) ?? '';
    addRecord(
      'Understand available skills for task routing',
      'Full skill registry',
      content.substring(0, Math.min(2000, content.length)),
      'BA',
      'skill-registry',
      regPath,
    );
  }

  if (existsSync(embedPath)) {
    const embedContent = readFileSafe(embedPath);
    if (embedContent) {
      try {
        const data = JSON.parse(embedContent) as SkillEmbedding;
        const terms = Array.isArray(data.terms) ? data.terms.length : 0;
        const meta = `Skills: ${Object.keys(data).length} | Terms: ${terms}`;
        addRecord(
          'Embedding metadata for skill routing',
          meta,
          JSON.stringify(data).substring(0, 1000),
          'DEV',
          'skill-embeddings',
          embedPath,
        );
      } catch {
        // skip
      }
    }
  }
  console.log(`\x1b[32m  [FT] Collected skill registry + embeddings\x1b[0m`);
}

function collectRoutingLogs(projectRoot: string) {
  console.log(`\x1b[90m  [FT] Collecting routing logs...\x1b[0m`);
  const delPath = join(projectRoot, 'config', 'auto-delegation.json');
  const qualPath = join(projectRoot, '.session', 'routing-quality-last.json');

  if (existsSync(delPath)) {
    const content = readFileSafe(delPath) ?? '';
    addRecord(
      'Route tasks to correct agent based on intent',
      'Auto-delegation configuration',
      content.substring(0, Math.min(3000, content.length)),
      'BA',
      'auto-delegation-config',
      delPath,
    );
  }

  if (existsSync(qualPath)) {
    const content = readFileSafe(qualPath) ?? '';
    addRecord(
      'Learn from past routing decisions and quality scores',
      'Routing quality metrics',
      content.substring(0, Math.min(2000, content.length)),
      'QA',
      'routing-quality',
      qualPath,
    );
  }
  console.log(`\x1b[32m  [FT] Collected routing configuration\x1b[0m`);
}

/* ── Main ── */

function main() {
  const args = process.argv.slice(2);
  const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'all';
  const outputPath = args.includes('--output-path') ? args[args.indexOf('--output-path') + 1] : '';
  const _force = args.includes('--force');
  void _force;

  const validSources = ['session', 'engram', 'skills', 'routing', 'all'];
  const resolvedSource = validSources.includes(source) ? source : 'all';

  const projectRoot = resolveProjectRoot();
  const outPath = outputPath || join(projectRoot, '.ft', 'dataset', 'raw');
  mkdirSync(outPath, { recursive: true });

  console.log(`\x1b[36m=== FT Data Collector ===\x1b[0m`);

  const sources =
    resolvedSource === 'all' ? ['session', 'engram', 'skills', 'routing'] : [resolvedSource];

  for (const s of sources) {
    switch (s) {
      case 'session':
        collectSessionLogs(projectRoot);
        break;
      case 'engram':
        collectEngram(projectRoot);
        break;
      case 'skills':
        collectSkills(projectRoot);
        break;
      case 'routing':
        collectRoutingLogs(projectRoot);
        break;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = join(outPath, `ft-raw-${timestamp.replace('T', '-')}.json`);
  writeFileSync(outputFile, JSON.stringify(results, null, 2), 'utf-8');

  console.log('');
  console.log(`\x1b[32m[FT] Complete: ${results.length} records → ${outputFile}\x1b[0m`);
  console.log(`\x1b[90m[FT] Domain breakdown:\x1b[0m`);

  const domainCount: Record<string, number> = {};
  for (const r of results) {
    domainCount[r.domain] = (domainCount[r.domain] ?? 0) + 1;
  }
  for (const [domain, count] of Object.entries(domainCount)) {
    console.log(`      ${domain}: ${count}`);
  }
}

main();
