/** Compatibility command: publish the complete public website, including /academy/. */
import {runSync,runNpxTsxSync} from '../core/run-command.js';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const build=runSync(process.execPath,['--import','tsx','apps/corporate-web/scripts/prepare-pages.ts'],{cwd:root,timeout:120000});
if(build.status!==0)throw new Error(build.stderr||build.stdout);
const result=JSON.parse(build.stdout);
console.log(build.stdout);
const qa=runNpxTsxSync('src/web-presence/gate.ts',[result.destination],{cwd:root,timeout:900000,maxBuffer:8*1024*1024});
console.log(qa.stdout);if(qa.status!==0)throw Error(qa.stderr||qa.stdout);
const publish=runSync(process.execPath,['--import','tsx','apps/corporate-web/scripts/publish-pages.ts',result.destination,...(process.argv.includes('--dry-run')?[]:['--push'])],{cwd:root,timeout:240000});
console.log(publish.stdout);if(publish.status!==0)throw new Error(publish.stderr||publish.stdout);
