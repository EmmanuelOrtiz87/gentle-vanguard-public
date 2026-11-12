/**
 * TEST NEGATIVO de quality-gates-verify.
 *
 * Reproduce el incidente real (2026-11-06): el verificador que certifica que
 * cada gate "enforced" tiene ejecucion real reportaba PASS para un gate que
 * habia sido ELIMINADO del hook semanas atras. El gate se "certificaba" porque
 * su mencion sobrevivia en un COMENTARIO del YAML, y ademas porque un
 * argumento incidental del comando ("filesystem") o un nombre de archivo
 * (.trufflehogignore) aparecian en cualquier parte del corpus.
 *
 * Un verificador que certifica lo que NO esta: certifica el resto.
 * Estos tests exigen que muerda.
 *
 * Corre con:  node --import tsx --test src/tools/quality-gates-verify.test.ts
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(HERE, 'quality-gates-verify.ts');

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

interface RepoFiles {
  gates: unknown[];
  lefthook?: string;
  prepush?: string;
  packageScripts?: Record<string, string>;
}

/** Repo minimo con el shape que el verificador espera. */
function makeRepo(files: RepoFiles): string {
  const root = mkdtempSync(join(tmpdir(), 'gates-verify-'));
  temps.push(root);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'src', 'git'), { recursive: true });
  writeFileSync(
    join(root, 'config', 'quality-gates.json'),
    JSON.stringify({ gates: files.gates }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(root, '.lefthook.yml'),
    files.lefthook ?? 'pre-commit:\n  commands:\n    other:\n      run: node x.js\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'git', 'prepush-gate.ts'),
    files.prepush ?? "export const X = 'src/ops/other.ts';\n",
    'utf8',
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: files.packageScripts ?? {} }, null, 2),
    'utf8',
  );
  return root;
}

interface VerifierRun {
  status: number;
  out: string;
}

function runVerifier(root: string): VerifierRun {
  const tsx = pathToFileURL(require_.resolve('tsx')).href;
  try {
    const out = execFileSync(process.execPath, ['--import', tsx, VERIFIER, '--report'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, out: e.stdout ?? '' };
  }
}

describe('quality-gates-verify (contratests negativos)', () => {
  it('NO certifica un gate cuya unica mencion es un comentario del YAML', () => {
    const root = makeRepo({
      gates: [
        {
          id: 'pre-commit-trufflehog',
          stage: 'pre-commit',
          enforced: true,
          tool: 'trufflehog',
          command: 'trufflehog filesystem --no-verification .',
        },
      ],
      lefthook: [
        'pre-commit:',
        '  commands:',
        '    # trufflehog removed 2026-08-22: it never blocked anything',
        '    other:',
        '      run: node x.js',
        '',
      ].join('\n'),
    });

    const { out } = runVerifier(root);
    assert.match(out, /DRIFT pre-commit-trufflehog/);
    assert.doesNotMatch(out, /OK\s+pre-commit-trufflehog/);
  });

  it('NO certifica un gate que solo aparece dentro de un nombre de archivo', () => {
    const root = makeRepo({
      gates: [
        {
          id: 'pre-commit-trufflehog',
          stage: 'pre-commit',
          enforced: true,
          tool: 'trufflehog',
          command: 'trufflehog filesystem --no-verification .',
        },
      ],
      // ".trufflehogignore" es un archivo a copiar, NO una ejecucion del gate.
      packageScripts: { build: 'node build.js', copy: 'node copy-files.js' },
    });
    mkdirSync(join(root, 'src', 'ops'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'ops', 'copy-files.ts'),
      "const FILES = ['.gitattributes', '.trufflehogignore'];\n",
      'utf8',
    );

    const { out } = runVerifier(root);
    assert.match(out, /DRIFT pre-commit-trufflehog/);
  });

  it('NO certifica un gate por un argumento incidental de su comando', () => {
    const root = makeRepo({
      gates: [
        {
          id: 'pre-commit-trufflehog',
          stage: 'pre-commit',
          enforced: true,
          tool: 'trufflehog',
          command: 'trufflehog filesystem --no-verification --no-update .',
        },
      ],
      packageScripts: { build: 'node build.js' },
    });
    mkdirSync(join(root, 'src', 'ops'), { recursive: true });
    // "filesystem" aparece, pero como argumento de OTRO comando.
    writeFileSync(join(root, 'src', 'ops', 'other.ts'), "const mode = 'filesystem';\n", 'utf8');

    const { out } = runVerifier(root);
    assert.match(out, /DRIFT pre-commit-trufflehog/);
  });

  it('SI certifica un gate con ejecucion real en el hook (control positivo)', () => {
    const root = makeRepo({
      gates: [
        {
          id: 'pre-commit-secretlint',
          stage: 'pre-commit',
          enforced: true,
          tool: 'secretlint',
          command: 'secretlint --secretlintrc .secretlintrc.json {staged_files}',
        },
      ],
      lefthook: [
        'pre-commit:',
        '  commands:',
        '    secretlint:',
        '      run: npx secretlint --secretlintrc .secretlintrc.json {staged_files}',
        '',
      ].join('\n'),
    });

    const { out } = runVerifier(root);
    assert.match(out, /OK\s+pre-commit-secretlint/);
    assert.doesNotMatch(out, /DRIFT pre-commit-secretlint/);
  });

  it('SENALA un check del composite pre-push que el catalogo no declara', () => {
    const root = makeRepo({
      gates: [
        {
          id: 'pre-push-audit',
          stage: 'pre-push',
          enforced: true,
          tool: 'audit-ps1-refs.ts',
          command: 'node --import tsx src/tools/audit-ps1-refs.ts',
        },
      ],
      // El composite ejecuta deadcode-ratchet.ts, pero el catalogo no lo declara.
      prepush: "export const CHECKS = ['src/ops/deadcode-ratchet.ts'];\n",
    });

    const { out } = runVerifier(root);
    assert.match(out, /UNCOVERED deadcode-ratchet\.ts/);
  });

  it('NO senala UNCOVERED cuando el catalogo cubre el check del composite', () => {
    const root = makeRepo({
      gates: [
        {
          id: 'pre-push-deadcode-ratchet',
          stage: 'pre-push',
          enforced: true,
          tool: 'deadcode-ratchet.ts',
          command: 'node --import tsx src/ops/deadcode-ratchet.ts',
        },
      ],
      prepush: "export const CHECKS = ['src/ops/deadcode-ratchet.ts'];\n",
      lefthook: [
        'pre-push:',
        '  commands:',
        '    prepush-gate:',
        '      run: node --import tsx src/git/prepush-gate.ts',
        '',
      ].join('\n'),
    });

    const { out } = runVerifier(root);
    assert.doesNotMatch(out, /UNCOVERED/);
  });
});
