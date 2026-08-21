#!/usr/bin/env node
/**
 * Auto-Norm-Learner TypeScript Implementation
 *
 * Analyzes session patterns, failures, and successes to automatically learn
 * and update norms in rules/adaptive/LEARNED-NORMS.md
 *
 * Trigger: session-start, post-session, on-failure
 * Integration: Called from session-autostart pipeline
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync, runSyncShell } from './core/run-command.js';

interface Norm {
  id: string;
  category: 'pattern' | 'fix' | 'optimization' | 'avoidance';
  description: string;
  trigger: string;
  confidence: number; // 0-100
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  status: 'proposed' | 'active' | 'deprecated';
  source: string;
}

interface LearningContext {
  sessionId: string;
  timestamp: string;
  trigger: 'session-start' | 'post-session' | 'on-failure' | 'manual';
  metrics?: {
    qualityScore: number;
    corrections: number;
    failures: number;
    tokenUsage: number;
  };
}

interface SessionData {
  sessionId: string;
  startTime: string;
  endTime?: string;
  toolCalls: number;
  filesRead: number;
  filesEdited: number;
  qualityScore: number;
  errors: string[];
  warnings: string[];
}

const ROOT = resolve(process.cwd());
const LEARNED_NORMS_PATH = join(ROOT, 'rules', 'adaptive', 'LEARNED-NORMS.md');
const SESSION_DIR = join(ROOT, '.session');
const NORMS_DB_PATH = join(SESSION_DIR, 'learned-norms.json');
const METRICS_PATH = join(ROOT, '.session', 'metrics-report.json');

/**
 * Load existing norms database
 */
