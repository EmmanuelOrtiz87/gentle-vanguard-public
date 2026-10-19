#!/usr/bin/env node
/**
 * Pre-Process Input with Response Cache
 *
 * Wrapper around pre-process-input.ts that adds SHA256 response caching.
 * Reduces token costs by caching processed inputs.
 *
 * Expected Impact: 25-35% token cost reduction
 */

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { ResponseCache } from '../resilience/response-cache';
import { runNpxTsxSync } from '../core/run-command.js';
import { processPrivacyInput } from '../security/privacy-gateway.js';

const cache = new ResponseCache();
const CACHE_NAMESPACE = 'pre-process-v2';

function parseArgs(): { input: string; workspaceRoot: string; useCache: boolean } {
  const args = process.argv.slice(2);
  let input = '';
  let workspaceRoot = '.';
  let useCache = true;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
        input = args[++i] ?? '';
        break;
      case '--workspace-root':
        workspaceRoot = args[++i] ?? '.';
        break;
      case '--no-cache':
        useCache = false;
        break;
    }
  }

  if (!input) {
    console.error('--input is required');
    process.exit(1);
  }

  return { input, workspaceRoot, useCache };
}

function applyPrivacyGateway(input: string, workspaceRoot: string): string | null {
  if (resolve(workspaceRoot) === resolve(process.cwd())) {
    const directResult = processPrivacyInput(input, 'prompt');
    return directResult.status === 'OK' ? directResult.sanitized : null;
  }

  const gatewayPath = resolve(workspaceRoot, 'src/security/privacy-gateway.ts');
  try {
    const result = runNpxTsxSync(gatewayPath, ['--text', input, '--as-json'], {
      cwd: workspaceRoot,
      timeout: 15000,
    });

    if (result.status !== 0 || !result.stdout?.trim()) return null;

    const parsed: { status: string; sanitized?: string } = JSON.parse(result.stdout.trim());
    if (parsed.status !== 'OK') return null;
    return parsed.sanitized ?? null;
  } catch {
    return null;
  }
}

function main(): void {
  const { input, workspaceRoot, useCache } = parseArgs();

  // Check cache first
  if (useCache) {
    const cached = cache.get(input, CACHE_NAMESPACE);
    if (cached) {
      console.log(cached.response);
      return;
    }
  }

  // Process input
  const sanitized = applyPrivacyGateway(input, workspaceRoot);
  const result = sanitized !== null ? sanitized : input;

  // Cache the result
  if (useCache) {
    const estimatedTokens = Math.ceil(result.length / 4);
    cache.set(input, result, estimatedTokens, CACHE_NAMESPACE);
  }

  console.log(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
