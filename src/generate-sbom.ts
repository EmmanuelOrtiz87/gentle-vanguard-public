#!/usr/bin/env node
/**
 * SBOM Generator - Creates CycloneDX Software Bill of Materials
 * Usage: npx tsx src/generate-sbom.ts [--output path] [--format json|xml] [--validate]
 */

import { runSync } from './core/run-command.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

interface SBOMOptions {
  output: string;
  format: 'json' | 'xml';
  validate: boolean;
}

function parseArgs(): SBOMOptions {
  const args = process.argv.slice(2);
  let output = 'sbom/gentle-vanguard-sbom.json';
  let format: 'json' | 'xml' = 'json';
  let validate = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      output = args[i + 1];
      i++;
    } else if (args[i] === '--format' || args[i] === '-f') {
      format = args[i + 1] as 'json' | 'xml';
      i++;
    } else if (args[i] === '--validate') {
      validate = true;
    }
  }

  return { output, format, validate };
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

function validateSBOM(options: SBOMOptions): boolean {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  SBOM VALIDATOR (CycloneDX)                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  const target = resolve(options.output);
  if (!existsSync(target)) {
    console.error(`❌ SBOM file not found: ${target}`);
    return false;
  }

  try {
    const raw = readFileSync(target, 'utf-8');
    const sbom = JSON.parse(raw);
    const errors: string[] = [];

    // 1. Core structure
    if (sbom.bomFormat !== 'CycloneDX') {
      errors.push(`bomFormat must be "CycloneDX", got "${sbom.bomFormat}"`);
    }
    if (!sbom.specVersion) {
      errors.push('missing specVersion');
    }
    if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
      errors.push('components must be a non-empty array');
    }
    if (!sbom.metadata?.timestamp) {
      errors.push('missing metadata.timestamp');
    }
    if (!Array.isArray(sbom.dependencies)) {
      errors.push('missing dependencies array (CycloneDX requires dependency graph)');
    }

    // 2. Coverage: every dependency in package.json must appear in components
    const pkgPath = resolve('package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const declared: Record<string, string> = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      const inSBOM = new Set(
        sbom.components.map(
          (c: { group?: string; name?: string }) => (c.group ? `${c.group}/` : '') + (c.name ?? ''),
        ),
      );
      const missing = Object.keys(declared).filter(
        (name) => !inSBOM.has(name) && !inSBOM.has(name.replace(/^@/, '')),
      );
      if (missing.length > 0) {
        errors.push(
          `dependencies missing from SBOM (${missing.length}): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`,
        );
      }
    }

    if (errors.length > 0) {
      console.error(
        `❌ SBOM validation FAILED (${errors.length} issue${errors.length > 1 ? 's' : ''}):`,
      );
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      return false;
    }

    console.log('✅ SBOM validation PASSED');
    console.log();
    console.log(`   bomFormat: ${sbom.bomFormat} ${sbom.specVersion}`);
    console.log(`   components: ${sbom.components.length}`);
    console.log(`   dependencies: ${sbom.dependencies?.length ?? 0}`);
    console.log(`   generated: ${sbom.metadata.timestamp}`);
    return true;
  } catch (err) {
    console.error(
      `❌ SBOM validation FAILED: invalid JSON or unexpected error: ${(err as Error).message}`,
    );
    return false;
  }
}

function main(): void {
  const options = parseArgs();
  if (options.validate) {
    const ok = validateSBOM(options);
    process.exit(ok ? 0 : 1);
  }
  const success = generateSBOM(options);
  process.exit(success ? 0 : 1);
}

main();
