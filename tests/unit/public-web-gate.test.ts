import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,unlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {approveArtifact,assertApprovedArtifact,REQUIRED_PUBLIC_CHECKS} from '../../src/web-presence/approval.js';

function artifact(){
 const path=mkdtempSync(join(tmpdir(),'gv-gate-'));writeFileSync(join(path,'index.html'),'reviewed');
 const sha256=createHash('sha256').update('reviewed').digest('hex');
 writeFileSync(path+'.json',JSON.stringify({site:'https://gentlevanguard.github.io/',files:[{path:'index.html',sha256}]}));
 return path;
}
describe('public artifact approval',()=>{
 it('rejects an untested export and incomplete checks',()=>{
  const path=artifact();expect(()=>assertApprovedArtifact(path)).toThrow();
  expect(()=>approveArtifact(path,[])).toThrow();
 });
 it('accepts only the complete tested export and rejects changes after approval',()=>{
  const path=artifact();approveArtifact(path,[...REQUIRED_PUBLIC_CHECKS]);expect(()=>assertApprovedArtifact(path)).not.toThrow();
  writeFileSync(join(path,'index.html'),'changed after QA');expect(()=>assertApprovedArtifact(path)).toThrow();
 });
 it('rejects unreviewed additions, missing files and changed inventory',()=>{
  const path=artifact();approveArtifact(path,[...REQUIRED_PUBLIC_CHECKS]);
  writeFileSync(join(path,'private.txt'),'not reviewed');expect(()=>assertApprovedArtifact(path)).toThrow();unlinkSync(join(path,'private.txt'));
  unlinkSync(join(path,'index.html'));expect(()=>assertApprovedArtifact(path)).toThrow();
  writeFileSync(join(path,'index.html'),'reviewed');writeFileSync(path+'.json','{}');expect(()=>assertApprovedArtifact(path)).toThrow();
 });
 it('rejects approval from a different QA contract',()=>{
  const path=artifact();approveArtifact(path,[...REQUIRED_PUBLIC_CHECKS]);
  const receipt=JSON.parse(readFileSync(path+'.qa.json','utf8'));receipt.contractSha256='old-contract';writeFileSync(path+'.qa.json',JSON.stringify(receipt));
  expect(()=>assertApprovedArtifact(path)).toThrow('contract changed');
 });
});
