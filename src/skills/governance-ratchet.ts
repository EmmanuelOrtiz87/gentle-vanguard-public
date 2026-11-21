/**
 * Ratchet for the skills governance audit. Editing 52 colliding trigger
 * labels across 254 skills is content work for the owner; what the stack can
 * enforce today is that the debt never grows. Baseline in
 * `config/skill-governance-baseline.json`, updated explicitly with
 * `--update-baseline`.
 */
export interface GovernanceCounts {
  duplicateNames: number;
  actionableTriggerCollisions: number;
  brokenReferences: number;
  skillsWithoutTriggers: number;
}

export interface GovernanceBaseline extends GovernanceCounts {
  capturedAt: string;
  skills: number;
}

const TRACKED: Array<keyof GovernanceCounts> = [
  'duplicateNames',
  'actionableTriggerCollisions',
  'brokenReferences',
  'skillsWithoutTriggers',
];

export function compareGovernance(
  current: GovernanceCounts,
  baseline: GovernanceBaseline | null,
): { regressions: string[]; improvements: string[] } {
  const regressions: string[] = [];
  const improvements: string[] = [];
  if (!baseline) return { regressions, improvements };
  for (const key of TRACKED) {
    const now = current[key];
    const was = baseline[key];
    if (typeof was !== 'number') continue;
    if (now > was) regressions.push(`${key}: ${was} -> ${now}`);
    else if (now < was) improvements.push(`${key}: ${was} -> ${now}`);
  }
  return { regressions, improvements };
}
