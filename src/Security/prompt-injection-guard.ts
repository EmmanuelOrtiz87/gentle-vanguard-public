#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface DetectedPattern {
  pattern: string;
  type: string;
  match?: string;
  count?: number;
}

interface InjectionScoreResult {
  score: number;
  detectedPatterns: DetectedPattern[];
}

interface ScanLogEntry {
  timestamp: string;
  action: string;
  textLength: number;
  detected: boolean;
  riskScore: number;
  patterns: DetectedPattern[];
}

interface ScanResult {
  detected: boolean;
  riskScore: number;
  patterns: DetectedPattern[];
}

interface SanitizeResult {
  original: string;
  sanitized: string;
  modified: boolean;
  strictness: string;
}

interface InjectionConfig {
  enabled: boolean;
  strictness: string;
  blockOnDetection: boolean;
  knownPatterns: string[];
}

interface SafetyConfig {
  injectionProtection?: InjectionConfig;
  [key: string]: unknown;
}

function getRepoRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) return process.env.GENTLE_VANGUARD_BASE_DIR;
  const __filename = fileURLToPath(import.meta.url);
  let root = path.dirname(path.dirname(__filename));
  while (root && !fs.existsSync(path.join(root, 'config', 'orchestrator.json'))) {
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  if (!fs.existsSync(path.join(root, 'config', 'orchestrator.json'))) root = process.cwd();
  return root;
}

