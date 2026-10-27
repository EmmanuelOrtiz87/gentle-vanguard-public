/** Browser checks for the generated documentation and its six updated entry points. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const out=join(root,'.runtime/qa-docs-presence');mkdirSync(out,{recursive:true});
const server=spawn(process.execPath,[join(root,'tools/serve-static.mjs'),'4195',root,'--no-store'],{stdio:'ignore',windowsHide:true});
const browser=await chromium.launch();
const errors:string[]=[];
const cases:unknown[]=[];
let activePage='';
try {
  const page=await browser.newPage({reducedMotion:'reduce'});
  let ready=false;
  for(let attempt=0;attempt<20;attempt++){try{await page.goto('http://127.0.0.1:4195/docs/presentations/public-presence.html');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready,'Local documentation server started');
  page.on('pageerror',error=>errors.push(`${activePage}: ${error.stack?.split('\n').slice(0,3).join(' ') || error.message}`));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${activePage}: ${response.status()} ${response.url()}`);});
  const reference=await browser.newPage({reducedMotion:'reduce'});
  await reference.goto('http://127.0.0.1:4195/docs/presentations/public-presence.html');
  const register=JSON.parse(readFileSync(join(root,'docs/presentations/presentation-register.json'),'utf8')) as {pages:{page:string}[]};
  const entryPoints=new Set(['index.html','marketing.html','commands.html','patterns-conventions.html','resources-index.html','social-post.html']);
  for(const {page:name} of register.pages) {
    for(const width of [390,1440])for(const theme of ['dark','light']){
      await page.setViewportSize({width,height:1000});
      activePage=name;
      await page.goto(`http://127.0.0.1:4195/docs/presentations/${name}`);
      await page.evaluate(async theme=>{document.documentElement.dataset.theme=theme;await document.fonts.ready;},theme);
      await reference.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      const names=[...new Set([...readFileSync(join(root,'packages/gv-design-system/dist/tokens.css'),'utf8').matchAll(/(--gv-[\w-]+)\s*:/g)].map(m=>m[1]!))];
      const actual=await page.evaluate(names=>Object.fromEntries(names.map(n=>[n,getComputedStyle(document.documentElement).getPropertyValue(n).trim()])),names);
      const expected=await reference.evaluate(names=>Object.fromEntries(names.map(n=>[n,getComputedStyle(document.documentElement).getPropertyValue(n).trim()])),names);
      assert.deepEqual(actual,expected,`${name}/${theme}: canonical rendered properties`);
      assert.ok(await page.evaluate(()=>document.fonts.check('700 20px Poppins')&&document.fonts.check('400 16px Inter')));
      if(name==='public-presence.html'){
        assert.ok(await page.locator('main').innerText().then(text=>text.includes('REVIEW')&&text.includes('DRAFT')&&text.includes('4.2.0')));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Generated reading page reflows');
        const missing=await page.locator('main a[href]').evaluateAll(links=>links.map(el=>el.getAttribute('href')!).filter(href=>!/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)));
        for(const link of missing){const response=await page.request.get(new URL(link,page.url()).href);assert.equal(response.status(),200,link);}
        await page.screenshot({path:join(out,`presence-${theme}-${width}.png`)});
      }else{
        assert.equal(await page.locator('aside a[href="public-presence.html"]').count(),0,`${name}: no editorial banner`);
        if(entryPoints.has(name))assert.equal(await page.locator('#public-presence-update a[href="public-presence.html"]').count(),1,`${name}: status link`);
        if(name==='index.html')await page.locator('#public-presence-update').screenshot({path:join(out,`index-update-${theme}-${width}.png`)});
      }
      assert.equal(await page.locator('.gv-topbar').count(),1,`${name}: shared header`);
      assert.equal(await page.locator('#theme-toggle').count(),1);
      assert.equal(await page.locator('.lang-seg button').count(),3);
      assert.equal(await page.locator('.gv-document-footer').count(),1);
      assert.equal(await page.locator('.gv-carousel,[data-autoplay],script[src*="carousel.js"]').count(),0);
      if(name==='contract-viewer.html'&&width===390)assert.ok(await page.locator('.content-area').evaluate(el=>el.getBoundingClientRect().width>=340),'Contract reading pane must retain mobile reading width');
      if(name==='resources-index.html'&&width===390){await page.locator('.gv-doc-section-menu').click();assert.equal(await page.locator('.gv-doc-section-menu').getAttribute('aria-expanded'),'true');await page.locator('.gv-doc-section-menu').click();}
      await page.screenshot({path:join(out,`${name.replace('.html','')}-${theme}-${width}.png`)});
      cases.push({page:name,width,theme,canonicalTokens:names.length,fonts:true,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
    }
  }
  writeFileSync(join(out,'diagnostics.json'),JSON.stringify({cases,errors},null,2));
  assert.deepEqual(errors,[]);
  assert.ok(cases.every(c=>!(c as {overflow:boolean}).overflow),'Registered presentation pages reflow without document overflow');
  writeFileSync(join(out,'report.json'),JSON.stringify({cases,errors,limits:'Shared shell, tokens/fonts, desktop/mobile reflow, no editorial banners/carousels. Does not certify every historical diagram, translation or studio export.'},null,2));
  console.log(`PASS documentation: ${cases.length} page/viewport/theme cases; canonical tokens, loaded fonts, links and generated-page reflow.`);
}finally{await browser.close();server.kill();}
