import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {PUBLIC_SITE,publicFiles} from './build.js';
export const REQUIRED_PUBLIC_CHECKS=['unit','assets','navigation','catalog','chrome','identity-corporate','identity-academy','snapshots'] as const;
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const contractFiles=['src/web-presence/approval.ts','src/web-presence/gate.ts','src/web-presence/read-only-qa.ts','src/tools/verify-academy-catalog.ts','src/tools/verify-public-chrome.ts','src/tools/verify-unified-public-web.ts','apps/corporate-web/scripts/verify-pages.ts','packages/gv-design-system/src/cli/runtime-conformance.ts','packages/gv-design-system/src/cli/sync-surfaces.ts','packages/gv-design-system/dist/tokens.css','packages/gv-design-system/dist/shell.css','vitest.public-web.config.ts','tests/unit/public-web-build.test.ts','tests/unit/public-web-gate.test.ts','tests/unit/catalog-card.test.ts','tests/unit/landing-contact-boundary.test.ts'];
function contractHash(){const root=resolve(import.meta.dirname,'../..');return hash([...contractFiles,'tests/unit/landing-publication.test.ts','apps/academy-web/scripts/landing-publication.mjs','config/academy-landing.json'].map(path=>path+':'+hash(readFileSync(resolve(root,path)))).join('\n'));}
export function verifyArtifact(artifact:string):string {
 const root=resolve(artifact),raw=readFileSync(root+'.json','utf8');
 const inventory=JSON.parse(raw) as {site:string;files:{path:string;sha256:string}[]};
 if(inventory.site!==PUBLIC_SITE||!Array.isArray(inventory.files)||!inventory.files.length)throw Error('Invalid public inventory');
 const actual=publicFiles(root),expected=inventory.files.map(file=>file.path).sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Export files differ from reviewed inventory');
 for(const file of inventory.files){
  const path=resolve(root,file.path);
  if(!path.startsWith(root+sep)||file.path.includes('\\')||lstatSync(path).isSymbolicLink()||hash(readFileSync(path))!==file.sha256)throw Error('Export changed: '+file.path);
 }
 return hash(raw);
}
function complete(checks:readonly string[]){
 if(checks.length!==REQUIRED_PUBLIC_CHECKS.length||!REQUIRED_PUBLIC_CHECKS.every(check=>checks.includes(check)))throw Error('Public QA checks incomplete');
}
export function approveArtifact(artifact:string,checks:readonly string[]):void {
 complete(checks);const inventorySha256=verifyArtifact(artifact);
 writeFileSync(resolve(artifact)+'.qa.json',JSON.stringify({version:1,inventorySha256,contractSha256:contractHash(),checks,approvedAt:new Date().toISOString()},null,2));
}
export function assertApprovedArtifact(artifact:string):void {
 if(!existsSync(resolve(artifact)+'.qa.json'))throw Error('Public QA approval missing. Run npm run web:gate -- '+artifact);
 const receipt=JSON.parse(readFileSync(resolve(artifact)+'.qa.json','utf8'));
 if(receipt.version!==1)throw Error('Unsupported public QA receipt');
 complete(receipt.checks);
 if(receipt.contractSha256!==contractHash())throw Error('Public QA contract changed; validate the export again');
 if(receipt.inventorySha256!==verifyArtifact(artifact))throw Error('Inventory changed after public QA');
}
