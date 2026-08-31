#!/usr/bin/env node
/**
 * Ensures the authenticated GitHub user can bypass develop rulesets.
 * Resolves current GitHub user via gh CLI, locates branch rulesets targeting develop,
 * and ensures the user is added as a bypass actor with bypass_mode=always.
 * TS migration of scripts/utilities/session/SESSION-MANAGEMENT/ensure-github-bypass.ps1
 */

import { runSyncShell } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { getEffectiveProcessTimeout } from '../core/timeout-config';

function run(cmd: string, _opts: { quiet?: boolean } = {}): string {
  try {
    return runSyncShell(cmd, {
      timeout: getEffectiveProcessTimeout('default'),
      stdio: 'pipe',
    }).stdout.trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const owner = args.includes('--owner') ? args[args.indexOf('--owner') + 1] : 'EmmanuelOrtiz87';
  const branch = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : 'develop';
  const repos = args.includes('--repos')
    ? args[args.indexOf('--repos') + 1].split(',')
    : ['gentle-vanguard', 'gentle-vanguard-public'];
  const strict = args.includes('--strict') || args.includes('-Strict');

  let hasFailure = false;

  function info(m: string): void {
    console.log(`[INFO] ${m}`);
  }
  function ok(m: string): void {
    console.log(`[OK] ${m}`);
  }
  function warn(m: string): void {
    console.log(`[WARN] ${m}`);
  }

  try {
    run('gh --version', { quiet: true });
  } catch {
    warn('GitHub CLI (gh) not found. Skipping bypass enforcement.');
    process.exit(0);
  }

  let actorId: number;
  let actorLogin: string;
  try {
    const user = JSON.parse(run('gh api user', { quiet: true }));
    actorId = user.id;
    actorLogin = user.login;
    info(`Authenticated as ${actorLogin} (${actorId})`);
  } catch {
    warn('Unable to resolve authenticated GitHub user. Skipping bypass enforcement.');
    process.exit(0);
  }

  const branchRef = `refs/heads/${branch}`;

  for (const repo of repos) {
    try {
      info(`Checking rulesets for ${owner}/${repo} (${branchRef})...`);
      const rulesets: Array<{ id: number }> = JSON.parse(
        run(`gh api repos/${owner}/${repo}/rulesets`, { quiet: true }),
      );

      let target: Record<string, unknown> | null = null;
      for (const rs of rulesets) {
        const detail: Record<string, unknown> = JSON.parse(
          run(`gh api repos/${owner}/${repo}/rulesets/${rs.id}`, { quiet: true }),
        );
        const conditions = detail.conditions as Record<string, unknown> | undefined;
        const refName = conditions?.ref_name as Record<string, unknown> | undefined;
        const includes = (refName?.include as string[]) || [];
        if (detail.target === 'branch' && includes.includes(branchRef)) {
          target = detail;
          break;
        }
      }

      if (!target) {
        warn(`No branch ruleset found for ${repo} on ${branchRef}.`);
        hasFailure = true;
        continue;
      }

      const existingActors = (target.bypass_actors as Array<Record<string, unknown>>) || [];
      const alreadyBypassed =
        target.current_user_can_bypass === 'always' ||
        existingActors.some(
          (a: Record<string, unknown>) =>
            a.actor_type === 'User' && Number(a.actor_id) === actorId && a.bypass_mode === 'always',
        );

      if (alreadyBypassed) {
        ok(`${repo}: bypass already active for ${actorLogin}`);
        continue;
      }

      const newActors = [
        ...existingActors,
        { actor_id: actorId, actor_type: 'User', bypass_mode: 'always' },
      ];

      const body = JSON.stringify({
        name: target.name,
        target: target.target,
        enforcement: target.enforcement,
        conditions: target.conditions,
        rules: target.rules,
        bypass_actors: newActors,
      });

      run(
        `echo '${body.replace(/'/g, "'\\''")}' | gh api repos/${owner}/${repo}/rulesets/${target.id} -X PUT --input -`,
        { quiet: true },
      );

      const check: Record<string, unknown> = JSON.parse(
        run(`gh api repos/${owner}/${repo}/rulesets/${target.id}`, { quiet: true }),
      );

      if (check.current_user_can_bypass === 'always') {
        ok(`${repo}: bypass enabled for ${actorLogin}`);
      } else {
        warn(`${repo}: update sent but bypass check did not return always.`);
        hasFailure = true;
      }
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('403')) {
        info(`${repo}: bypass enforcement skipped (HTTP 403 - requires GitHub Pro or public repo)`);
      } else {
        warn(`${repo}: bypass enforcement failed (${errorMsg})`);
        hasFailure = true;
      }
    }
  }

  if (strict && hasFailure) process.exit(1);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
