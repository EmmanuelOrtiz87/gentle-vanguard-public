#!/usr/bin/env node
/**
 * Animation CLI — create presets and analyze files for animation opportunities.
 *
 * Usage:
 *   npx tsx src/animations/cli.ts create --name badge-pop --type scale --duration 300
 *   npx tsx src/animations/cli.ts analyze ./src/components/*.tsx [--json]
 *
 * `create` generates a preset entry and appends it to the PRESETS record.
 * `analyze` scans JSX/TS files and reports places that could benefit from a
 * micro-interaction (untimed transitions, hover transforms, list staggers).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

interface CliOptions {
  [key: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  opts['_'] = positional;
  return opts;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

interface CreateOptions {
  name: string;
  type: string;
  duration: number;
  easing: string;
  delay: number;
  stagger: number;
  loop: boolean;
  dryRun: boolean;
  out: string;
}

const DEFAULT_EASING_BY_TYPE: Record<string, string> = {
  fade: 'decelerate',
  slide: 'emphasized',
  scale: 'spring',
  stagger: 'decelerate',
  spring: 'emphasized',
  morph: 'decelerate',
};

/** Converts `badge-pop` to `badgePop` (valid JS identifier for the record key). */
function toCamelCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .split('-')
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
    .replace(/^[0-9]/, (d) => `n${d}`);
}

function buildPresetEntry(opts: CreateOptions): string {
  const name = toCamelCase(opts.name);
  const lines = [
    `  ${name}: {`,
    `    name: '${name}',`,
    `    duration: ${opts.duration},`,
    `    easing: '${opts.easing}',`,
  ];
  if (opts.delay > 0) lines.push(`    delay: ${opts.delay},`);
  if (opts.stagger > 0) lines.push(`    stagger: ${opts.stagger},`);
  if (opts.loop) lines.push(`    loop: true,`);
  lines.push(`  } satisfies AnimationPreset,`);
  return lines.join('\n');
}

function runCreate(opts: CreateOptions): void {
  const entry = buildPresetEntry(opts);
  if (opts.dryRun) {
    console.log('// Generated preset — dry run (no file written)');
    console.log(entry);
    return;
  }

  const target = resolve(opts.out);
  if (!existsSync(target)) {
    console.error(`Cannot append: ${target} does not exist. Pass --out <file>.`);
    process.exit(1);
  }

  const source = readFileSync(target, 'utf8');
  const marker = '} as const satisfies Record<string, AnimationPreset>;';
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex === -1) {
    console.error(`Cannot find PRESETS record terminator in ${target}.`);
    process.exit(1);
  }

  const updated = source.slice(0, markerIndex) + entry + '\n' + source.slice(markerIndex);
  writeFileSync(target, updated, 'utf8');
  console.log(`Added preset '${opts.name}' to ${target}`);
  console.log(entry);
}

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

interface AnimationOpportunity {
  file: string;
  line: number;
  category: string;
  hint: string;
  snippet: string;
}

const OPPORTUNITY_PATTERNS: Array<{
  category: string;
  hint: string;
  re: RegExp;
}> = [
  {
    category: 'untimed-transition',
    hint: 'Add a duration token (e.g. transition-transform duration-200) so the transition is perceptible and compositor-only.',
    re: /\btransition-\w+\b(?!.*duration-\d)/,
  },
  {
    category: 'hover-transform',
    hint: 'Hover/active transform without a transition — wrap with transition-transform for a smooth micro-interaction.',
    re: /\bhover:(?:scale|translate|rotate)-[^ ]*\b(?!.*transition)/,
  },
  {
    category: 'pressable',
    hint: 'Click target without press feedback — add a scalePop / active:scale press micro-interaction.',
    re: /\bonClick=/,
  },
  {
    category: 'conditional-visibility',
    hint: 'Opacity/hidden toggle — animate the transition instead of an instant swap (useExitAnimation or fade).',
    re: /\b(?:opacity-0|hidden|invisible)\b/,
  },
  {
    category: 'list-stagger',
    hint: 'List/grid rendered with map — stagger the entrance with staggerSequences(fadeIn(), count, { stagger: 60 }).',
    re: /\.map\(/,
  },
];

function collectFiles(patterns: string[]): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    const base = pattern.replace(/[*?]/g, '').split(/[\\/]/).slice(0, -1).join('/') || '.';
    const stem = pattern.includes('/') ? pattern.slice(0, pattern.lastIndexOf('/') + 1) : '';
    const filePart = pattern.slice(stem.length);
    const dir = resolve(base);
    if (!existsSync(dir)) continue;
    const walk = (current: string): void => {
      for (const entry of readdirSync(current)) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
        const full = join(current, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          walk(full);
        } else if (filePart.includes('*') || pattern.includes('*')) {
          const isMatch =
            filePart === '*' ||
            entry.endsWith(filePart.replace('*', '').replace(/^\./, '.')) ||
            (filePart.includes('.tsx') && entry.endsWith('.tsx')) ||
            (filePart.includes('.ts') && entry.endsWith('.ts')) ||
            (filePart.includes('.jsx') && entry.endsWith('.jsx'));
          if (isMatch) files.push(full);
        } else if (full === resolve(pattern)) {
          files.push(full);
        }
      }
    };
    walk(dir);
  }
  return [...new Set(files)].filter((f) => /\.(tsx|ts|jsx)$/.test(f));
}

