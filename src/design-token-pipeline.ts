#!/usr/bin/env node
/**
 * Design Token Pipeline — reads config/brand.json and generates:
 *   1. assets/tokens.css — CSS custom properties for the design system
 *   2. assets/tokens.json — Flat token map for JS consumption
 *   3. assets/tokens.scss — SCSS variables for Sass projects
 *
 * Usage:
 *   npx tsx src/design-token-pipeline.ts                    # Generate all formats
 *   npx tsx src/design-token-pipeline.ts --watch             # Watch brand.json for changes
 *   npx tsx src/design-token-pipeline.ts --format css        # CSS only
 *   npx tsx src/design-token-pipeline.ts --json              # JSON output of generated files
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, watchFile } from 'fs';
import { resolve, dirname, basename } from 'path';
import { runNpxTsxSync } from './core/run-command.js';

interface BrandConfig {
  name: string;
  displayName: string;
  tagline: string;
  colors: Record<string, string>;
  gradients: Record<string, { from: string; to: string; direction: string }>;
  typography: {
    displayFont: string;
    bodyFont: string;
    monoFont: string;
    weight: Record<string, number>;
    letterSpacing: Record<string, string>;
  };
  cli: Record<string, string>;
}

interface GeneratedFile {
  path: string;
  format: string;
  size: number;
  tokens: number;
}

const CSS_FILE = 'assets/tokens.css';
const JSON_FILE = 'assets/tokens.json';
const SCSS_FILE = 'assets/tokens.scss';

function parseArgs(): { watch: boolean; format: string; json: boolean; brand: string } {
  const raw = process.argv.slice(2);
  return {
    watch: raw.includes('--watch'),
    format: extractArg(raw, '--format') || 'all',
    json: raw.includes('--json'),
    brand: extractArg(raw, '--brand') || 'config/brand.json',
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function loadBrand(brandPath: string): BrandConfig {
  const fullPath = resolve(process.cwd(), brandPath);
  if (!existsSync(fullPath)) {
    console.error(`[TOKENS] Brand config not found: ${brandPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(fullPath, 'utf8')) as BrandConfig;
}

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function generateCSS(brand: BrandConfig): string {
  let css = `/* Gentle-Vanguard Design Tokens */
/* Auto-generated from ${'config/brand.json'} — DO NOT EDIT DIRECTLY */
/* Generated: ${new Date().toISOString()} */

