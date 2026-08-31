#!/usr/bin/env node
/**
 * skill-cli.ts — CLI entry for the skill plugin system (F3.4)
 *
 * Usage:
 *   npx tsx src/plugins/skill-cli.ts list [--json]
 *   npx tsx src/plugins/skill-cli.ts install <url-or-path> [--json]
 *   npx tsx src/plugins/skill-cli.ts enable <name>   [--json]
 *   npx tsx src/plugins/skill-cli.ts disable <name>  [--json]
 *   npx tsx src/plugins/skill-cli.ts deprecate <name> [--json]
 *   npx tsx src/plugins/skill-cli.ts remove <name>   [--json]
 *   npx tsx src/plugins/skill-cli.ts verify          [--json]
 *
 * stdout is machine-parseable: plain `key: value` lines by default, full JSON
 * with --json. Exit code 0 = success, 1 = failure.
 */

import { pathToFileURL } from 'url';
import { installSkill, removeSkill } from './skill-install.js';
import {
  getEntry,
  listEntries,
  setStatus,
  verifyIndex,
} from './skill-registry.js';

export interface SkillCliResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

export function runSkillCli(args: string[]): SkillCliResult {
  const sub = args[0] ?? 'list';
  const json = args.includes('--json');
  const name = args.find((a, i) => i > 0 && !a.startsWith('--'));

  try {
    switch (sub) {
      case 'list': {
        const entries = listEntries();
        const out = { format: json ? 'json' : 'text', ok: true, count: entries.length, skills: entries };
        return { ok: true, message: json ? JSON.stringify(out) : formatList(entries), data: out };
      }
      case 'install': {
        // Install is async (network/git) — handled by main(); kept here so the
        // sync dispatcher returns a parseable error instead of throwing.
        return {
          ok: false,
          message: 'install requires the async CLI entry (src/plugins/skill-cli.ts install <src>)',
        };
      }
      case 'enable':
      case 'disable':
      case 'deprecate': {
        if (!name) return { ok: false, message: `usage: skill ${sub} <name>` };
        const r = setStatus(name, sub as 'enabled' | 'disabled' | 'deprecated');
        return { ok: r.ok, message: r.message, data: r.entry };
      }
      case 'remove': {
        if (!name) return { ok: false, message: 'usage: skill remove <name>' };
        const r = removeSkill(name);
        return { ok: r.ok, message: r.message };
      }
      case 'verify': {
        const v = verifyIndex();
        return v.ok
          ? { ok: true, message: 'registry integrity OK (sha256 matches)' }
          : {
              ok: false,
              message: `registry integrity FAIL: expected ${v.expected.slice(0, 12)}… got ${v.actual.slice(0, 12)}… (index tampered or hand-edited)`,
            };
      }
      case 'get': {
        if (!name) return { ok: false, message: 'usage: skill get <name>' };
        const e = getEntry(name);
        if (!e) return { ok: false, message: `skill plugin '${name}' is not installed` };
        return { ok: true, message: JSON.stringify(e, null, 2), data: e };
      }
      default:
        return {
          ok: false,
          message:
            'usage: skill <list|install|enable|disable|deprecate|remove|verify|get> [args] [--json]',
        };
    }
  } catch (e) {
    return { ok: false, message: `error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function formatList(entries: ReturnType<typeof listEntries>): string {
  if (entries.length === 0) {
    return 'No skill plugins installed. Use: gv skill install <url-or-path>';
  }
  const lines = entries.map(
    (e) =>
      `${e.status === 'enabled' ? '[+]' : e.status === 'disabled' ? '[-]' : '[~]'} ${e.name} v${e.version}  perms=${e.permissions.join(',')}  origin=${e.originType}  installed=${e.installedAt.slice(0, 10)}`,
  );
  return [`Installed skill plugins (${entries.length}):`, ...lines].join('\n');
}

// ─── async main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  // `install` needs await (network/git) — handle before the sync dispatcher.
  if (args[0] === 'install') {
    const source = args.find((a, i) => i > 0 && !a.startsWith('--'));
    if (!source) {
      console.error('usage: skill install <url-or-path>');
      process.exit(1);
    }
    const r = await installSkill(source);
    if (json) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(r.message);
      if (r.findings) for (const f of r.findings) console.log(`  ${f}`);
    }
    process.exit(r.ok ? 0 : 1);
  }

  const r = runSkillCli(args);
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
