#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

function execGit(args: string[], cwd: string = process.cwd()): string {
  const result = runSync('git', args, { cwd });
  return result.stdout?.trim() ?? '';
}

interface SddDoc {
  file: string;
  status: string;
}

const VALID_STATUSES = new Set(['validated', 'done', 'active']);

function main(): number {
  const cwd = process.cwd();
  const repoRoot = execGit(['rev-parse', '--show-toplevel'], cwd) || resolve(cwd);

  const exemptFile = join(repoRoot, '.sdd-exempt');
  if (existsSync(exemptFile)) {
    const content = readFileSync(exemptFile, 'utf-8').trim();
    if (content.length > 5) {
      console.log(`[SDD-GATE] SDD-EXEMPT found (${content}) - gate skipped.`);
      return 0;
    }
  }

  const branch = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const isMain = branch === 'main';
  const isProtected = isMain || branch === 'develop';

  if (!isProtected) {
    console.log(`[SDD-GATE] Branch '${branch}' is not protected - gate skipped.`);
    return 0;
  }

  const sddDir = join(repoRoot, 'docs', 'sdd');
  if (!existsSync(sddDir)) {
    console.log(`[SDD-GATE] ADVISORY: docs/sdd/ not found. Consider adding SDD documents.`);
    return 0;
  }

  let sddFiles: string[];
  try {
    sddFiles = readdirSync(sddDir).filter((f) => f.endsWith('.md'));
  } catch {
    sddFiles = [];
  }

  if (sddFiles.length === 0) {
    console.log(`[SDD-GATE] ADVISORY: No SDD files in docs/sdd/.`);
    return 0;
  }

  const statusMatch = /^\*\*Status\*\*:\s*(.+)$/im;
  const statusMatchYaml = /^status:\s*(.+)$/im;

  const allStatuses: SddDoc[] = sddFiles.map((name) => {
    try {
      const content = readFileSync(join(sddDir, name), 'utf-8');
      const m = content.match(statusMatch) ?? content.match(statusMatchYaml);
      return { file: name, status: m ? m[1].trim().toLowerCase() : 'unknown' };
    } catch {
      return { file: name, status: 'error' };
    }
  });

  console.log(`[SDD-GATE] Branch: ${branch} | SDD docs found: ${allStatuses.length}`);

  const validDocs = allStatuses.filter((d) => VALID_STATUSES.has(d.status));
  const draftDocs = allStatuses.filter((d) => !VALID_STATUSES.has(d.status));

  console.log(
    `[SDD-GATE] Valid (validated/done/active): ${validDocs.length} | Draft/Unknown: ${draftDocs.length}`,
  );

  if (validDocs.length === 0 && draftDocs.length > 0) {
    const draftList = draftDocs.map((d) => `${d.file} [status: ${d.status}]`).join(', ');

    if (isMain) {
      console.log(
        `[SDD-GATE] BLOCKING: Merging to main requires a validated/done SDD. Drafts: ${draftList}`,
      );
      return 1;
    } else {
      console.log(
        `[SDD-GATE] ADVISORY: All SDDs are drafts - update before merging to main. Drafts: ${draftList}`,
      );
      return 0;
    }
  }

  console.log(`[SDD-GATE] PASS - at least one validated/done SDD present.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as checkSddGate };
