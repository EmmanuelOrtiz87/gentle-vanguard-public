/**
 * Session summary sources for the Knowledge Base vault.
 *
 * The previous generator wrote a 337-byte placeholder on every run: the default
 * session id (`session-YYYYMMDD`) never matched the real ids
 * (`session-YYYYMMDDTHHMM`), `.state.json` was read only via `*.md` files, and an
 * empty result was still written to disk. These helpers resolve the real
 * session, render whatever data actually exists and tell the caller when there
 * is nothing worth filing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface SessionStateSnapshot {
  sessionId: string;
  agent?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  totalTokens?: number;
  totalCost?: number;
  messageCount?: number;
  turns?: Array<{ inputTokens?: number; outputTokens?: number }>;
  metadata?: Record<string, unknown>;
}

interface CloseReportLike {
  timestamp?: string;
  reason?: string;
  overall?: string;
  validationScore?: number;
  totalPhases?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  phases?: Record<string, Array<{ phase?: string; status?: string; detail?: string }>>;
}

export function resolveSession(
  root: string,
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): { sessionId: string; dir: string | null } {
  const contextLog = join(root, '.session', 'context-log');
  const dirFor = (sid: string): string | null => {
    const dir = join(contextLog, sid);
    return existsSync(dir) ? dir : null;
  };

  const named = explicit || env.GV_SESSION_ID || env.GENTLE_VANGUARD_SESSION_ID;
  if (named) return { sessionId: named, dir: dirFor(named) };

  if (existsSync(contextLog)) {
    const latest = readdirSync(contextLog, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
      .map((entry) => {
        const dir = join(contextLog, entry.name);
        return { sessionId: entry.name, dir, mtime: statSync(dir).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (latest) return { sessionId: latest.sessionId, dir: latest.dir };
  }

  const today = new Date().toISOString().split('T')[0];
  return { sessionId: `session-${today.replace(/-/g, '')}`, dir: null };
}

/** Renders `.state.json` only when it carries activity; empty states are noise. */
export function renderStateData(dir: string): string | null {
  const statePath = join(dir, '.state.json');
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as SessionStateSnapshot;
    const turns = state.turns ?? [];
    const hasActivity =
      (state.totalTokens ?? 0) > 0 || (state.messageCount ?? 0) > 0 || turns.length > 0;
    if (!hasActivity) return null;

    const meta = state.metadata ?? {};
    const metaLine = Object.entries({
      toolCalls: meta.toolCalls,
      filesRead: meta.filesRead,
      filesEdited: meta.filesEdited,
      skillsUsed: Array.isArray(meta.skillsUsed) ? meta.skillsUsed.length : undefined,
      errors: meta.errors,
      qualityScore: meta.qualityScore,
    })
      .filter(([, value]) => typeof value === 'number' && (value as number) > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ');

    const lines = [
      `- **Agent**: ${state.agent ?? 'unknown'} · **Status**: ${state.status ?? 'unknown'}`,
      `- **Window**: ${state.createdAt ?? '?'} → ${state.updatedAt ?? '?'}`,
      `- **Tokens**: ${state.totalTokens ?? 0} · **Cost**: $${(state.totalCost ?? 0).toFixed(4)} · **Turns**: ${state.messageCount ?? turns.length}`,
    ];
    if (metaLine) lines.push(`- **Activity**: ${metaLine}`);
    return `### Session state\n\n${lines.join('\n')}`;
  } catch {
    return null;
  }
}

function readLegacyMarkdown(dir: string): string {
  let data = '';
  for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.md'))) {
    data += readFileSync(join(dir, file), 'utf-8') + '\n\n';
  }
  return data.trim();
}

/**
 * Files the note under the session the report describes, not under whichever
 * session happens to be running when the summary is generated.
 */
export function renderLatestCloseReport(root: string): { block: string; sessionId: string } | null {
  const sessionDir = join(root, '.session');
  if (!existsSync(sessionDir)) return null;
  const latest = readdirSync(sessionDir)
    .filter((file) => file.startsWith('close-report-') && file.endsWith('.json'))
    .sort()
    .at(-1);
  if (!latest) return null;

  try {
    const report = JSON.parse(readFileSync(join(sessionDir, latest), 'utf-8')) as CloseReportLike;
    const tokenDetail =
      report.phases?.persist
        ?.map((phase) => phase.detail ?? '')
        .find((detail) => /total=\d+/.test(detail)) ?? null;
    const lines = [
      `- **Report**: \`.session/${latest}\``,
      `- **Result**: ${report.overall ?? 'unknown'} · **Score**: ${report.validationScore ?? '?'}`,
      `- **Phases**: ${report.passed ?? 0} passed · ${report.failed ?? 0} failed · ${report.skipped ?? 0} skipped of ${report.totalPhases ?? 0}`,
    ];
    if (report.reason) lines.push(`- **Reason**: ${report.reason} at ${report.timestamp ?? '?'}`);
    if (tokenDetail) lines.push(`- **Tokens**: ${tokenDetail}`);
    const reportId = latest.replace(/^close-report-/, '').replace(/\.json$/, '');
    return {
      block: `### Last close report\n\n${lines.join('\n')}`,
      sessionId: `session-${reportId}`,
    };
  } catch {
    return null;
  }
}

/**
 * Collects the real content for a session note. `parts` is empty when nothing
 * real exists — callers must skip writing in that case instead of storing a
 * placeholder.
 */
export function buildSessionSummaryParts(
  root: string,
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): { sessionId: string; parts: string[] } {
  const resolved = resolveSession(root, explicit, env);
  let sessionId = resolved.sessionId;
  const parts: string[] = [];

  if (resolved.dir) {
    const stateBlock = renderStateData(resolved.dir);
    if (stateBlock) parts.push(stateBlock);
    const legacy = readLegacyMarkdown(resolved.dir);
    if (legacy) parts.push(`### Context log\n\n${legacy}`);
  }
  if (parts.length === 0) {
    const close = renderLatestCloseReport(root);
    if (close) {
      parts.push(close.block);
      // An explicit --session-id keeps its own name and just borrows the context.
      if (!explicit) sessionId = close.sessionId;
    }
  }

  return { sessionId, parts };
}