:root {\n`;

  // Colors
  for (const [key, value] of Object.entries(brand.colors)) {
    const varName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    css += `  --gv-color-${varName}: ${value};\n`;
  }

  // CLI colors
  css += '\n  /* CLI Theme */\n';
  for (const [key, value] of Object.entries(brand.cli || {})) {
    const varName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    css += `  --gv-cli-${varName}: ${value};\n`;
  }

  // Typography
  css += '\n  /* Typography */\n';
  css += `  --gv-font-display: ${brand.typography.displayFont};\n`;
  css += `  --gv-font-body: ${brand.typography.bodyFont};\n`;
  css += `  --gv-font-mono: ${brand.typography.monoFont};\n`;

  for (const [key, value] of Object.entries(brand.typography.weight)) {
    css += `  --gv-font-weight-${key}: ${value};\n`;
  }
  for (const [key, value] of Object.entries(brand.typography.letterSpacing || {})) {
    css += `  --gv-letter-spacing-${key}: ${value};\n`;
  }

  // Gradients
  css += '\n  /* Gradients */\n';
  for (const [key, value] of Object.entries(brand.gradients)) {
    const varName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    const direction =
      value.direction === 'vertical'
        ? 'to bottom'
        : value.direction === 'diagonal'
          ? '135deg'
          : 'to right';
    css += `  --gv-gradient-${varName}: linear-gradient(${direction}, ${value.from}, ${value.to});\n`;
  }

  // Brand info
  css += '\n  /* Brand */\n';
  css += `  --gv-brand-name: "${brand.displayName}";\n`;
  css += `  --gv-brand-tagline: "${brand.tagline}";\n`;

  css += '}\n';

  return css;
}

function generateJSON(brand: BrandConfig): string {
  const flat: Record<string, string> = {};

  for (const [key, value] of Object.entries(brand.colors)) {
    flat[`color.${kebabToCamel(key)}`] = value;
  }
  for (const [key, value] of Object.entries(brand.cli || {})) {
    flat[`cli.${kebabToCamel(key)}`] = value;
  }
  flat['typography.displayFont'] = brand.typography.displayFont;
  flat['typography.bodyFont'] = brand.typography.bodyFont;
  flat['typography.monoFont'] = brand.typography.monoFont;

  return JSON.stringify(
    { meta: { generated: new Date().toISOString(), source: 'config/brand.json' }, tokens: flat },
    null,
    2,
  );
}

function generateSCSS(brand: BrandConfig): string {
  let scss = `// Gentle-Vanguard Design Tokens (SCSS)
// Auto-generated from config/brand.json — DO NOT EDIT DIRECTLY

`;

  for (const [key, value] of Object.entries(brand.colors)) {
    const varName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    scss += `$gv-color-${varName}: ${value};\n`;
  }

  scss += '\n// Typography\n';
  scss += `$gv-font-display: ${brand.typography.displayFont};\n`;
  scss += `$gv-font-body: ${brand.typography.bodyFont};\n`;
  scss += `$gv-font-mono: ${brand.typography.monoFont};\n`;

  scss += '\n// Gradients\n';
  for (const [key, value] of Object.entries(brand.gradients)) {
    const varName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    const direction =
      value.direction === 'vertical'
        ? 'to bottom'
        : value.direction === 'diagonal'
          ? '135deg'
          : 'to right';
    scss += `$gv-gradient-${varName}: linear-gradient(${direction}, ${value.from}, ${value.to});\n`;
  }

  return scss;
}

function writeTokenFile(filePath: string, content: string): GeneratedFile {
  const fullPath = resolve(process.cwd(), filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  const lines = content.split('\n').filter((l) => l.includes(':') || l.includes(';'));
  const tokenCount = lines.length;
  return {
    path: fullPath,
    format: basename(filePath).split('.').pop() || 'unknown',
    size: Buffer.byteLength(content, 'utf8'),
    tokens: tokenCount,
  };
}

function main(): void {
  const args = parseArgs();
  const brand = loadBrand(args.brand);

  const generated: GeneratedFile[] = [];
  const format = args.format;

  if (format === 'all' || format === 'css') {
    generated.push(writeTokenFile(CSS_FILE, generateCSS(brand)));
  }
  if (format === 'all' || format === 'json') {
    generated.push(writeTokenFile(JSON_FILE, generateJSON(brand)));
  }
  if (format === 'all' || format === 'scss') {
    generated.push(writeTokenFile(SCSS_FILE, generateSCSS(brand)));
  }

  // Also regenerate SVG banners
  try {
    runNpxTsxSync('src/cli/svg-generator.ts', ['--brand', args.brand], {
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    generated.push({
      path: resolve(process.cwd(), 'assets/'),
      format: 'svg',
      size: 0,
      tokens: 0,
    });
  } catch {
    /* SVG generation skipped */
  }

  if (args.json) {
    console.log(JSON.stringify(generated, null, 2));
    process.exit(0);
  }

  console.log(`\n🎨 Design Token Pipeline`);
  console.log(`   Source: ${args.brand}`);
  console.log(`   Generated:`);
  for (const f of generated) {
    const sizeKB = (f.size / 1024).toFixed(1);
    console.log(
      `   ✅ ${f.path.replace(process.cwd() + '\\', '')} (${sizeKB} KB, ${f.tokens} tokens)`,
    );
  }

  // Watch mode
  if (args.watch) {
    const brandPath = resolve(process.cwd(), args.brand);
    console.log(`\n   👀 Watching ${args.brand} for changes... (Ctrl+C to stop)`);
    watchFile(brandPath, { interval: 2000 }, () => {
      console.log(`\n   🔄 Change detected, regenerating...`);
      try {
        const updatedBrand = loadBrand(args.brand);
        if (format === 'all' || format === 'css')
          writeTokenFile(CSS_FILE, generateCSS(updatedBrand));
        if (format === 'all' || format === 'json')
          writeTokenFile(JSON_FILE, generateJSON(updatedBrand));
        if (format === 'all' || format === 'scss')
          writeTokenFile(SCSS_FILE, generateSCSS(updatedBrand));
        console.log(`   ✅ Tokens regenerated`);
      } catch (err) {
        console.error(`   ❌ Error: ${err}`);
      }
    });

    // Keep alive
    process.on('SIGINT', () => {
      process.exit(0);
    });
    setInterval(() => {}, 60000);
  }
}

main();
