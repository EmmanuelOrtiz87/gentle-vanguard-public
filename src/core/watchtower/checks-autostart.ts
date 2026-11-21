// Autostart lazy-step outcomes. Detached children cannot report to the parent,
// so the watchtower is the durable reader of lazy-step-runner records.

import { collectLazyStatus } from '../lazy-status.js';
import { addResult, quiet, ROOT } from './context.js';
import { log } from '../../utils/logger.js';

const logger = log('CORE-WATCHTOWER-CHECKS-AUTOSTART');

export async function checkLazySteps(): Promise<void> {
  if (!quiet) logger.info('  [Autostart] Checking lazy step outcomes...');
  const status = collectLazyStatus(ROOT);
  if (status.total === 0) {
    addResult('session', 'lazy steps', 'SKIP', 'sin resultados registrados aún', 'noop');
    return;
  }
  const bad = status.failed + status.timeout + status.stale;
  if (bad > 0) {
    const ids = status.results
      .filter((r) => r.status === 'failed' || r.status === 'timeout' || r.status === 'stale')
      .map((r) => `${r.id}:${r.status}`)
      .join(', ');
    addResult(
      'session',
      'lazy steps',
      'FAIL',
      `${bad} con problema (${ids}); revisar npm run autostart:lazy:status`,
      'inspect',
    );
    return;
  }
  addResult(
    'session',
    'lazy steps',
    'PASS',
    `${status.ok} ok, ${status.running} running, 0 failed/timeout/stale`,
    'ok',
  );
}
