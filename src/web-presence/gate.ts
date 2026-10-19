/** Validate exactly the immutable export that publication will consume. No payments or messages. */
import {existsSync,unlinkSync} from 'node:fs';
import {resolve,sep,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {run,runNpxTsx,runNpxTsxSync} from '../core/run-command.js';
import {approveArtifact,verifyArtifact} from './approval.js';
const root=resolve(import.meta.dirname,'../..');
let artifact=process.argv[2];
if(!artifact){
 const result=runNpxTsxSync('apps/corporate-web/scripts/prepare-pages.ts',[],{cwd:root,timeout:120000});
 if(result.status!==0)throw Error(result.stderr||result.stdout);artifact=JSON.parse(result.stdout).destination;
}
artifact=resolve(artifact!);
if(!artifact.startsWith(resolve(root,'.runtime/publishing')+sep))throw Error('Gate expects a prepared export under .runtime/publishing');
if(existsSync(artifact+'.qa.json'))unlinkSync(artifact+'.qa.json');
verifyArtifact(artifact);
const server=run(process.execPath,[resolve(root,'tools/serve-static.mjs'),'0',artifact,'--no-store'],{cwd:root});
const checks:string[]=[];
try {
 const base=await new Promise<string>((accept,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('QA preview did not start')),15000);
  server.once('error',error=>{clearTimeout(timer);reject(error);});
  server.once('exit',()=>{clearTimeout(timer);reject(Error('QA preview exited before validation'));});
  server.stdout!.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]+'/');}});
 });
 async function check(name:string,script:string,args:string[],typescript=true){
  console.log(`[web:gate] ${name}`);
  const options={cwd:root,timeout:240000,env:{GV_PUBLIC_PREVIEW_URL:base}};
  const child=typescript?runNpxTsx(script,args,options):run(process.execPath,[script,...args],options);
  child.stdout!.on('data',chunk=>process.stdout.write(chunk));child.stderr!.on('data',chunk=>process.stderr.write(chunk));
  const [code]=await once(child,'exit');if(code!==0)throw Error(`Public QA failed: ${name} (${code})`);checks.push(name);
 }
 const require=createRequire(import.meta.url);
 await check('unit',resolve(dirname(require.resolve('vitest/package.json')),'vitest.mjs'),['run','--config','vitest.public-web.config.ts','--maxWorkers=1','--pool=threads'],false);
 await check('assets','apps/corporate-web/scripts/verify-pages.ts',[artifact]);
 await check('navigation','src/tools/verify-unified-public-web.ts',[base]);
 await check('catalog','src/tools/verify-academy-catalog.ts',[base+'academy/']);
 await check('chrome','src/tools/verify-public-chrome.ts',[base]);
 await check('identity-corporate','packages/gv-design-system/src/cli/conformance.ts',['--url',base]);
 await check('identity-academy','packages/gv-design-system/src/cli/conformance.ts',['--url',base+'academy/']);
 await check('snapshots','packages/gv-design-system/src/cli/sync-surfaces.ts',[]);
 approveArtifact(artifact,checks);
 console.log(`APPROVED_ARTIFACT=${artifact}`);
}finally{
 if(server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
}
