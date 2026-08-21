#!/usr/bin/env node

/**
 * mermaid-renderer.ts — Render .mmd Mermaid files to SVG/PNG images
 *
 * Uses Mermaid CLI (mmdc) to convert diagram definitions into rendered images.
 * Falls back to generating an HTML file with embedded Mermaid CDN if mmdc is unavailable.
 *
 * Usage:
 *   npx tsx src/cli/mermaid-renderer.ts --input docs/diagrams/flow.mmd --output docs/assets/flow.svg
 *   npx tsx src/cli/mermaid-renderer.ts --input-dir docs/diagrams/ --output-dir docs/assets/
 *   npx tsx src/cli/mermaid-renderer.ts --input-dir docs/diagrams/ --output-dir docs/assets/ --format png
 *   npx tsx src/cli/mermaid-renderer.ts --input docs/diagrams/flow.mmd --watch
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import { runSyncShell } from '../core/run-command.js';

const args = process.argv.slice(2);

interface Options {
  input: string;
  inputDir: string;
  output: string;
  outputDir: string;
  format: 'svg' | 'png' | 'html';
  watch: boolean;
  theme: string;
  backgroundColor: string;
  width: number;
}

const options: Options = {
  input: args.includes('--input') ? args[args.indexOf('--input') + 1] || '' : '',
  inputDir: args.includes('--input-dir') ? args[args.indexOf('--input-dir') + 1] || '' : '',
  output: args.includes('--output') ? args[args.indexOf('--output') + 1] || '' : '',
  outputDir: args.includes('--output-dir') ? args[args.indexOf('--output-dir') + 1] || '' : '',
  format: (args.includes('--format') ? args[args.indexOf('--format') + 1] || 'svg' : 'svg') as
    'svg' | 'png' | 'html',
  watch: args.includes('--watch') || args.includes('-Watch'),
  theme: args.includes('--theme') ? args[args.indexOf('--theme') + 1] || 'default' : 'default',
  backgroundColor: args.includes('--bg') ? args[args.indexOf('--bg') + 1] || 'white' : 'white',
  width: parseInt(
    args.includes('--width') ? args[args.indexOf('--width') + 1] || '1200' : '1200',
    10,
  ),
};

function ok(msg: string): void {
  console.log(`[OK] ${msg}`);
}
function warn(msg: string): void {
  console.log(`[WARN] ${msg}`);
}
function err(msg: string): void {
  console.error(`[ERROR] ${msg}`);
}
function step(msg: string): void {
  console.log(`\n=== ${msg} ===`);
}

const MERMAID_THEMES: Record<string, string> = {
  default: 'default',
  dark: 'dark',
  forest: 'forest',
  neutral: 'neutral',
  base: 'base',
};

function resolveTheme(t: string): string {
  return MERMAID_THEMES[t] || 'default';
}

/**
 * Check if mmdc (Mermaid CLI) is available
 */
