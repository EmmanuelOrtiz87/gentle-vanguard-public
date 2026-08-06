#!/usr/bin/env node
/**
 * SBOM Generator - Creates CycloneDX Software Bill of Materials
 * Usage: npx tsx src/generate-sbom.ts [--output path] [--format json|xml]
 */

import { runSync } from './core/run-command.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

interface SBOMOptions {
  output: string;
  format: 'json' | 'xml';
}

function parseArgs(): SBOMOptions {
  const args = process.argv.slice(2);
  let output = 'sbom/gentle-vanguard-sbom.json';
  let format: 'json' | 'xml' = 'json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      output = args[i + 1];
      i++;
    } else if (args[i] === '--format' || args[i] === '-f') {
      format = args[i + 1] as 'json' | 'xml';
      i++;
    }
  }

  return { output, format };
}

function generateSBOM(options: SBOMOptions): boolean {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  SBOM GENERATOR (CycloneDX)                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Format: ${options.format.toUpperCase()}`);
  console.log(`Output: ${options.output}`);
  console.log();

  // Ensure output directory exists
  const outputDir = dirname(options.output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Run pnpm native SBOM (pnpm-compatible, unlike cyclonedx-npm which relies on npm ls)
  const sbomFormat = options.format === 'xml' ? 'spdx' : 'cyclonedx';
  const result = runSync('pnpm', ['sbom', '--sbom-format', sbomFormat], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status === 0 && result.stdout) {
    writeFileSync(options.output, result.stdout, 'utf-8');
    console.log('✅ SBOM generated successfully');
    console.log();
    console.log('='.repeat(60));
    console.log(`📄 Output: ${options.output}`);
    console.log('='.repeat(60));

    // Read and display summary
    try {
      const sbom = JSON.parse(readFileSync(options.output, 'utf-8'));
      if (sbom.components) {
        console.log(`📦 Total components: ${sbom.components.length}`);
      }
      if (sbom.metadata?.timestamp) {
        console.log(`🕐 Generated: ${sbom.metadata.timestamp}`);
      }
      console.log('='.repeat(60));
    } catch {
      // Not JSON or couldn't read
    }

    return true;
  } else {
    console.error('❌ Failed to generate SBOM');
    if (result.stderr) {
      console.error(result.stderr);
    }
    return false;
  }
}

function main(): void {
  const options = parseArgs();
  const success = generateSBOM(options);
  process.exit(success ? 0 : 1);
}

main();
