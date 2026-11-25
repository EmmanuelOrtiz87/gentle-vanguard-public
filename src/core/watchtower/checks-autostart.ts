// Autostart lazy-step outcomes. Detached children cannot report to the parent,
// so the watchtower is the durable reader of lazy-step-runner records.

import { collectLazyStatus, problemSteps } from '../lazy-status.js';
import { addResult, quiet, ROOT } from './context.js';
import { log } from '../../utils/logger.js';

const logger = log('CORE-WATCHTOWER-CHECKS-AUTOSTART');

// El step del watchtower se excluye del veredicto de sesion: su registro es el
// del run anterior y alimenta este mismo check. Sin exclusion, un unico fallo
// se realimenta en cada arranque (medido 2026-11-24: el step salia 1 porque
// 'session' fallaba por su propio registro failed). Su estado real sigue
// visible en `npm run autostart:lazy:status`.
const SELF_STEP_ID = 'maintenance-watchtower';

export async function checkLazySteps(): Promise<void> {
  if (!quiet) logger.info('  [Autostart] Checking lazy step outcomes...');
  const status = collectLazyStatus(ROOT);
  if (status.total === 0) {
    addResult('session', 'lazy steps', 'SKIP', 'sin resultados registrados aún', 'noop');
    return;
  }
  const problematic = problemSteps(status.results, [SELF_STEP_ID]);
  if (problematic.length > 0) {
    const ids = problematic.map((r) => `${r.id}:${r.status}`).join(', ');
    addResult(
      'session',
      'lazy steps',
      'FAIL',
      `${problematic.length} con problema (${ids}); revisar npm run autostart:lazy:status`,
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