function hasMmdc(): boolean {
  try {
    const r = runSyncShell('npx.cmd mmdc --version', { stdio: 'pipe', timeout: 10000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Render a single .mmd file using mmdc CLI
 */
function renderWithMmdc(inputFile: string, outputFile: string): boolean {
  const theme = resolveTheme(options.theme);
  const bgColor = options.backgroundColor;
  const width = options.width;

  try {
    const r = runSyncShell(
      `npx.cmd mmdc -i "${inputFile}" -o "${outputFile}" -t ${theme} -b ${bgColor} -w ${width}`,
      { stdio: 'pipe', timeout: 60000 },
    );
    return r.status === 0;
  } catch (e) {
    err(`mmdc render failed for ${basename(inputFile)}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Fallback: generate an HTML file with embedded Mermaid.js CDN
 */
function renderAsHtml(inputFile: string, outputFile: string): boolean {
  try {
    const mermaidCode = readFileSync(inputFile, 'utf-8');
    const title = basename(inputFile, '.mmd');
    const theme = resolveTheme(options.theme);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Mermaid Diagram</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    body { background: ${options.backgroundColor}; display: flex; justify-content: center; padding: 2rem; font-family: sans-serif; }
    .mermaid { max-width: ${options.width}px; }
  </style>
</head>
<body>
  <div class="mermaid">
${mermaidCode}
  </div>
  <script>
    mermaid.initialize({ theme: '${theme}', startOnLoad: true });
  </script>
</body>
</html>`;

    writeFileSync(outputFile, html, 'utf-8');
    return true;
  } catch (e) {
    err(`HTML fallback failed for ${basename(inputFile)}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Render a single file
 */
function renderFile(inputFile: string, outputFile: string): boolean {
  if (!existsSync(inputFile)) {
    err(`Input file not found: ${inputFile}`);
    return false;
  }

  if (extname(inputFile).toLowerCase() !== '.mmd') {
    warn(`Skipping non-.mmd file: ${inputFile}`);
    return false;
  }

  // Ensure output directory exists
  const outDir = dirname(outputFile);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  if (options.format === 'html') {
    return renderAsHtml(inputFile, outputFile);
  }

  if (hasMmdc()) {
    const ext = options.format === 'png' ? '.png' : '.svg';
    const imgOutput = outputFile.replace(/\.html$/, ext);
    return renderWithMmdc(inputFile, imgOutput);
  }

  // Fallback to HTML if mmdc not available
  warn('mmdc not found. Install with: npm install -g @mermaid-js/mermaid-cli');
  warn('Falling back to HTML output (open in browser to render)');
  const htmlOutput = outputFile.replace(/\.(svg|png)$/, '.html');
  return renderAsHtml(inputFile, htmlOutput);
}

/**
 * Watch a file for changes and auto-re-render
 */
function watchFile(inputFile: string, outputFile: string): void {
  step(`Watching ${basename(inputFile)} for changes...`);
  ok(`Will re-render to: ${outputFile}`);

  let timeout: NodeJS.Timeout | null = null;
  const fs = require('fs');
  fs.watch(inputFile, (eventType: string) => {
    if (eventType === 'change') {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        console.log(`\n[WATCH] Change detected in ${basename(inputFile)}`);
        renderFile(inputFile, outputFile);
        ok(`Re-rendered: ${outputFile}`);
      }, 500);
    }
  });

  console.log('Press Ctrl+C to stop watching.');
}

/**
 * Main
 */
async function main(): Promise<void> {
  step('Mermaid Renderer');

  // Single file mode
  if (options.input && options.output) {
    ok(`Rendering: ${options.input} → ${options.output}`);
    const success = renderFile(options.input, options.output);
    if (success) ok(`Output: ${options.output}`);
    else process.exit(1);

    if (options.watch) {
      watchFile(options.input, options.output);
      // Keep process alive
      await new Promise(() => {});
    }
    return;
  }

  // Directory mode
  if (options.inputDir) {
    if (!existsSync(options.inputDir)) {
      err(`Input directory not found: ${options.inputDir}`);
      process.exit(1);
    }

    const outDir = options.outputDir || options.inputDir;
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const mmdFiles = readdirSync(options.inputDir).filter((f) => f.endsWith('.mmd'));
    step(`Found ${mmdFiles.length} .mmd files in ${options.inputDir}`);

    let successCount = 0;
    let failCount = 0;

    for (const file of mmdFiles) {
      const inputFile = join(options.inputDir, file);
      const outputName = file.replace(
        '.mmd',
        `.${options.format === 'png' ? 'png' : options.format === 'html' ? 'html' : 'svg'}`,
      );
      const outputFile = join(outDir, outputName);

      process.stdout.write(`  Rendering ${file}... `);
      if (renderFile(inputFile, outputFile)) {
        console.log(`✅ ${outputName}`);
        successCount++;
      } else {
        console.log(`❌ FAILED`);
        failCount++;
      }
    }

    console.log('');
    ok(`Rendered: ${successCount} succeeded, ${failCount} failed, ${mmdFiles.length} total`);
    process.exit(failCount > 0 ? 1 : 0);
    return;
  }

  // No input specified
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx src/cli/mermaid-renderer.ts --input <file.mmd> --output <file.svg>');
  console.log(
    '  npx tsx src/cli/mermaid-renderer.ts --input-dir docs/diagrams/ --output-dir docs/assets/',
  );
  console.log(
    '  npx tsx src/cli/mermaid-renderer.ts --input file.mmd --output file.svg --format png --theme dark',
  );
  console.log('');
  console.log('Options:');
  console.log('  --input FILE         Single .mmd file to render');
  console.log('  --input-dir DIR      Directory of .mmd files to batch render');
  console.log('  --output FILE        Output file path');
  console.log('  --output-dir DIR     Output directory for batch mode');
  console.log('  --format svg|png|html Output format (default: svg)');
  console.log('  --theme default|dark|forest|neutral  Mermaid theme');
  console.log('  --bg COLOR           Background color (default: white)');
  console.log('  --width NUM          Output width in pixels (default: 1200)');
  console.log('  --watch              Watch file for changes and auto-re-render');
  console.log('');
  console.log('Note: For SVG/PNG output, install: npm install -g @mermaid-js/mermaid-cli');
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
