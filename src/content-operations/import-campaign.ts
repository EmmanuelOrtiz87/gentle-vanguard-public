/** Import a verified campaign into local CMS drafts. Dry-run by default; no remote actions. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { readCampaignBundle, importCampaign } from '../../apps/content-cms/server/campaign-import.js';
import { runContentOsMigrations } from '../../apps/content-cms/server/db-migrations.js';
import { validate, loadPlatformRegistry, type Job } from './engine.js';
const root=resolve(import.meta.dirname,'../..');const app=join(root,'apps/content-cms');
const index=process.argv.indexOf('--bundle');if(index<0||!process.argv[index+1])throw new Error('Expected --bundle <reviewed campaign directory> [--apply]');
const bundle=readCampaignBundle(resolve(process.argv[index+1]!));
const apply=process.argv.includes('--apply');
const mediaDir=join(app,'.runtime/content-os/media');
const manifests=[root,app].map(base=>{
  const path=join(base,'content/operations/master-manifest.json');
  const existing=JSON.parse(readFileSync(path,'utf8')) as Job[];
  const registry=loadPlatformRegistry(base);
  const additions=bundle.jobs.filter(j=>!existing.some(e=>e.id===j.id)).map(j=>{
    const name=j.id.slice(bundle.id.length+1)+'.png';
    const asset=relative(base,join(mediaDir,`campaign-media-${bundle.id}-${name}`)).replaceAll('\\','/');
    const job={...j,asset} as Job;const errors=validate(job,registry);if(errors.length)throw new Error(errors.join('; '));return job;
  });
  return {path,existing,additions};
});
if(!apply){console.log(JSON.stringify({dryRun:true,campaign:bundle.id,items:bundle.pieces.length,media:bundle.assets.length,manifests:manifests.map(m=>({path:m.path,existing:m.existing.length,append:m.additions.length})),remoteActions:0},null,2));}
else{
  const backup=join(root,'.runtime/campaign-import-backups',`${bundle.id}-${Date.now()}`);mkdirSync(backup,{recursive:true});
  const db=new Database(join(app,'.runtime/content-cms.db'),{fileMustExist:true});
  try{
    db.pragma('busy_timeout=5000');db.pragma('foreign_keys=ON');
    await db.backup(join(backup,'content-cms.db'));
    for(const [i,m] of manifests.entries())copyFileSync(m.path,join(backup,`manifest-${i}.json`));
    runContentOsMigrations(db);
    const result=importCampaign(db,bundle,{tenant:'gentle-vanguard',mediaDir});
    // Append only. Existing user edits/statuses survive repeated imports.
    for(const m of manifests)if(m.additions.length)writeFileSync(m.path,JSON.stringify([...m.existing,...m.additions],null,2)+'\n');
    console.log(JSON.stringify({...result,backup,manifests:manifests.map(m=>({path:m.path,appended:m.additions.length,total:m.existing.length+m.additions.length})),scheduled:0,approved:0,remoteActions:0},null,2));
  }finally{db.close();}
}
