/** Cross-platform hook: preserve the existing optional live probe without shell syntax. */
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {runSync} from '../core/run-command.js';
const root=resolve(import.meta.dirname,'../..');
const base=process.env.KOPS_BASE||'http://127.0.0.1:4197';
const script=resolve(root,'apps/gv-knowledge-ops/tests/visual-responsive.test.mjs');
let available=false;
if(existsSync(script))try{available=(await fetch(base,{method:'HEAD',signal:AbortSignal.timeout(2000)})).ok;}catch{/* App is not running. */}
if(!available){console.log('[kops-visual-validation] App/test unavailable in this branch; live visual check not executed.');}
else{
 const result=runSync(process.execPath,[script],{cwd:root,env:{KOPS_BASE:base},stdio:'inherit',timeout:240000});
 process.exitCode=result.status??1;
}
