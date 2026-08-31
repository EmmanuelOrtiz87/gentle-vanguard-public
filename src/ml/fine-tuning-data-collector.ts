#!/usr/bin/env node
/**
 * FT Data Collector — collects session logs, engram observations, skills, and routing data
 * for fine-tuning dataset generation.
 * TS migration of scripts/utilities/FINE-TUNING/ft-data-collector.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface FtRecord {
  instruction: string;
  input: string;
  output: string;
  domain: string;
  source: string;
  sourceRef: string;
  timestamp: string;
}

const ROOT = resolve(process.cwd());
const results: FtRecord[] = [];

function addRecord(
  instruction: string,
  input: string,
  output: string,
  domain: string,
  source: string,
  sourceRef: string,
): void {
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

function collectSessionLogs(): void {
  const ctxDir = join(ROOT, '.session', 'context-log');
  if (!existsSync(ctxDir)) return;

  let entries: string[];
  try {
    entries = readdirSync(ctxDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => n !== 'live-traceability-session' && n !== '__archive');
  } catch {
    return;
  }

  let turnCount = 0;
  for (const s of entries) {
    const sDir = join(ctxDir, s);
    let turnFiles: string[];
    try {
      turnFiles = readdirSync(sDir).filter((f) => f.startsWith('turn-') && f.endsWith('.md'));
    } catch {
      continue;
    }

    const summaryPath = join(sDir, 'context-summary.md');
    const summary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf-8') : '';

    for (const t of turnFiles) {
      const content = readFileSync(join(sDir, t), 'utf-8');

      addRecord(
        `Process turn in session ${s}`,
        summary.substring(0, 500),
        content,
        'DEV',
        'session-log',
        join(sDir, t),
      );
      turnCount++;
    }
  }
  console.log(`  [FT] Collected ${turnCount} turns from ${entries.length} sessions`);
}

function collectEngram(): void {
  const memDir = join(ROOT, '.engram');
  if (!existsSync(memDir)) return;

  const files: string[] = [];
  function walk(dir: string): void {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json') || e.name.endsWith('.md')) files.push(full);
      }
    } catch {
      /* skip */
    }
  }
  walk(memDir);

  let count = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf-8');
      if (content.length < 50) continue;

      let domain = 'DEV';
      if (/ba|business analyst|requirements|explore/i.test(content)) domain = 'BA';
      else if (/sad|architect|design|spec|proposal/i.test(content)) domain = 'SAD';
      else if (/qa|test|verify|validate|bug/i.test(content)) domain = 'QA';

      const titleMatch = content.match(/^#+\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : f.replace(/.*[\\/]/, '').replace(/\.[^/.]+$/, '');

      addRecord(
        `Learn from past observation: ${title}`,
        `Domain: ${domain}. Source: Engram memory.`,
        content.substring(0, 1000),
        domain,
        'engram',
        f,
      );
      count++;
    } catch {
      /* skip */
    }
  }
  console.log(`  [FT] Collected ${count} Engram observations`);
}

function collectSkills(): void {
  const regPath = join(ROOT, '.atl', 'skill-registry.md');
  const embedPath = join(ROOT, '.atl', 'skill-embeddings.json');

  if (existsSync(regPath)) {
    const content = readFileSync(regPath, 'utf-8');
    addRecord(
      'Understand available skills for task routing',
      'Full skill registry',
      content.substring(0, 2000),
      'BA',
      'skill-registry',
      regPath,
    );
  }
  if (existsSync(embedPath)) {
    const data = JSON.parse(readFileSync(embedPath, 'utf-8'));
    const meta = `Skills: ${Array.isArray(data) ? data.length : 0} | Terms: ${data.terms?.length || 0}`;
    addRecord(
      'Embedding metadata for skill routing',
      meta,
      JSON.stringify(data).substring(0, 1000),
      'DEV',
      'skill-embeddings',
      embedPath,
    );
  }
  console.log('  [FT] Collected skill registry + embeddings');
}

function collectRoutingLogs(): void {
  const delPath = join(ROOT, 'config', 'auto-delegation.json');
  const qualPath = join(ROOT, '.session', 'routing-quality-last.json');

  if (existsSync(delPath)) {
    const content = readFileSync(delPath, 'utf-8');
    addRecord(
      'Route tasks to correct agent based on intent',
      'Auto-delegation configuration',
      content.substring(0, 3000),
      'BA',
      'auto-delegation-config',
      delPath,
    );
  }
  if (existsSync(qualPath)) {
    const content = readFileSync(qualPath, 'utf-8');
    addRecord(
      'Learn from past routing decisions and quality scores',
      'Routing quality metrics',
      content.substring(0, 2000),
      'QA',
      'routing-quality',
      qualPath,
    );
  }
  console.log('  [FT] Collected routing configuration');
}

function main(): void {
  const args = process.argv.slice(2);
  const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'all';
  const outputPath = args.includes('--output-path')
    ? args[args.indexOf('--output-path') + 1]
    : join(ROOT, '.ft', 'dataset', 'raw');
  mkdirSync(outputPath, { recursive: true });

  console.log('=== FT Data Collector ===');
  const sources = source === 'all' ? ['session', 'engram', 'skills', 'routing'] : [source];
  for (const s of sources) {
    switch (s) {
      case 'session':
        collectSessionLogs();
        break;
      case 'engram':
        collectEngram();
        break;
      case 'skills':
        collectSkills();
        break;
      case 'routing':
        collectRoutingLogs();
        break;
    }
  }

  const outputFile = join(
    outputPath,
    `ft-raw-${new Date().toISOString().slice(0, 13).replace(/[:-]/g, '')}${new Date().getMinutes().toString().padStart(2, '0')}.json`,
  );
  writeFileSync(outputFile, JSON.stringify(results, null, 2), 'utf-8');

  console.log(`\n[FT] Complete: ${results.length} records → ${outputFile}`);

  const domains: Record<string, number> = {};
  for (const r of results) domains[r.domain] = (domains[r.domain] || 0) + 1;
  for (const [d, c] of Object.entries(domains)) console.log(`      ${d}: ${c}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
