/**
 * Tests del guard de scope `workflow` en sync-to-public (fallo recurrente GH013:
 * "refusing to allow an OAuth App to create or update workflow"). El sync debe
 * degradar con gracia (excluir workflows + WARN accionable), nunca fallar el push
 * entero por una credencial sin scope.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const mod = await import(pathToFileURL(resolve(ROOT, 'src/infrastructure/sync-to-public.ts')).href);
const { parseWorkflowScope, isWorkflowScopeRejection } = mod as {
  parseWorkflowScope: (out: string) => string;
  isWorkflowScopeRejection: (out: string) => boolean;
};

describe('parseWorkflowScope (gh auth status)', () => {
  it('granted cuando el scope workflow está presente', () => {
    const ghOut = [
      'github.com',
      '  ✓ Logged in to github.com account EmmanuelOrtiz87 (keyring)',
      '  - Active account: true',
      '  - Git operations protocol: https',
      '  - Token: gho_****',
      '  - Token scopes: gist, read:org, repo, workflow',
    ].join('\n');
    assert.strictEqual(parseWorkflowScope(ghOut), 'granted');
  });

  it('granted con scopes entre comillas (formato de gh con dos cuentas)', () => {
    const ghOut = [
      'github.com',
      '  ✓ Logged in to github.com account EmmanuelOrtiz87 (keyring)',
      "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
    ].join('\n');
    assert.strictEqual(parseWorkflowScope(ghOut), 'granted');
  });

  it('missing con scopes entre comillas y sin workflow', () => {
    const ghOut = "  - Token scopes: 'gist', 'read:org', 'repo'";
    assert.strictEqual(parseWorkflowScope(ghOut), 'missing');
  });

  it('missing cuando hay scopes pero workflow no está (el caso GH013)', () => {
    const ghOut = [
      'github.com',
      '  ✓ Logged in to github.com account EmmanuelOrtiz87 (keyring)',
      '  - Token: gho_****',
      '  - Token scopes: gist, read:org, repo',
    ].join('\n');
    assert.strictEqual(parseWorkflowScope(ghOut), 'missing');
  });

  it('missing cuando gh imprime por stderr (exit 0 con salida en stderr)', () => {
    const ghOut = '  - Token scopes: repo, read:org'; // solo stderr
    assert.strictEqual(parseWorkflowScope(ghOut), 'missing');
  });

  it('unknown sin línea de scopes (gh ausente o formato inesperado)', () => {
    assert.strictEqual(parseWorkflowScope('command not found: gh'), 'unknown');
    assert.strictEqual(parseWorkflowScope(''), 'unknown');
  });

  it('no confunde substrings: "workflows" o "xworkflow" no cuentan como scope', () => {
    const tricky = '  - Token scopes: repo, workflows-x, myworkflow';
    assert.strictEqual(parseWorkflowScope(tricky), 'missing');
  });
});

describe('isWorkflowScopeRejection (rechazo GH013 del push)', () => {
  it('reconoce el mensaje real de GitHub', () => {
    const out = [
      'remote: error: GH013: Repository rule violations found for refs/heads/main.',
      '! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)',
    ].join('\n');
    assert.strictEqual(isWorkflowScopeRejection(out), true);
  });

  it('reconoce el rechazo por OAuth App aunque no venga el codigo GH013', () => {
    const out =
      'refusing to allow an OAuth App to create or update workflow `.github/workflows/x.yml` without `workflow` scope';
    assert.strictEqual(isWorkflowScopeRejection(out), true);
  });

  it('no confunde un rechazo comun (non-fast-forward)', () => {
    const out = '! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs';
    assert.strictEqual(isWorkflowScopeRejection(out), false);
  });

  it('no confunde la palabra workflow en un mensaje informativo', () => {
    assert.strictEqual(isWorkflowScopeRejection('updated workflows on 2 branches'), false);
  });
});
