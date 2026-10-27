/** Read-only verification: actual API, media hashes and CMS UI; no approve/schedule/publish clicks. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const campaign=JSON.parse(readFileSync(join(root,'docs/marketing/campaigns/2026-10-gv-social-v2/campaign.json'),'utf8'));
const inventory=JSON.parse(readFileSync(join(root,'docs/marketing/campaigns/2026-10-gv-social-v2/gentle-vanguard-content-operations-20261018-035733/inventory.json'),'utf8'));
const out=join(root,'.runtime/qa-cms-campaign');mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const errors:string[]=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await page.addInitScript(()=>{localStorage.setItem('gv-cc-lang','es');localStorage.setItem('gv-cc-theme','dark');});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5175/');
  const get=async(path:string)=>{const r=await page.request.get(`http://127.0.0.1:3787/api/${path}`);assert.equal(r.status(),200);return r.json();};
  const {items}=await get('items');const {media}=await get('media');const {slots}=await get('slots');
  const imported=items.filter((i:{id:string})=>i.id.startsWith(`campaign-${campaign.id}-`));assert.equal(imported.length,5);
  assert.equal(slots.filter((s:{item_id:string})=>s.item_id.startsWith(`campaign-${campaign.id}-`)).length,0);
  for(const piece of campaign.pieces){
    const item=imported.find((i:{id:string})=>i.id===`campaign-${campaign.id}-${piece.id}`);assert.equal(item.status,'draft');assert.equal(item.variants.length,2);
    for(const v of item.variants){
      assert.equal(v.status,'generated');assert.ok(['feed','story'].includes(v.spec.placement));assert.ok(v.body.includes(piece.caption));
      const m=media.find((m:{id:string})=>`media:${m.id}`===v.image_path);assert.ok(m);assert.equal(m.alt,piece.alt);
      const response=await page.request.get(`http://127.0.0.1:3787/api/media/${m.id}/file`);assert.equal(response.status(),200);
      const bytes=await response.body();const expected=inventory.assets.find((a:{path:string})=>a.path===m.name);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256);
    }
    await page.getByRole('button',{name:new RegExp(`^${piece.category.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} ·`)}).click();
    const images=page.getByAltText(piece.alt,{exact:true});assert.equal(await images.count(),2);
    for(const image of await images.all())await image.evaluate((el:HTMLImageElement)=>el.decode());
    if(piece.id==='software')await page.screenshot({path:join(out,'software-drafts-desktop.png')});
  }
  await page.getByRole('tab',{name:/Medios \(10\)/}).click();
  await page.screenshot({path:join(out,'library-desktop.png')});
  await page.setViewportSize({width:390,height:900});
  await page.screenshot({path:join(out,'library-mobile.png')});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,'report.json'),JSON.stringify({campaign:campaign.id,items:5,variants:10,media:10,mediaHashes:true,scheduledCampaignSlots:0,approvedCampaignVariants:0,errors,overflow,limits:'Read-only CMS checks; no external publication, physical-device or full CMS accessibility certification.'},null,2));
  console.log(JSON.stringify({result:'PASS',items:5,variants:10,media:10,overflow,out},null,2));
}finally{await browser.close();}
