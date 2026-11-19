import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { load, dump } from 'js-yaml';

/** Version proposals belong in the private source; security updates remain enabled. */
export function syncPublicDependabot(privateRepo: string, targetDir: string): void {
  const config = load(readFileSync(join(privateRepo, '.github/dependabot.yml'), 'utf8')) as {
    version: number;
    updates: Record<string, unknown>[];
  };
  if (config?.version !== 2 || !Array.isArray(config.updates)) {
    throw new Error('Expected Dependabot version 2 with an updates array');
  }
  for (const update of config.updates) update['open-pull-requests-limit'] = 0;
  const destination = join(targetDir, '.github/dependabot.yml');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    '# Generated from the private source. Version updates are validated there.\n' +
      '# Limit 0 pauses version PRs only; Dependabot security updates remain enabled.\n' +
      dump(config, { lineWidth: -1, noRefs: true }),
  );
}
