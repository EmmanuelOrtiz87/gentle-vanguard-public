import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile(
  'phases.ts',
  readFileSync(new URL('../../src/session/session-close/phases.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);

test('legacy close deletion paths require retention authorization', () => {
  const unsafe: string[] = [];
  function visit(node: ts.Node, authorized = false): void {
    if (ts.isIfStatement(node) && node.expression.getText(source) === 'retentionAuthorized') {
      visit(node.thenStatement, true);
      if (node.elseStatement) visit(node.elseStatement, authorized);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      const isDeletion =
        name === 'rmSync' ||
        (name === 'runSessionRetention' && node.arguments[0]?.getText(source) === 'true') ||
        (name === 'runScript' &&
          node.arguments[0]?.getText(source).includes('session-cleanup-start.ts'));
      if (isDeletion && !authorized) unsafe.push(node.getText(source));
    }
    ts.forEachChild(node, (child) => visit(child, authorized));
  }
  visit(source);
  assert.deepEqual(unsafe, [], 'close must preserve artifacts without retention authorization');
});
