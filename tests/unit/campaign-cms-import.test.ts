import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runContentOsMigrations } from '../../apps/content-cms/server/db-migrations.js';
import { readCampaignBundle, importCampaign } from '../../apps/content-cms/server/campaign-import.js';
const source=resolve('docs/marketing/campaigns/2026-10-gv-social-v2/gentle-vanguard-content-operations-20261018-035733');
function fixture(){const dir=mkdtempSync(join(tmpdir(),'gv-campaign-'));const db=new Database(':memory:');runContentOsMigrations(db);db.prepare("INSERT INTO content_items(id,title,status) VALUES('existing','Existing draft','draft')").run();return {dir,db};}
test('imports campaign as five drafts and ten attached media variants without slots; repeat preserves edits',()=>{
  const {dir,db}=fixture();try{
    const bundle=readCampaignBundle(source);
    const first=importCampaign(db,bundle,{tenant:'gentle-vanguard',mediaDir:dir});
    assert.equal(first.createdItems,5);assert.equal(first.createdMedia,10);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM content_items').get().n,6);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM media_library').get().n,10);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM calendar_slots').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM publish_log').get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM content_variants WHERE status='approved'").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM content_variants WHERE image_path LIKE 'media:%'").get().n,10);
    const variant=db.prepare('SELECT id FROM content_variants LIMIT 1').get().id;
    db.prepare('UPDATE content_variants SET body=? WHERE id=?').run('Human edit',variant);
    const second=importCampaign(db,bundle,{tenant:'gentle-vanguard',mediaDir:dir});
    assert.equal(second.createdItems,0);assert.equal(second.createdMedia,0);
    assert.equal(db.prepare('SELECT body FROM content_variants WHERE id=?').get(variant).body,'Human edit');
    assert.equal(db.prepare("SELECT title FROM content_items WHERE id='existing'").get().title,'Existing draft');
  }finally{db.close();}
});
test('rejects altered PNG and traversal before importing records',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gv-campaign-corrupt-'));cpSync(source,dir,{recursive:true});
  const inventory=JSON.parse(readFileSync(join(dir,'inventory.json'),'utf8'));
  writeFileSync(join(dir,inventory.assets[0].path),'corrupted');
  assert.throws(()=>readCampaignBundle(dir),/hash|PNG/i);
  inventory.assets[0].path='../outside.png';writeFileSync(join(dir,'inventory.json'),JSON.stringify(inventory));
  assert.throws(()=>readCampaignBundle(dir),/path|PNG/i);
});
test('rejects changed source under an imported campaign id and does not overwrite data',()=>{
  const {dir,db}=fixture();try{
    const bundle=readCampaignBundle(source);importCampaign(db,bundle,{tenant:'gentle-vanguard',mediaDir:dir});
    assert.throws(()=>importCampaign(db,{...bundle,digest:'changed'},{tenant:'gentle-vanguard',mediaDir:dir}),/changed|revision/i);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM content_items').get().n,6);
  }finally{db.close();}
});
test('a record collision rolls back the complete campaign without altering the preexisting row',()=>{
  const {dir,db}=fixture();try{
    const bundle=readCampaignBundle(source);
    const id=`campaign-${bundle.id}-${bundle.pieces[1]!.id}`;
    db.prepare("INSERT INTO content_items(id,title,status) VALUES(?,?,'draft')").run(id,'Existing manual item');
    assert.throws(()=>importCampaign(db,bundle,{tenant:'gentle-vanguard',mediaDir:dir}),/UNIQUE/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM content_items').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM content_variants').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM media_library').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM content_campaign_imports').get().n,0);
    assert.equal(db.prepare('SELECT title FROM content_items WHERE id=?').get(id).title,'Existing manual item');
  }finally{db.close();}
});
