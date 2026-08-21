#!/usr/bin/env node
/**
 * Document Analysis Orchestrator init — lightweight pass-through for pipeline.
 * TS migration of skills/document-analysis-skill/invoke-document-analysis.ps1
 * Full analysis requires DocumentPath; init mode just validates and returns.
 */

import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

function findProjectRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (!parent || parent === current) break;
    current = parent;
  }
  return dir;
}

const projectRoot = findProjectRoot(ROOT);

function main(): void {
  const args = process.argv.slice(2);
  const docPath = args.includes('--document-path') ? args[args.indexOf('--document-path') + 1] : '';
  const quiet = args.includes('--quiet');

  if (!docPath) {
    if (!quiet) console.log('[document-analysis-init] No DocumentPath provided, skipping analysis');
    console.log(JSON.stringify({ status: 'skipped', reason: 'no_document_path' }));
    return;
  }

  const analysisDir = join(projectRoot, '.session', 'document-analysis');
  const outputDir = join(projectRoot, 'docs', 'requirements-analysis');
  mkdirSync(analysisDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  if (!existsSync(docPath)) {
    console.error(`[ERROR] Document not found: ${docPath}`);
    console.log(JSON.stringify({ status: 'error', error: 'Document not found' }));
    process.exit(1);
  }

  if (!quiet) console.log(`[document-analysis-init] Document ready: ${docPath}`);
  console.log(JSON.stringify({ status: 'ready', document: docPath }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
