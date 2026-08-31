import { execFileSync } from 'node:child_process';

const owner = process.argv[2];
const repo = process.argv[3];
const dryRun = process.argv.includes('--dry-run');

if (!owner || !repo) {
  console.error('Uso: npx tsx src/tools/setup-branch-protection.ts <owner> <repo> [--dry-run]');
  process.exit(1);
}

const rulesets = [
  {
    name: 'main - PR + Status Checks + No Force Push',
    include: ['refs/heads/main'],
    rules: [
      {
        type: 'pull_request',
        parameters: {
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          require_last_push_approval: true,
          required_approving_review_count: 1,
          required_review_thread_resolution: true,
        },
      },
      { type: 'non_fast_forward' },
      { type: 'deletion' },
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [
            { context: 'Unit Tests' },
            { context: 'Gitleaks Secret Detection' },
            { context: 'JS/TS Lint' },
            { context: 'Format Check (Prettier)' },
          ],
          strict_required_status_checks_policy: true,
        },
      },
    ],
  },
  {
    name: 'develop - PR + Basic Checks',
    include: ['refs/heads/develop'],
    rules: [
      {
        type: 'pull_request',
        parameters: {
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 1,
          required_review_thread_resolution: false,
        },
      },
      { type: 'non_fast_forward' },
      { type: 'deletion' },
    ],
  },
];

for (const ruleset of rulesets) {
  const body = JSON.stringify({
    name: ruleset.name,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ruleset.include, exclude: [] } },
    rules: ruleset.rules,
  });
  if (dryRun) {
    console.log(`DRY-RUN ${ruleset.name}: ${body}`);
    continue;
  }
  const result = execFileSync(
    'gh',
    [
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/rulesets`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
      '--input',
      '-',
    ],
    { input: body, encoding: 'utf8', windowsHide: true },
  );
  console.log(`Created ${ruleset.name}: ${(JSON.parse(result) as { id: number }).id}`);
}
