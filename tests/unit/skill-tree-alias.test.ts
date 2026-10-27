import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copySkillTree} from '../../src/integrations/zcode-sync.js';

test('skill sync accepts a junction already pointing to the canonical source', () => {
  const dir=mkdtempSync(join(tmpdir(),'gv-skill-alias-'));
  const source=join(dir,'source'), target=join(dir,'alias');
  mkdirSync(source);writeFileSync(join(source,'SKILL.md'),'canonical skill');
  symlinkSync(source,target,process.platform==='win32'?'junction':'dir');
  assert.doesNotThrow(()=>copySkillTree(source,target));
  assert.equal(readFileSync(join(target,'SKILL.md'),'utf8'),'canonical skill');
});
