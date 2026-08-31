#!/usr/bin/env node
/**
 * Secret Scanner — native secrets / API keys detection engine (TypeScript).
 *
 * Absorbs the DETECTION KNOWLEDGE of cariddi (Go, GPL-3.0) as an original
 * TypeScript implementation. The credential formats below are public technical
 * facts (provider-documented token layouts); the code, structure, types and
 * scanning pipeline are our own. No GPL code is copied or derived.
 *
 * Features:
 *   - 80+ detection patterns across AWS / GCP / Azure / GitHub / GitLab / LLM /
 *     Slack / payments / cloud / generic / private-key categories.
 *   - Optional Shannon entropy filter (>= threshold) to drop low-entropy
 *     false positives.
 *   - File scanning with basic .gitignore support, extension-based binary
 *     exclusion, configurable skip dirs and max file size (default 1 MB).
 *   - URL scanning via node:http/https (zero external dependencies).
 *   - Redaction helper (first 4 + last 4 chars) and risk report builder.
 *
 * Usage:
 *   npx tsx src/security/secret-scanner-cli.ts --scan <file|url>
 *   npx tsx src/security/secret-scanner-cli.ts --dir <dir>
 */

import { pathToFileURL } from 'node:url';

export * from './secret-scanner/patterns.js';
export * from './secret-scanner/config.js';
export * from './secret-scanner/entropy.js';
export * from './secret-scanner/ignore.js';
export * from './secret-scanner/scanner.js';
export * from './secret-scanner/report.js';

// ─── CLI entry guard ──────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Re-exported via secret-scanner-cli.ts; direct execution prints usage.
  console.error('Use: npx tsx src/security/secret-scanner-cli.ts --scan <file|url> [options]');
  process.exit(2);
}
