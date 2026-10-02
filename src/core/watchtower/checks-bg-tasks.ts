// Background tasks hygiene check ("ventanas fantasma" — runtime + OS).
//
// The MiniMax Code runtime surfaces a "background-task-completion-reminder"
// in EVERY turn until the agent drains each task via `task_output` or
// `task_stop`. The runtime does NOT expose its task queue to scripts, so
// this check has two signals:
//
//   1. STATE FILE (.runtime/bg-tasks.json) — entries the agent recorded
//      itself. Counts `drained: false` entries as PENDING.
//
//   2. OS-LEVEL — long-running node/tsx processes matching the bg pattern
//      (long uptime + tsx/background in CommandLine). These are the leaked
//      daemons from auto-promoted Bash calls.
//
// Status mapping:
//   PASS — 0 pending, 0 OS leaks
//   WARN — 1-3 pending OR 1-2 OS leaks (advisory, not blocking)
//   FAIL — >3 pending OR >2 OS leaks (agent has abandoned the queue)

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { addResult, ROOT } from './context';
import { listOsLeakCandidates } from '../bg-os-leaks';
import { log } from '../../utils/logger.js';

const logger = log('CORE-WATCHTOWER-CHECKS-BG-TASKS');

const STATE_FILE = resolve(ROOT, '.runtime', 'bg-tasks.json');
const PENDING_FAIL = 3;
const OS_LEAK_FAIL = 2;

interface StateFile {
  entries: Array<{ drained: boolean; taskId: string }>;
}

function loadState(): StateFile {
  if (!existsSync(STATE_FILE)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as StateFile;
  } catch {
    return { entries: [] };
  }
}



export async function checkBgTasks(): Promise<void> {
  logger.info('  [BG Tasks] ventanas fantasma check...');

  const state = loadState();
  const pending = state.entries.filter((e) => !e.drained);
  const pendingIds = pending.map((e) => e.taskId).join(', ');

  const osLeaks = listOsLeakCandidates();
  const osSummary =
    osLeaks.length === 0
      ? 'none'
      : osLeaks.map((c) => `pid=${c.pid}(${c.ageSec}s)`).join(', ');

  const totalIssues = pending.length + osLeaks.length;

  if (totalIssues === 0) {
    addResult(
      'bg-tasks',
      'hygiene',
      'PASS',
      '0 pending + 0 OS leaks — disciplina de drenado OK',
      'ok',
    );
    return;
  }

  if (pending.length >= PENDING_FAIL || osLeaks.length >= OS_LEAK_FAIL) {
    addResult(
      'bg-tasks',
      'hygiene',
      'FAIL',
      `${pending.length} pending (${pendingIds || '—'}), ${osLeaks.length} OS leaks (${osSummary})`,
      'reap: npx tsx scripts/utilities/background-tasks.ts --reap-os --apply; drain: call task_output/task_stop for each pending',
      true,
    );
    return;
  }

  addResult(
    'bg-tasks',
    'hygiene',
    'WARN',
    `${pending.length} pending (${pendingIds || '—'}), ${osLeaks.length} OS leaks (${osSummary})`,
    'drain next turn: call task_output(task_id="<id>") for each pending; reap OS leaks with --apply',
  );
}