function loadConfig(root: string): SafetyConfig | null {
  const configPath = path.join(root, 'config', 'safety-layer.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return null;
}

function ensureAuditDir(root: string): string {
  const dir = path.join(root, '.session', 'safety', 'audit');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getKnownPatterns(config: SafetyConfig | null): string[] {
  if (config?.injectionProtection?.knownPatterns) {
    return config.injectionProtection.knownPatterns;
  }
  return ['ignore.*instructions', 'jailbreak', 'DAN'];
}

function getStrictness(strictnessArg: string, config: SafetyConfig | null): string {
  if (strictnessArg) return strictnessArg;
  if (config?.injectionProtection?.strictness) return config.injectionProtection.strictness;
  return 'medium';
}

function getInjectionScore(inputText: string, knownPatterns: string[]): InjectionScoreResult {
  const detected: DetectedPattern[] = [];
  let score = 0.0;

  for (const pattern of knownPatterns) {
    try {
      const re = new RegExp(pattern, 'i');
      const match = inputText.match(re);
      if (match) {
        detected.push({ pattern, type: 'known-pattern', match: match[0] });
        score += 0.3;
      }
    } catch {
      // skip invalid regex
    }
  }

  const codeBlockMatches = inputText.match(/```[\s\S]*?```/g);
  const codeBlocks = codeBlockMatches ? codeBlockMatches.length : 0;
  if (codeBlocks > 3) {
    detected.push({ pattern: 'excessive-code-blocks', type: 'structural', count: codeBlocks });
    score += 0.2;
  }

  const b64Matches = inputText.match(/[A-Za-z0-9+/]{40,}={0,2}/g);
  if (b64Matches && b64Matches.length > 0) {
    detected.push({ pattern: 'high-entropy-string', type: 'entropy', count: b64Matches.length });
    score += 0.2 * Math.min(b64Matches.length / 3, 1);
  }

  const roleRe = /(system\s*(prompt|message|instruction)|developer\s*override|assistant\s*role)/i;
  const roleMatch = inputText.match(roleRe);
  if (roleMatch) {
    detected.push({ pattern: 'role-injection', type: 'structural', match: roleMatch[0] });
    score += 0.3;
  }

  score = Math.min(score, 1.0);
  return { score, detectedPatterns: detected };
}

function invokeSanitization(inputText: string, level: string): string {
  let sanitized = inputText;

  switch (level) {
    case 'high':
      sanitized = sanitized.replace(
        /(ignore|forget|disregard|override)\s.*(instructions|rules|previous|all|system)/gi,
        '[REDACTED]',
      );
      sanitized = sanitized.replace(
        /system\s*(prompt|message|instruction|override)/gi,
        '[SYSTEM-REDACTED]',
      );
      sanitized = sanitized.replace(/[A-Za-z0-9+/]{50,}={0,2}/g, '[BASE64-DATA]');
      break;
    case 'medium':
      sanitized = sanitized.replace(/(ignore|forget|disregard)\s.*instructions/gi, '[REDACTED]');
      sanitized = sanitized.replace(/system\s*override/gi, '[SYSTEM-REDACTED]');
      break;
    case 'low':
      sanitized = sanitized.replace(/(DAN|jailbreak|do\.anything\.now)/gi, '[FLAGGED]');
      break;
  }

  return sanitized;
}

function doScan(text: string, knownPatterns: string[], auditDir: string): ScanResult {
  if (!text) {
    console.error('[INJECTION-GUARD] Provide --text to scan');
    process.exit(1);
  }

  const result = getInjectionScore(text, knownPatterns);
  const detected = result.score > 0;

  console.log(`\x1b[36m[INJECTION-GUARD] Scan result:\x1b[0m`);
  if (detected) {
    console.log(`\x1b[31m[INJECTION-GUARD] DETECTED — risk score: ${result.score}\x1b[0m`);
    for (const d of result.detectedPatterns) {
      console.log(`  \x1b[33m[${d.type}] ${d.pattern}\x1b[0m`);
    }
  } else {
    console.log(`\x1b[32m[INJECTION-GUARD] CLEAN — no injection detected\x1b[0m`);
  }

  const logEntry: ScanLogEntry = {
    timestamp: new Date().toISOString(),
    action: 'scan',
    textLength: text.length,
    detected,
    riskScore: result.score,
    patterns: result.detectedPatterns,
  };
  const logFile = path.join(
    auditDir,
    `injection-scan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2), 'utf-8');

  return { detected, riskScore: result.score, patterns: result.detectedPatterns };
}

function doSanitize(text: string, strictness: string): SanitizeResult {
  if (!text) {
    console.error('[INJECTION-GUARD] Provide --text to sanitize');
    process.exit(1);
  }

  const sanitized = invokeSanitization(text, strictness);
  const wasModified = sanitized !== text;

  if (wasModified) {
    console.log(`\x1b[33m[INJECTION-GUARD] Sanitized at strictness: ${strictness}\x1b[0m`);
  } else {
    console.log(`\x1b[32m[INJECTION-GUARD] No sanitization needed\x1b[0m`);
  }

  return { original: text, sanitized, modified: wasModified, strictness };
}

function doPatterns(knownPatterns: string[]): void {
  console.log(
    `\x1b[36m[INJECTION-GUARD] Known injection patterns (${knownPatterns.length}):\x1b[0m`,
  );
  for (const p of knownPatterns) {
    console.log(`  \x1b[33m• ${p}\x1b[0m`);
  }
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/security/prompt-injection-guard.ts --action <scan|sanitize|patterns> [--text <string>] [--strictness <low|medium|high>]`);
}

function parseArgs(): { action: string; text: string; strictness: string } {
  const args = process.argv.slice(2);
  let action = 'scan';
  let text = '';
  let strictness = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--action' && i + 1 < args.length) action = args[++i];
    else if (args[i] === '--text' && i + 1 < args.length) text = args[++i];
    else if (args[i] === '--strictness' && i + 1 < args.length) strictness = args[++i];
  }
  return { action, text, strictness };
}

function main(): void {
  const { action, text, strictness } = parseArgs();
  const root = getRepoRoot();
  const config = loadConfig(root);
  const knownPatterns = getKnownPatterns(config);
  const resolvedStrictness = getStrictness(strictness, config);
  const auditDir = ensureAuditDir(root);

  switch (action) {
    case 'scan':
      doScan(text, knownPatterns, auditDir);
      break;
    case 'sanitize':
      doSanitize(text, resolvedStrictness);
      break;
    case 'patterns':
      doPatterns(knownPatterns);
      break;
    default:
      console.error(`[INJECTION-GUARD] Unknown action: ${action}`);
      printUsage();
      process.exit(1);
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('prompt-injection-guard.ts'))
) {
  main();
}
