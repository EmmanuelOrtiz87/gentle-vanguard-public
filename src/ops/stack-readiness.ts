export interface BootstrapChecks {
  session: boolean;
  delegation: boolean;
  policy: boolean;
  routing: boolean;
  security: boolean;
  health: boolean;
}

export interface BootstrapStatus {
  timestamp: string;
  phase: string;
  healthy: boolean;
  services: {
    session: boolean;
    delegation: boolean;
    policy: boolean;
    routing: boolean;
    security: boolean;
    watchtower: boolean;
  };
}

export type BootstrapFinalization = 'complete' | 'skipped' | 'failed';

export interface BootstrapOutcome {
  status: 'HEALTHY' | 'CHECKS PASSED (NOT FINALIZED)' | 'PARTIAL';
  readinessVerified: boolean;
  exitCode: 0 | 1;
}

export function shouldSkipBootstrapChecks(
  markerExists: boolean,
  autoMode: boolean,
  forceMode: boolean,
): boolean {
  return markerExists && !autoMode && !forceMode;
}

export function createBootstrapStatus(
  checks: BootstrapChecks,
  timestamp: string = new Date().toISOString(),
): BootstrapStatus {
  const healthy = Object.values(checks).every(Boolean);
  return {
    timestamp,
    phase: healthy ? 'complete' : 'failed',
    healthy,
    services: {
      session: checks.session,
      delegation: checks.delegation,
      policy: checks.policy,
      routing: checks.routing,
      security: checks.security,
      watchtower: checks.health,
    },
  };
}

export function resolveBootstrapOutcome(
  checks: BootstrapChecks,
  finalization: BootstrapFinalization,
): BootstrapOutcome {
  const checksPassed = Object.values(checks).every(Boolean);
  if (!checksPassed || finalization === 'failed') {
    return { status: 'PARTIAL', readinessVerified: false, exitCode: 1 };
  }
  if (finalization === 'skipped') {
    return {
      status: 'CHECKS PASSED (NOT FINALIZED)',
      readinessVerified: false,
      exitCode: 0,
    };
  }
  return { status: 'HEALTHY', readinessVerified: true, exitCode: 0 };
}

export function healthCheckPassed(output: string): boolean {
  const summary = output.match(/PASS:\s*(\d+)\s*\|\s*WARN:\s*\d+\s*\|\s*FAIL:\s*(\d+)/i);
  return summary !== null && Number(summary[1]) > 0 && Number(summary[2]) === 0;
}

export function formatReadinessStatus(hasBootstrapMarker: boolean): string {
  return hasBootstrapMarker
    ? 'Readiness no verificada: el marker de bootstrap no acredita una validación vigente.'
    : 'Readiness no verificada: no existe una validación de bootstrap finalizada.';
}
