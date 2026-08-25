#!/usr/bin/env node
/**
 * Design System CLI — generate token sets, export tokens, compute modular type
 * scales and check color contrast/accessibility in source files.
 *
 * Usage:
 *   npx tsx src/design/design-system-cli.ts --generate --primary #6366f1 --neutral slate
 *   npx tsx src/design/design-system-cli.ts --tokens --format css|json|scss
 *   npx tsx src/design/design-system-cli.ts --scale --base 16 --ratio 1.25 --levels 12
 *   npx tsx src/design/design-system-cli.ts --check ./components/Button.tsx
 *   npx tsx src/design/design-system-cli.ts --check --fg #ffffff --bg #1f2937
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import {
  accessibleTextOn,
  buildDesignTokens,
  checkPair,
  contrastRatio,
  generateColorScale,
  generateTypographyScale,
  resolveScale,
  tokensToCSS,
  tokensToSCSS,
  TYPOGRAPHY_RATIOS,
  type ColorStep,
  type ColorScale,
  type DesignTokens,
  type TokenConfig,
  type TypeSizeName,
} from './design-tokens.js';

interface CliArgs {
  command: 'generate' | 'tokens' | 'scale' | 'check';
  primary?: string;
  neutral?: string;
  semantic?: Partial<Record<'success' | 'warning' | 'error' | 'info', string>>;
  format?: 'css' | 'json' | 'scss';
  base?: number;
  ratio?: number;
  levels?: number;
  fg?: string;
  bg?: string;
  file?: string;
  output?: string;
}

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'config/design-tokens.json');

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: 'generate' };

  const flag = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx !== -1 && argv[idx + 1] !== undefined) return argv[idx + 1];
    return undefined;
  };
  const has = (name: string): boolean => argv.includes(name);

  if (has('--tokens')) args.command = 'tokens';
  else if (has('--scale')) args.command = 'scale';
  else if (has('--check')) args.command = 'check';
  else if (has('--generate')) args.command = 'generate';

  args.primary = flag('--primary');
  args.neutral = flag('--neutral');
  args.format = (flag('--format') as CliArgs['format']) ?? 'css';
  args.base = flag('--base') ? Number(flag('--base')) : undefined;
  args.ratio = flag('--ratio') ? Number(flag('--ratio')) : undefined;
  args.levels = flag('--levels') ? Number(flag('--levels')) : undefined;
  args.fg = flag('--fg');
  args.bg = flag('--bg');
  args.output = flag('--output');

  const semantic: CliArgs['semantic'] = {};
  for (const role of ['success', 'warning', 'error', 'info'] as const) {
    const value = flag(`--semantic-${role}`);
    if (value) semantic[role] = value;
  }
  args.semantic = semantic;

  // Positional file path (e.g. `design:check -- ./components/Button.tsx`),
  // skipping any values consumed by flags above.
  const flagNames = new Set([
    '--primary',
    '--neutral',
    '--format',
    '--base',
    '--ratio',
    '--levels',
    '--fg',
    '--bg',
    '--output',
    '--semantic-success',
    '--semantic-warning',
    '--semantic-error',
    '--semantic-info',
  ]);
  const positional = argv.find((a, i) => {
    if (a.startsWith('--')) return false;
    const prev = argv[i - 1];
    return !(prev !== undefined && flagNames.has(prev));
  });
  if (positional) args.file = positional;

  return args;
}

function readConfig(path = DEFAULT_CONFIG_PATH): DesignTokens | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { tokens: DesignTokens };
    return raw.tokens;
  } catch {
    return null;
  }
}

function buildConfigFromArgs(args: CliArgs): TokenConfig {
  return {
    name: 'design-system',
    primary: args.primary ?? '#00BFFF',
    neutral: args.neutral ?? 'slate',
    semantic: args.semantic,
    baseFontSize: args.base ?? 16,
    ratio: args.ratio ?? TYPOGRAPHY_RATIOS['major-third'],
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdGenerate(args: CliArgs): void {
  const config = buildConfigFromArgs(args);
  const tokens = buildDesignTokens(config);
  const outPath = resolve(process.cwd(), args.output ?? 'config/design-tokens.json');
  const payload = JSON.stringify(
    {
      meta: {
        generatedAt: new Date().toISOString(),
        primary: config.primary,
        neutral: config.neutral,
        ratio: config.ratio,
        baseFontSize: config.baseFontSize,
      },
      tokens,
    },
    null,
    2,
  );
  writeFileSync(outPath, payload);

  console.log(`🎨 Design tokens generated → ${outPath}`);
  console.log(`   primary: ${config.primary}  neutral: ${config.neutral}`);
  console.log(`   typography steps: ${Object.keys(tokens.typography.sizes).length}`);
  console.log(`   color steps per scale: ${Object.keys(tokens.colors.primary).length}`);
}

function cmdTokens(args: CliArgs): void {
  const tokens = readConfig() ?? buildDesignTokens(buildConfigFromArgs(args));
  const format = args.format ?? 'css';

  let output: string;

  if (format === 'css') {
    output = tokensToCSS(tokens);
  } else if (format === 'scss') {
    output = tokensToSCSS(tokens);
  } else if (format === 'json') {
    output = JSON.stringify(tokens, null, 2);
  } else {
    console.error(`Unknown format: ${format} (expected css|json|scss)`);
    process.exit(1);
  }

  if (args.output) {
    writeFileSync(resolve(process.cwd(), args.output), output!);
    console.log(`🎨 Design tokens exported → ${resolve(process.cwd(), args.output)}`);
  } else {
    console.log(output!);
  }
}

function cmdScale(args: CliArgs): void {
  const base = args.base ?? 16;
  const ratio = args.ratio ?? TYPOGRAPHY_RATIOS['major-third'];
  const levels = args.levels ?? 12;
  const scale = generateTypographyScale({ base, ratio });

  const names = Object.keys(scale) as TypeSizeName[];
  const shown = names.slice(0, levels);
  console.log(`Modular type scale — base ${base}px, ratio ${ratio} (${ratioLabel(ratio)})\n`);
  for (const name of shown) {
    const size = scale[name];
    console.log(
      `   ${name.padEnd(12)} ${String(size.px).padStart(3)}px  ${size.rem}rem  lh ${size.lineHeight}`,
    );
  }
  console.log(
    `\nAvailable ratios: ${Object.entries(TYPOGRAPHY_RATIOS)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  );
}

function ratioLabel(ratio: number): string {
  const entry = Object.entries(TYPOGRAPHY_RATIOS).find(([, v]) => Math.abs(v - ratio) < 0.001);
  return entry ? entry[0] : `${ratio}`;
}

function extractHexColors(content: string): string[] {
  const unique = new Set<string>();
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '#') continue;
    let hex = '';
    for (let j = i + 1; j < content.length && j <= i + 6; j++) {
      const ch = content[j];
      if (!/[0-9a-fA-F]/.test(ch)) break;
      hex += ch;
    }
    if (hex.length !== 3 && hex.length !== 6) continue;
    const expanded =
      hex.length === 3 ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : hex;
    unique.add(`#${expanded.toUpperCase()}`);
    i += hex.length;
  }
  return [...unique];
}

function cmdCheck(args: CliArgs): void {
  if (args.fg && args.bg) {
    const pair = checkPair(args.fg, args.bg);
    console.log(`Contrast ${args.fg} on ${args.bg}: ${pair.ratio.toFixed(2)}:1`);
    console.log(
      `   AA normal: ${pair.aaNormal ? 'PASS' : 'FAIL'} (4.5:1)  AA large: ${pair.aaLarge ? 'PASS' : 'FAIL'} (3:1)`,
    );
    console.log(
      `   AAA normal: ${pair.aaaNormal ? 'PASS' : 'FAIL'} (7:1)   AAA large: ${pair.aaaLarge ? 'PASS' : 'FAIL'} (4.5:1)`,
    );
    return;
  }

  if (!args.file || !existsSync(resolve(process.cwd(), args.file))) {
    console.error('Usage: design:check -- <file> | design:check -- --fg <hex> --bg <hex>');
    process.exit(1);
  }

  const content = readFileSync(resolve(process.cwd(), args.file), 'utf8');
  const colors = extractHexColors(content);
  if (colors.length === 0) {
    console.log(`No hex colors found in ${args.file}`);
    return;
  }

  console.log(`Checking ${colors.length} unique colors in ${args.file}\n`);
  let failures = 0;
  for (const color of colors) {
    const onWhite = checkPair(color, '#FFFFFF');
    const onBlack = checkPair(color, '#000000');
    const text = accessibleTextOn(color);
    const ratio = contrastRatio(text, color);
    const passes = ratio >= 4.5;
    if (!passes) failures += 1;
    console.log(
      `   ${color}  vs-white ${onWhite.ratio.toFixed(2)}  vs-black ${onBlack.ratio.toFixed(2)}  ` +
        `text ${text} ${ratio.toFixed(2)}:1 ${passes ? 'AA' : '⚠ AA FAIL'}`,
    );
  }
  console.log(
    `\n${failures === 0 ? '✅ All colors have an AA text pairing' : `⚠ ${failures} color(s) lack an AA text pairing`}`,
  );
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`Design System CLI

Usage:
  design:generate -- --primary <hex> [--neutral <name|hex>] [--semantic-success <hex> ...] [--output path]
  design:tokens -- --format css|json|scss
  design:scale -- --base 16 --ratio 1.25 --levels 12
  design:check -- ./path/to/component.tsx
  design:check -- --fg #ffffff --bg #1f2937

Named neutral palettes: slate, gray, zinc, neutral, stone
Named semantic palettes: blue, indigo, green, red, amber, purple, cyan
Type scale ratios: minor-second=1.067 major-second=1.125 minor-third=1.2 major-third=1.25
                  perfect-fourth=1.333 augmented-fourth=1.414 perfect-fifth=1.5 golden=1.618
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'generate':
      cmdGenerate(args);
      break;
    case 'tokens':
      cmdTokens(args);
      break;
    case 'scale':
      cmdScale(args);
      break;
    case 'check':
      cmdCheck(args);
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  accessibleTextOn,
  buildDesignTokens,
  checkPair,
  contrastRatio,
  extractHexColors,
  generateColorScale,
  generateTypographyScale,
  resolveScale,
  tokensToCSS,
  tokensToSCSS,
};
export type { CliArgs, ColorScale, ColorStep, DesignTokens, TypeSizeName };
