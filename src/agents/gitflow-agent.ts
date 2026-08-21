#!/usr/bin/env node
/**
 * GITFLOW Agent (gitflow-agent) - Native Implementation
 *
 * GitFlow governance — branch conventions, conventional commits, protected branches.
 * Executor logic mirrors config/agent-prompts/GITFLOW.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'gitflow-agent',
  description: 'GitFlow agent — branch/commit governance and PR discipline',
  promptFile: 'GITFLOW',
  domain: 'gitflow',
  version: '1.0.0',
  temperature: 0.1,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent = normalized.includes('branch')
      ? 'BRANCH'
      : normalized.includes('commit')
        ? 'COMMIT'
        : normalized.includes('pr') || normalized.includes('pull request')
          ? 'PR'
          : normalized.includes('chained') || normalized.includes('split')
            ? 'CHAINED_PR'
            : normalized.includes('protect')
              ? 'PROTECTED'
              : 'GENERAL';

    // Detect current branch/commit from context if provided
    const branch = context?.match(/branch:?\s*([^\n,]+)/i)?.[1]?.trim() || 'unknown';
    const protectedBranches = ['main', 'develop', 'master'];

    // Branch naming convention regex
    const branchRegex =
      /^(feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)(\/|\/)[a-z0-9._-]+$/;
    const branchValid = branchRegex.test(branch);

    const analysis: Record<string, unknown> = {
      task,
      intent,
      currentBranch: branch,
      branchConventionValid: branchValid,
      branchConventionRegex:
        '^(feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)/[a-z0-9._-]+$',
      protectedBranches,
      commitFormat: 'type(scope): description  (conventional commits)',
      rules: [
        'No push to protected branches (main/develop) without PR',
        'No secrets in the diff — pre-commit validation must pass',
        'PRs over 400 lines must be split into chained PRs',
        'No merge debris — clean git history',
      ],
      domainPrompt: prompt.slice(0, 300) + (prompt.length > 300 ? '…' : ''),
    };

    const checklist = [
      'Branch name matches convention regex',
      'Commit follows conventional commits format',
      'No direct push to protected branches (main/develop)',
      'No secrets in diff — pre-commit validation passed',
      'PR over 400 lines split into chained PRs',
      'No merge debris',
    ];

    const flags: DomainOutput['flags'] = [];
    if (branch !== 'unknown' && !branchValid) {
      flags.push({
        severity: 'critical',
        message: `Branch "${branch}" does not match convention. Expected e.g. feat/feature-name, fix/bug-name.`,
      });
    }
    if (protectedBranches.includes(branch)) {
      flags.push({
        severity: 'critical',
        message: `Branch "${branch}" is protected. All changes must flow through PRs with review gates.`,
      });
    }
    if (normalized.includes('commit') && !context) {
      flags.push({
        severity: 'warn',
        message:
          'Provide commit message via context to validate conventional commits format (type(scope): description).',
      });
    }

    const artifacts = [
      {
        name: 'gitflow-governance',
        content:
          `# GitFlow Governance — ${intent.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `**Current branch:** ${branch}\n\n` +
          `## Rules\n\n` +
          `1. Branch name matches convention regex: \`^(feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)/[a-z0-9._-]+$\`\n` +
          `2. Commit follows conventional commits format: \`type(scope): description\`\n` +
          `3. No push to protected branches (main/develop) without PR\n` +
          `4. No secrets in the diff — pre-commit validation must pass\n` +
          `5. PRs over 400 lines must be split into chained PRs\n\n` +
          `## Automatic Triggers\n\n` +
          `- Branch name does not match convention → block and suggest correction\n` +
          `- Pushing to protected branch → redirect to PR workflow\n\n` +
          `## Commit Format\n\n` +
          `\`\`\`\nfeat(auth): add OAuth2 login flow\nfix(ui): correct button alignment in header\ndocs(readme): update installation steps\n\`\`\`\n`,
      },
    ];

    return {
      summary: `GitFlow ${intent.replace(/_/g, ' ')} governance check${branch !== 'unknown' ? ` on branch "${branch}" (convention ${branchValid ? 'valid' : 'INVALID'})` : ''}.`,
      analysis,
      checklist,
      artifacts,
      evidence: [
        'GITFLOW.md domain prompt loaded',
        'Branch convention + conventional commits rules applied',
      ],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
