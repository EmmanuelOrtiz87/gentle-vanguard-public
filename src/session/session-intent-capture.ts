#!/usr/bin/env node
/**
 * Session Intent Capture
 *
 * Extrae y captura el objetivo/intención del usuario al inicio de la sesión.
 * Esto permite que el resumen de sesión sea más útil para futuras referencias.
 *
 * Patrones detectados:
 * - Implementación: "implement X", "add Y", "create Z"
 * - Investigación: "research", "investigate", "find information about"
 * - Revisión: "review", "audit", "check"
 * - Debugging: "fix", "debug", "solve", "issue"
 * - Documentación: "document", "write docs", "explain"
 * - Configuración: "setup", "configure", "install"
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

// Pattern matchers for different session types
const INTENT_PATTERNS = {
  implementation: [
    /^(implement|add|create|build|make|develop)\s+/i,
    /^(new|create|add)\s+(feature|component|module|function)/i,
    /need to (implement|add|create)\s+/i,
  ],
  research: [
    /^research\s+/i,
    /^investigate\s+/i,
    /^find\s+(information|details)\s+about/i,
    /^(search|look up|find out)\s+/i,
    /^(what is|how do|can you)\s+/i,
  ],
  review: [
    /^(review|audit|check|inspect)\s+/i,
    /^(look at|analyze)\s+/i,
    /evaluate\s+/i,
    /assess\s+/i,
  ],
  debugging: [
    /^(fix|debug|solve|resolve)\s+/i,
    /^(repair|patch)\s+/i,
    /^error\s+/i,
    /^(there's|theres|a)\s+(bug|issue|problem)/i,
    /^why\s+(does|is|are|won't)/i,
  ],
  documentation: [
    /^(document|write\s+(docs|documentation))/i,
    /^(explain|describe)\s+/i,
    /^(add|create)\s+docs?/i,
  ],
  configuration: [
    /^(setup|configure|install|init)/i,
    /^(set up|get started)/i,
    /^(migrate|move)\s+/i,
  ],
};

// Keywords that indicate file mentions
const FILE_KEYWORDS = [
  'in',
  'at',
  'to',
  'from',
  'inside',
  'within',
  'under',
  'the file',
  'the code',
  'the module',
  'the function',
  'src/',
  'lib/',
  'apps/',
  'packages/',
  'config/',
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
];

// Domain keywords for classification
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  security: ['security', 'auth', 'password', 'token', 'encryption', 'vulnerability', 'cve'],
  performance: ['performance', 'optimize', 'speed', 'latency', 'cache', 'memory'],
  database: ['database', 'db', 'sql', 'query', 'migration', 'schema'],
  api: ['api', 'endpoint', 'rest', 'graphql', 'http', 'request', 'response'],
  frontend: ['ui', 'component', 'react', 'vue', 'css', 'style', 'design'],
  backend: ['server', 'service', 'lambda', 'function', 'backend', 'api'],
  devops: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'pipeline', 'infrastructure'],
  testing: ['test', 'spec', 'mock', 'coverage', 'unittest', 'e2e'],
  documentation: ['doc', 'readme', 'comment', 'spec', 'guide', 'manual'],
};

export interface SessionIntent {
  goal: string;
  intent: string;
  domain: string;
  mentionedFiles: string[];
  initialPrompt: string;
}

/**
 * Extract intent from user's first prompt
 */
export function extractIntent(userPrompt: string): SessionIntent {
  const trimmed = userPrompt.trim();

  // Detect primary intent
  let detectedIntent = 'general';
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        detectedIntent = intent;
        break;
      }
    }
    if (detectedIntent !== 'general') break;
  }

  // Extract domain
  let domain = 'general';
  const lowerPrompt = trimmed.toLowerCase();
  for (const [d, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => lowerPrompt.includes(kw))) {
      domain = d;
      break;
    }
  }

  // Extract mentioned files (simple extraction)
  const mentionedFiles: string[] = [];
  for (const keyword of FILE_KEYWORDS) {
    const idx = lowerPrompt.indexOf(keyword);
    if (idx !== -1) {
      // Extract potential file path after keyword
      const after = trimmed.substring(idx + keyword.length).trim();
      const words = after.split(/\s+/).slice(0, 3).join(' ');
      if (words && !words.startsWith('http')) {
        mentionedFiles.push(words.replace(/[.,;]$/, ''));
      }
    }
  }

  // Clean up goal - extract the actionable part
  let goal = trimmed;
  // Remove common prefixes
  goal = goal.replace(/^(hey?|hi|hello|good (morning|afternoon|evening))[,.!]*/i, '');
  // Take first sentence or first 200 chars
  if (goal.includes('.')) {
    goal = goal.split('.')[0] + '.';
  }
  if (goal.length > 200) {
    goal = goal.substring(0, 197) + '...';
  }

  return {
    goal,
    intent: detectedIntent,
    domain,
    mentionedFiles: [...new Set(mentionedFiles)].slice(0, 5), // Dedupe, max 5
    initialPrompt: trimmed.substring(0, 1000), // Store first 1000 chars
  };
}

/**
 * Update session file with extracted intent
 */
export function updateSessionWithIntent(sessionFile: string, intent: SessionIntent): void {
  if (!existsSync(sessionFile)) {
    console.warn('[INTENT] Session file not found');
    return;
  }

  try {
    const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    data.goal = intent.goal;
    data.intent = intent.intent;
    data.domain = intent.domain;
    data.mentionedFiles = intent.mentionedFiles;
    data.initialPrompt = intent.initialPrompt;
    data.intentCapturedAt = new Date().toISOString();
    writeFileSync(sessionFile, JSON.stringify(data, null, 2));
    console.log(`[INTENT] Captured: ${intent.intent} (${intent.domain})`);
    console.log(`[INTENT] Goal: ${intent.goal.substring(0, 80)}...`);
  } catch (e) {
    console.warn('[INTENT] Failed to update session:', e);
  }
}

/**
 * Get intent from current session
 */
export function getSessionIntent(): SessionIntent | null {
  const sessionFile = join(ROOT, '.session', 'session-current.json');
  if (!existsSync(sessionFile)) return null;

  try {
    const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    if (data.goal && data.intent) {
      return {
        goal: data.goal,
        intent: data.intent,
        domain: data.domain || 'general',
        mentionedFiles: data.mentionedFiles || [],
        initialPrompt: data.initialPrompt || '',
      };
    }
  } catch {
    return null;
  }
  return null;
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args[0] === 'extract' && args[1]) {
    // Extract intent from provided prompt
    const intent = extractIntent(args.slice(1).join(' '));
    console.log(JSON.stringify(intent, null, 2));
  } else if (args[0] === 'update' && args[1]) {
    // Update session file with intent from provided prompt
    const prompt = args.slice(1).join(' ');
    const intent = extractIntent(prompt);
    const sessionFile = join(ROOT, '.session', 'session-current.json');
    updateSessionWithIntent(sessionFile, intent);
  } else if (args[0] === 'get') {
    // Get current session intent
    const intent = getSessionIntent();
    if (intent) {
      console.log(JSON.stringify(intent, null, 2));
    } else {
      console.log('{}');
    }
  } else {
    console.log('Usage:');
    console.log('  npx tsx src/session/session-intent-capture.ts extract "<prompt>"');
    console.log('  npx tsx src/session/session-intent-capture.ts update "<prompt>"');
    console.log('  npx tsx src/session/session-intent-capture.ts get');
  }
}
