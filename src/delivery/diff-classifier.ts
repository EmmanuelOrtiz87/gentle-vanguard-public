/**
 * delivery/diff-classifier.ts — Deterministic diff classification.
 *
 * Labels a change set as docs/test/code/config/workflow/security/dependency/
 * schema/release. Highest-risk class wins. Used to select the minimum
 * sufficient gate lane and to decide which reviews are mandatory.
 */

import { DiffClass } from './types.js';

interface ClassRule {
  cls: DiffClass;
  patterns: RegExp[];
  risk: number; // higher = more risk
}

const RULES: ClassRule[] = [
  {
    cls: 'release',
    patterns: [
      /^package\.json$/,
      /^pnpm-lock\.yaml$/,
      /^CHANGELOG\.md$/,
      /^VERSION$/,
      /^version\.json$/,
      /^\.github\/workflows\/.*release.*\.ya?ml$/,
      /^\.github\/workflows\/.*deploy.*\.ya?ml$/,
    ],
    risk: 100,
  },
  {
    cls: 'security',
    patterns: [
      /^src\/security\//,
      /^config\/.*security.*\.json$/,
      /^\.github\/workflows\/.*security.*\.ya?ml$/,
      /^\.secretlintrc/,
      /^rules\/SECRETS/,
      /^\.gitleaks/,
      /^\.trivy/,
      /^src\/auth\//,
      /^src\/security\//,
    ],
    risk: 95,
  },
  {
    cls: 'workflow',
    patterns: [
      /^\.github\/workflows\//,
      /^\.github\/actions\//,
      /^\.lefthook\.ya?ml$/,
      /^\.github\/CODEOWNERS$/,
      /^\.github\/rulesets\//,
    ],
    risk: 80,
  },
  {
    cls: 'schema',
    patterns: [
      /\.schema\.json$/,
      /^config\/.*\.schema\.json$/,
      /^src\/.*\/schema\.ts$/,
      /^src\/.*\/types\.ts$/,
      /^src\/database\/migrations\//,
    ],
    risk: 70,
  },
  {
    cls: 'dependency',
    patterns: [
      /^package\.json$/,
      /^pnpm-lock\.yaml$/,
      /^yarn\.lock$/,
      /^package-lock\.json$/,
      /^\.npmrc$/,
      /^\.pnpmfile\.cjs$/,
    ],
    risk: 75,
  },
  {
    cls: 'config',
    patterns: [
      /^config\//,
      /^\.env\.example$/,
      /^\.env\.sample$/,
      /^tsconfig.*\.json$/,
      /^vitest.*\.config\.ts$/,
      /^vite\.config\.ts$/,
      /^eslint.*\.(js|ts|json)$/,
      /^prettier.*\.(js|json)$/,
    ],
    risk: 50,
  },
  {
    cls: 'code',
    patterns: [
      /^src\/.*\.(ts|tsx|js|jsx)$/,
      /^apps\/.*\/src\/.*\.(ts|tsx|js|jsx)$/,
      /^scripts\/.*\.ts$/,
    ],
    risk: 40,
  },
  {
    cls: 'test',
    patterns: [
      /^tests\//,
      /\.test\.(ts|tsx|js|jsx)$/,
      /\.spec\.(ts|tsx|js|jsx)$/,
      /^__tests__\//,
      /^vitest\.config/,
    ],
    risk: 20,
  },
  {
    cls: 'docs',
    patterns: [/\.md$/, /^docs\//, /^knowledge-base\//, /^README\.md$/, /^AGENTS\.md$/],
    risk: 10,
  },
];

export function classifyPath(path: string): DiffClass {
  const normalized = path.replace(/\\/g, '/');
  let best: DiffClass = 'docs';
  let bestRisk = -1;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(normalized))) {
      if (rule.risk > bestRisk) {
        best = rule.cls;
        bestRisk = rule.risk;
      }
    }
  }
  return best;
}

export function classifyDiff(paths: string[]): {
  primary: DiffClass;
  all: DiffClass[];
  risk: number;
  requiresGovReview: boolean;
  requiresQaReview: boolean;
  requiresHumanApproval: boolean;
} {
  const classes = paths.map(classifyPath);
  const unique = [...new Set(classes)];
  // Highest risk wins
  const riskOrder: Record<DiffClass, number> = {
    docs: 10,
    test: 20,
    code: 40,
    config: 50,
    dependency: 75,
    schema: 70,
    workflow: 80,
    security: 95,
    release: 100,
  };
  const primary = unique.reduce((a, b) => (riskOrder[a] >= riskOrder[b] ? a : b), 'docs');
  const risk = riskOrder[primary];

  return {
    primary,
    all: unique,
    risk,
    requiresGovReview: ['security', 'workflow', 'config', 'schema', 'release'].includes(primary),
    requiresQaReview: ['code', 'security', 'schema', 'release', 'dependency'].includes(primary),
    requiresHumanApproval: ['security', 'release', 'schema'].includes(primary) || risk >= 80,
  };
}

export function minimumLane(cls: DiffClass): 'focused' | 'full' {
  switch (cls) {
    case 'docs':
    case 'test':
      return 'focused';
    case 'code':
    case 'config':
    case 'dependency':
      return 'focused';
    case 'workflow':
    case 'security':
    case 'schema':
    case 'release':
      return 'full';
    default:
      return 'focused';
  }
}