function analyzeFiles(patterns: string[]): AnimationOpportunity[] {
  const files = collectFiles(patterns);
  const opportunities: AnimationOpportunity[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of OPPORTUNITY_PATTERNS) {
        const match = line.match(pattern.re);
        if (match) {
          opportunities.push({
            file,
            line: i + 1,
            category: pattern.category,
            hint: pattern.hint,
            snippet: line.trim().slice(0, 120),
          });
        }
      }
    }
  }
  return opportunities;
}

function runAnalyze(patterns: string[], json: boolean): void {
  if (patterns.length === 0) {
    console.error('No file patterns provided. Example: analyze "./src/components/*.tsx"');
    process.exit(1);
  }
  const opportunities = analyzeFiles(patterns);
  if (json) {
    console.log(JSON.stringify(opportunities, null, 2));
    return;
  }

  const byCategory = new Map<string, AnimationOpportunity[]>();
  for (const opp of opportunities) {
    const list = byCategory.get(opp.category) ?? [];
    list.push(opp);
    byCategory.set(opp.category, list);
  }

  console.log(`\nAnimation opportunities found: ${opportunities.length}`);
  for (const [category, list] of byCategory.entries()) {
    console.log(`\n[${category}] (${list.length})`);
    for (const opp of list.slice(0, 10)) {
      console.log(`  ${opp.file}:${opp.line}`);
      console.log(`    ${opp.snippet}`);
    }
    if (list.length > 10) console.log(`  ... and ${list.length - 10} more`);
  }
  console.log('\nHints:');
  const seen = new Set<string>();
  for (const opp of opportunities) {
    if (!seen.has(opp.category)) {
      seen.add(opp.category);
      console.log(`  - ${opp.category}: ${opp.hint}`);
    }
  }
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  const args = parseArgs(argv);
  const positional = (args['_'] as string[]) ?? [];
  const action = positional[0] ?? argv[0] ?? '';

  if (action === 'create') {
    const name = typeof args['name'] === 'string' ? args['name'] : '';
    if (!name) {
      console.error('Missing --name. Example: --name badge-pop');
      return 1;
    }
    runCreate({
      name,
      type: typeof args['type'] === 'string' ? args['type'] : 'scale',
      duration: Number(args['duration'] ?? 300),
      easing:
        typeof args['easing'] === 'string'
          ? args['easing']
          : DEFAULT_EASING_BY_TYPE[typeof args['type'] === 'string' ? args['type'] : 'scale'],
      delay: Number(args['delay'] ?? 0),
      stagger: Number(args['stagger'] ?? 0),
      loop: args['loop'] === true,
      dryRun: args['dry-run'] === true,
      out: typeof args['out'] === 'string' ? args['out'] : resolve('src/animations/presets.ts'),
    });
    return 0;
  }

  if (action === 'analyze') {
    const patterns = positional.slice(1);
    runAnalyze(patterns, args['json'] === true);
    return 0;
  }

  console.log(`
Gentle-Vanguard animation CLI

Usage:
  npx tsx src/animations/cli.ts create --name badge-pop --type scale --duration 300 [--easing spring] [--delay 0] [--stagger 0] [--loop] [--dry-run] [--out <presets.ts>]
  npx tsx src/animations/cli.ts analyze "./src/components/*.tsx" [--json]

Actions:
  create    Generate a preset entry and append it to src/animations/presets.ts
  analyze   Scan files for animation opportunities (untimed transitions, hover
            transforms, pressable targets, list staggers)
`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
