#!/usr/bin/env node

/**
 * Verify that every enforced quality gate is REALLY enforced somewhere.
 *
 * `config/quality-gates.json` used to be documentation-only: nothing checked
 * that the gates it declared were executed by a hook or a workflow. This tool
 * closes the loop:
 *
 *   1. resolve the gate command against the npm scripts of the repo
 *      (a gate that runs `pnpm lint` is enforced if the `lint` script is
 *      referenced by a hook or a workflow);
 *   2. look for that reference in `.lefthook.yml` and `.github/workflows/*`;
 *   3. fail when an enforced gate has no enforcement anywhere.
 *
 * Usage:
 *   npm run gates:verify          # report + exit 1 on drift
 *   npm run gates:verify -- --report  # report only, always exit 0
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Gate {
  id: string;
  name?: string;
  stage?: string;
  enforced?: boolean;
  command?: string;
  enforcer?: string;
  /** Tool or script that implements the gate (e.g. "eslint", "deadcode-ratchet.ts"). */
  tool?: string;
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'config', 'quality-gates.json'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * A YAML comment is not enforcement.
 *
 * The corpus used to be matched with a raw `includes()`, so a gate that had
 * been DELETED was still certified as enforced when its removal was only
 * mentioned in a comment (`.lefthook.yml`: "trufflehog removed 2026-08-22").
 * The verifier that certifies every gate was itself reporting a false PASS.
 *
 * Full-line comments are stripped before the corpus is built, so a gate can
 * only be certified by a command that actually runs.
 */
function stripYamlComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function main(): void {
  const root = repoRoot();
  const reportOnly = process.argv.includes('--report');

  const gatesFile = JSON.parse(
    readFileSync(join(root, 'config', 'quality-gates.json'), 'utf8'),
  ) as { gates?: Gate[] };
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};

  const lefthookRaw = existsSync(join(root, '.lefthook.yml'))
    ? readFileSync(join(root, '.lefthook.yml'), 'utf8')
    : '';
  // Comments never count as enforcement (see stripYamlComments).
  const lefthook = stripYamlComments(lefthookRaw);
  const wfDir = join(root, '.github', 'workflows');
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map((f) => ({ file: f, text: stripYamlComments(readFileSync(join(wfDir, f), 'utf8')) }))
    : [];

  /**
   * Tokens too generic to prove enforcement: "node" or "pnpm" appear in almost
   * every hook. A gate only counts as verified through a specific token: the
   * script it runs (basename with extension) or a tool name.
   */
  const GENERIC = new Set([
    'node',
    'npm',
    'npx',
    'pnpm',
    'yarn',
    'deno',
    'bun',
    'ts',
    'js',
    'mjs',
    'cjs',
    'py',
    'python',
    'sh',
    'bash',
    'powershell',
    'cmd',
    'git',
    'docker',
    'make',
    'run',
    'modules',
    'src',
  ]);

  /**
   * Lookup keys for a gate. A gate is enforced if ANY of these appears in a
   * hook or a workflow:
   *   - the script paths it runs (src/hooks/foo.ts -> foo.ts)
   *   - the tool it runs (eslint, prettier, secretlint, trufflehog...)
   *   - the npm scripts that resolve to the same tool (`pnpm lint` == eslint)
   */
  function lookupKeys(gate: Gate): string[] {
    const keys = new Set<string>();
    const command = gate.command ?? '';
    // Drop the invocation prefix: `node --import tsx`, `npx tsx`, `npm run`...
    // Those tokens say how the gate is launched, not WHAT it checks.
    const rest = command
      .replace(/^\s*(node\s+--import\s+tsx|npx\s+tsx|npx|node|pnpm|npm\s+run|npm)\s+/i, '')
      .trim();
    const tokens = rest.split(/\s+/).filter(Boolean);

    let skipNext = false;
    // Only the FIRST positional token identifies the tool. The rest are
    // arguments: `trufflehog filesystem --no-verification` was certified by the
    // word "filesystem" appearing in an unrelated CI file, so a gate that was
    // deleted months ago still looked enforced.
    let primaryTaken = false;
    for (const token of tokens) {
      const clean = token.replace(/[{},"']/g, '');
      const lower = clean.toLowerCase();
      if (lower.startsWith('-')) {
        skipNext = true;
        continue;
      }
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (clean.includes('/')) {
        if (!/[*?]/.test(clean) && /\.(ts|js|mjs|cjs|ps1|py)$/i.test(clean)) {
          keys.add(clean.split('/').pop()!.toLowerCase());
        }
        continue;
      }
      if (primaryTaken) continue;
      if (!GENERIC.has(lower) && lower.length > 2) {
        keys.add(lower);
        primaryTaken = true;
      }
    }

    // `pnpm lint` / `npm run lint`: the script name is the real handle.
    const pm = tokens.findIndex((t) => ['pnpm', 'npm', 'npx', 'yarn'].includes(t.toLowerCase()));
    if (pm >= 0 && tokens[pm + 1]) {
      const next = tokens[pm + 1]
        .replace(/^run$/i, '')
        .replace(/[{},"']/g, '')
        .toLowerCase();
      if (next && !GENERIC.has(next)) keys.add(next);
    }

    for (const [name, body] of Object.entries(scripts)) {
      const normalized = normalize(body);
      for (const key of [...keys]) {
        if (normalized.includes(key)) keys.add(name.toLowerCase());
      }
    }
    return [...keys].filter((k) => k.length > 2 && !GENERIC.has(k));
  }

  /** Scripts that the hooks/workflows reference directly. */
  function referencedScripts(): Set<string> {
    const refs = new Set<string>();
    const pattern = /[\w.-]+\.(?:ts|js|mjs|cjs|ps1|py)\b/g;
    for (const source of [lefthook, ...workflows.map((w) => w.text)]) {
      for (const match of source.matchAll(pattern)) refs.add(match[0].toLowerCase());
    }
    return refs;
  }

  /**
   * One level of indirection: a gate script that is not referenced directly can
   * still be enforced if an entry point (a hook in .lefthook.yml) imports it.
   */
  function importersOf(basename: string): string[] {
    const importers: string[] = [];
    for (const dir of ['src', 'scripts']) {
      const root = join(root_dir, dir);
      if (!existsSync(root)) continue;
      for (const file of walk(root)) {
        if (!/\.(ts|mjs)$/.test(file)) continue;
        let text = '';
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        if (!text.includes(basename)) continue;
        const rel = file.slice(root_dir.length + 1).replace(/\\/g, '/');
        importers.push(rel);
      }
    }
    return importers;
  }

  function walk(dir: string): string[] {
    const out: string[] = [];
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        out.push(...walk(full));
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * What actually runs: the hooks, the workflows and the code those
   * workflows execute (a workflow that calls `pnpm delivery:gate:pr` runs
   * every step declared in src/delivery/gate.ts).
   */
  function enforcementCorpus(): { text: string; sources: Map<string, string> } {
    const sources = new Map<string, string>();
    sources.set('.lefthook.yml', lefthook);
    for (const wf of workflows) sources.set(`.github/workflows/${wf.file}`, wf.text);

    // The composite pre-push IS the enforcement surface: the checks it runs
    // are what the push actually executes. It has to be part of the corpus,
    // otherwise a check that only the composite runs (for example one
    // delegated to an npm script) looks like it has no execution at all.
    const composite = join(root, 'src', 'git', 'prepush-gate.ts');
    if (existsSync(composite)) {
      sources.set('src/git/prepush-gate.ts', readFileSync(composite, 'utf8'));
    }

    // The session-autostart pipeline is ALSO an enforcement surface: every
    // step declared in config/session-autostart.config.json runs on session
    // start (some of them lazily, in the background). A gate that only runs
    // there is still really executed, so the corpus has to know about it.
    const autostart = join(root, 'config', 'session-autostart.config.json');
    if (existsSync(autostart)) {
      sources.set('config/session-autostart.config.json', readFileSync(autostart, 'utf8'));
    }

    // One level of indirection through npm scripts: if the corpus mentions a
    // script name, the implementation of that script runs too.
    let text = [...sources.values()].join('\n');
    for (const [name, body] of Object.entries(scripts)) {
      if (!text.includes(name)) continue;
      const match = body.match(/(?:src|scripts)\/[\w./-]+\.(?:ts|mjs|js)/);
      if (!match) continue;
      const file = join(root, match[0]);
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      if (!sources.has(match[0])) sources.set(match[0], content);
      text += `\n${content}`;
    }
    return { text, sources };
  }

  /**
   * A tool name counts as a reference only when it appears as a STANDALONE
   * word. A plain `includes()` also matched the tool name inside an unrelated
   * identifier: `.trufflehogignore` (a file to copy) certified a pre-commit
   * trufflehog gate that had been deleted months earlier.
   */
  function containsToken(content: string, key: string): boolean {
    const needle = key.toLowerCase();
    const haystack = content.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) return false;
      const before = at > 0 ? haystack[at - 1] : '';
      const after = haystack[at + needle.length] ?? '';
      const leftOk = before === '' || !/[.\-_a-z0-9]/.test(before);
      const rightOk = after === '' || !/[a-z0-9]/.test(after);
      if (leftOk && rightOk) return true;
      from = at + 1;
    }
  }

  function enforcementRefs(
    keys: string[],
    corpus: { text: string; sources: Map<string, string> },
  ): string[] {
    const found: string[] = [];
    for (const key of keys) {
      for (const [label, content] of corpus.sources) {
        if (containsToken(content, key)) found.push(`${label}:${key}`);
      }
    }
    return [...new Set(found)];
  }

  const root_dir = root;
  const directRefs = referencedScripts();
  const corpus = enforcementCorpus();
  const gates = gatesFile.gates ?? [];
  const drifted: { id: string; stage?: string; command?: string; keys: string[] }[] = [];
  const verified: { id: string; refs: string[] }[] = [];

  /**
   * Reverse invariant: the catalog must COVER reality, not only claim it.
   *
   * Checking "every declared gate has an execution" is one half. The other
   * half is "every check the pre-push composite actually runs is declared in
   * the catalog" — otherwise a new check can be added to the composite and
   * stay invisible in the catalog forever (the composite ran 24 checks while
   * the catalog described 3 of them).
   *
   * Test files are excluded: they are the negative contracts OF the gates
   * already declared, not independent gates.
   */
  function uncataloguedCompositeScripts(): string[] {
    const prepush = join(root, 'src', 'git', 'prepush-gate.ts');
    if (!existsSync(prepush)) return [];
    const text = readFileSync(prepush, 'utf8');
    const scripts = new Set<string>();
    for (const match of text.matchAll(/'(src\/[\w./-]+\.(?:ts|mjs))'/g)) {
      scripts.add(match[1].split('/').pop()!);
    }
    const declared = new Set(
      gates.map((g) => (g.tool ?? '').split('/').pop()).filter((t): t is string => Boolean(t)),
    );
    return [...scripts].filter((s) => !s.endsWith('.test.ts') && !declared.has(s));
  }

  for (const gate of gates) {
    if (gate.enforced !== true) continue;
    const keys = lookupKeys(gate);
    let refs = enforcementRefs(keys, corpus);
    if (!refs.length) {
      // Try one level of indirection: is the gate script imported by an
      // entry point that a hook or a workflow actually runs?
      const scriptKeys = keys.filter((k) => /\.(ts|js|mjs|ps1|py)$/.test(k));
      for (const script of scriptKeys) {
        for (const importer of importersOf(script)) {
          const base = importer.split('/').pop()!.toLowerCase();
          if (directRefs.has(base) || enforcementRefs([base], corpus).length) {
            refs = [...refs, `imported-by:${importer}`];
            break;
          }
        }
        if (refs.length) break;
      }
    }
    if (refs.length) {
      verified.push({ id: gate.id, refs });
    } else {
      drifted.push({ id: gate.id, stage: gate.stage, command: gate.command, keys });
    }
  }

  const uncatalogued = uncataloguedCompositeScripts();

  console.log(
    `gates:verify -> ${verified.length} gates con enforcement verificable, ${drifted.length} sin enforcement real` +
      (uncatalogued.length ? `, ${uncatalogued.length} checks del composite sin catalogar` : ''),
  );
  for (const v of verified) console.log(`  OK   ${v.id} (${v.refs[0]})`);
  for (const d of drifted) {
    console.log(
      `  DRIFT ${d.id} [${d.stage}] :: ${d.command ?? '(sin comando)'}${
        d.keys.length ? ` (buscado: ${d.keys.slice(0, 4).join(', ')})` : ''
      }`,
    );
  }
  for (const s of uncatalogued) {
    console.log(`  UNCOVERED ${s} — el composite pre-push lo ejecuta y el catalogo no lo declara`);
  }

  if (drifted.length && !reportOnly) {
    console.error(
      `gates:verify -> ${drifted.length} gate(s) declarados como enforced sin ejecucion real. ` +
        'Corre el gate de verdad (hook/workflow) o baja su enforced a false.',
    );
    process.exit(1);
  }
  if (uncatalogued.length && !reportOnly) {
    console.error(
      `gates:verify -> ${uncatalogued.length} check(s) del composite pre-push sin entrada en ` +
        'config/quality-gates.json. Cataloga el gate nuevo o el catalogo queda incompleto.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