function loadNorms(): Norm[] {
  try {
    if (existsSync(NORMS_DB_PATH)) {
      const data = readFileSync(NORMS_DB_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[AUTO-NORM] Failed to load norms:', e);
  }
  return [];
}

/**
 * Save norms database
 */
function saveNorms(norms: Norm[]): void {
  try {
    if (!existsSync(SESSION_DIR)) {
      mkdirSync(SESSION_DIR, { recursive: true });
    }
    writeFileSync(NORMS_DB_PATH, JSON.stringify(norms, null, 2));
  } catch (e) {
    console.error('[AUTO-NORM] Failed to save norms:', e);
  }
}

/**
 * Load session data from recent sessions
 */
function loadRecentSessions(days = 7): SessionData[] {
  const sessions: SessionData[] = [];
  try {
    // Look for session files
    const files = runSyncShell(
      `find "${SESSION_DIR}" -name "session-*.json" -mtime -${days} 2>/dev/null || dir /b "${SESSION_DIR}\\session-*.json" 2>nul`,
      { cwd: ROOT },
    ).stdout.trim();

    if (!files) return sessions;

    for (const file of files.split('\n').filter((f) => f.trim())) {
      try {
        const data = readFileSync(join(SESSION_DIR, file.trim()), 'utf-8');
        sessions.push(JSON.parse(data));
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // No sessions found
  }
  return sessions;
}

/**
 * Load current metrics
 */
function loadMetrics(): any {
  try {
    if (existsSync(METRICS_PATH)) {
      const data = readFileSync(METRICS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // No metrics
  }
  return null;
}

/**
 * Analyze patterns from session data
 */
function analyzePatterns(sessions: SessionData[], norms: Norm[]): Norm[] {
  const newNorms = [...norms];
  const now = new Date().toISOString();

  // Pattern 1: High error rate in specific operations
  const errorPatterns = new Map<string, number>();
  for (const session of sessions) {
    for (const error of session.errors || []) {
      const key = error.split(':')[0] || error; // Group by error type
      errorPatterns.set(key, (errorPatterns.get(key) || 0) + 1);
    }
  }

  for (const [errorType, count] of errorPatterns) {
    if (count >= 3) {
      // Threshold for pattern recognition
      const existing = newNorms.find((n) => n.trigger === errorType && n.category === 'avoidance');
      if (existing) {
        existing.occurrences = count;
        existing.lastSeen = now;
        existing.confidence = Math.min(95, existing.confidence + 5);
      } else {
        newNorms.push({
          id: `norm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          category: 'avoidance',
          description: `Avoid pattern that leads to: ${errorType}`,
          trigger: errorType,
          confidence: Math.min(95, count * 15),
          occurrences: count,
          firstSeen: now,
          lastSeen: now,
          status: 'proposed',
          source: 'auto-analysis',
        });
      }
    }
  }

  // Pattern 2: Successful optimizations
  const highQualitySessions = sessions.filter((s) => s.qualityScore >= 90);
  if (highQualitySessions.length >= 3) {
    const existing = newNorms.find(
      (n) => n.trigger === 'high-quality-session' && n.category === 'optimization',
    );
    if (!existing) {
      newNorms.push({
        id: `norm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        category: 'optimization',
        description: 'Pattern for achieving high quality scores (90+) consistently',
        trigger: 'high-quality-session',
        confidence: Math.min(95, highQualitySessions.length * 20),
        occurrences: highQualitySessions.length,
        firstSeen: highQualitySessions[0]?.startTime || now,
        lastSeen: now,
        status: 'proposed',
        source: 'auto-analysis',
      });
    }
  }

  // Pattern 3: Token efficiency
  const efficientSessions = sessions.filter(
    (s) => s.toolCalls > 0 && (s.filesRead || 0) / s.toolCalls > 2,
  );
  if (efficientSessions.length >= 3) {
    const existing = newNorms.find(
      (n) => n.trigger === 'token-efficiency' && n.category === 'optimization',
    );
    if (!existing) {
      newNorms.push({
        id: `norm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        category: 'optimization',
        description: 'High file-to-tool ratio indicates efficient context usage',
        trigger: 'token-efficiency',
        confidence: Math.min(95, efficientSessions.length * 20),
        occurrences: efficientSessions.length,
        firstSeen: efficientSessions[0]?.startTime || now,
        lastSeen: now,
        status: 'proposed',
        source: 'auto-analysis',
      });
    }
  }

  return newNorms;
}

/**
 * Promote norms based on confidence and occurrences
 */
function promoteNorms(norms: Norm[]): Norm[] {
  return norms.map((norm) => {
    if (norm.status === 'proposed' && norm.confidence >= 80 && norm.occurrences >= 5) {
      return { ...norm, status: 'active' };
    }
    if (norm.status === 'active' && norm.occurrences >= 20) {
      // Keep active, could add 'established' status in future
      return norm;
    }
    return norm;
  });
}

/**
 * Prune stale norms
 */
function pruneStaleNorms(norms: Norm[]): Norm[] {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return norms.filter((norm) => {
    if (norm.status === 'deprecated') return false;
    if (norm.occurrences < 3 && new Date(norm.lastSeen) < thirtyDaysAgo) {
      return false; // Remove unused proposed norms
    }
    return true;
  });
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(norms: Norm[]): string {
  const now = new Date().toISOString();
  const activeNorms = norms.filter((n) => n.status === 'active');
  const proposedNorms = norms.filter((n) => n.status === 'proposed');
  const deprecatedNorms = norms.filter((n) => n.status === 'deprecated');

  return `# Learned Norms (Autonomous)

Auto-maintained by auto-norm-learner.ts — last run: ${now}

## Statistics

- Total norms: ${norms.length}
- Active norms: ${activeNorms.length}
- Proposed norms: ${proposedNorms.length}
- Deprecated norms: ${deprecatedNorms.length}
- Last trigger: session-start

## Active Norms

${
  activeNorms.length === 0
    ? '_No active norms yet. Learning in progress..._'
    : activeNorms
        .map(
          (n) => `
### ${n.id}
- **Category**: ${n.category}
- **Description**: ${n.description}
- **Trigger**: ${n.trigger}
- **Confidence**: ${n.confidence}%
- **Occurrences**: ${n.occurrences}
- **First seen**: ${n.firstSeen}
- **Last seen**: ${n.lastSeen}
`,
        )
        .join('\n')
}

## Proposed Norms

${
  proposedNorms.length === 0
    ? '_No proposed norms pending._'
    : proposedNorms
        .map(
          (n) => `
### ${n.id}
- **Category**: ${n.category}
- **Description**: ${n.description}
- **Trigger**: ${n.trigger}
- **Confidence**: ${n.confidence}%
- **Occurrences**: ${n.occurrences}
- **Status**: Pending promotion (needs confidence ≥80 and occurrences ≥5)
`,
        )
        .join('\n')
}

## Deprecated Norms

${deprecatedNorms.length === 0 ? '_No deprecated norms._' : deprecatedNorms.map((n) => `- ${n.id}: ${n.description}`).join('\n')}

---

*This file is automatically updated by the auto-norm-learner system.*
`;
}

/**
 * Save markdown report
 */
function saveMarkdownReport(content: string): void {
  try {
    const dir = join(ROOT, 'rules', 'adaptive');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(LEARNED_NORMS_PATH, content);
  } catch (e) {
    console.error('[AUTO-NORM] Failed to save markdown:', e);
  }
}

/**
 * Log learning to Engram if available
 */
function logToEngram(norms: Norm[], context: LearningContext): void {
  try {
    // Check if engram CLI is available
    runSync('engram', ['--version'], { stdio: 'pipe' });

    const summary = {
      timestamp: context.timestamp,
      trigger: context.trigger,
      totalNorms: norms.length,
      newNorms: norms.filter((n) => n.firstSeen === context.timestamp).length,
      activeNorms: norms.filter((n) => n.status === 'active').length,
    };

    runSync(
      'engram',
      [
        'remember',
        `auto-norm-learner: Analyzed ${summary.totalNorms} norms, ${summary.newNorms} new, ${summary.activeNorms} active`,
        '--category',
        'learning',
      ],
      { stdio: 'pipe', cwd: ROOT },
    );
  } catch {
    // Engram not available, skip
    console.log('[AUTO-NORM] Engram not available, skipping log');
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const trigger = (args.find((a) => a.startsWith('--trigger='))?.split('=')[1] ||
    'manual') as LearningContext['trigger'];
  const quiet = args.includes('--quiet');

  if (!quiet) {
    console.log('[AUTO-NORM] Starting auto-norm-learner...');
    console.log(`[AUTO-NORM] Trigger: ${trigger}`);
  }

  const context: LearningContext = {
    sessionId: process.env.SESSION_ID || `session-${Date.now()}`,
    timestamp: new Date().toISOString(),
    trigger,
  };

  // Load existing data
  let norms = loadNorms();
  const sessions = loadRecentSessions(7);
  const _metrics = loadMetrics();

  if (!quiet) {
    console.log(`[AUTO-NORM] Loaded ${norms.length} existing norms`);
    console.log(`[AUTO-NORM] Analyzing ${sessions.length} recent sessions`);
    if (_metrics) {
      console.log(`[AUTO-NORM] Metrics loaded: quality=${_metrics.qualityScore}`);
    }
  }

  // Analyze and learn
  norms = analyzePatterns(sessions, norms);
  norms = promoteNorms(norms);
  norms = pruneStaleNorms(norms);

  // Save results
  saveNorms(norms);
  const markdown = generateMarkdownReport(norms);
  saveMarkdownReport(markdown);

  // Log to Engram
  logToEngram(norms, context);

  // Signal auto-apply-safe for newly promoted norms
  const promotedCount =
    norms.filter((n) => n.status === 'active').length -
    norms.filter((n) => n.status === 'proposed').length;
  if (promotedCount > 0) {
    const triggerDir = join(ROOT, '.session', 'auto-apply');
    if (!existsSync(triggerDir)) mkdirSync(triggerDir, { recursive: true });
    writeFileSync(
      join(triggerDir, 'trigger-norms.json'),
      JSON.stringify({
        source: 'auto-norm-learner',
        type: 'norm-promotion',
        promotedCount,
        timestamp: new Date().toISOString(),
      }),
      'utf-8',
    );
  }

  // Output summary
  const activeCount = norms.filter((n) => n.status === 'active').length;
  const proposedCount = norms.filter((n) => n.status === 'proposed').length;

  if (!quiet) {
    console.log(`[AUTO-NORM] Learning complete:`);
    console.log(`  - Total norms: ${norms.length}`);
    console.log(`  - Active: ${activeCount}`);
    console.log(`  - Proposed: ${proposedCount}`);
    console.log(`[AUTO-NORM] Report saved to: ${LEARNED_NORMS_PATH}`);
  }

  // Return success
  process.exit(0);
}

// Run if called directly
import { fileURLToPath } from 'url';
const _currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === `file://${_currentFile}`) {
  main().catch((err) => {
    console.error('[AUTO-NORM] Fatal error:', err);
    process.exit(1);
  });
}

export { analyzePatterns, promoteNorms, pruneStaleNorms };
export type { Norm, LearningContext };
