/** Catalog UX regression, against the unified local/public route; never submits a payment. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readOnlyQA} from '../web-presence/read-only-qa.js';
const require=createRequire(import.meta.url);
const base=process.argv[2]||'http://127.0.0.1:4188/academy/';
const out='.runtime/qa-academy-catalog';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const cases=[];
try{
 const page=await browser.newPage({reducedMotion:'reduce'});const errors:string[]=[];
 await readOnlyQA(page.context(),base);
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))errors.push(r.status()+' '+r.url());});
 for(const width of [390,768,1024,1440,1920]){
  await page.setViewportSize({width,height:width>=1024?1200:1000});await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.academy-topbar a[href="/"].gv-btn').count(),1,'Corporate return is a real branded button');
  assert.equal(await page.locator('[data-catalog-section]').count(),0,'No secondary price-to-filter navigation');
  assert.equal(await page.locator('#sec-destacados .grid>.card').count(),86,'All materials are reachable from the default category');
  assert.ok(await page.locator('.academy-hero-art img').evaluate(el=>(el as HTMLImageElement).naturalWidth>0),'Learning illustration loads');
  if(width===390){await page.locator('#academy-menu').click();assert.equal(await page.locator('#academy-menu').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('#academy-menu').getAttribute('aria-expanded'),'false');}
  await page.locator('[data-sec="sec-cursos"]').click();
  const section=page.locator('#sec-cursos'),cards=section.locator('.grid>.card:visible');
  const columns=width<600?1:width<900?2:width<1200?3:4,initial=columns===1?3:columns*2;
  assert.equal(await cards.count(),initial,`${width}: complete initial rows`);
  const geometry=await section.locator('.grid').evaluate(el=>({width:el.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.ok(!geometry.overflow,`${width}: no document overflow`);
  if(width===1440)assert.ok(geometry.width>1250,'Catalog occupies available desktop width');
  const heights=await cards.evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));assert.ok(Math.max(...heights)<800,`${width}: compact cards`);
  assert.equal(await cards.first().locator('.card-price strong').innerText(),'USD 50');
  const total=await section.locator('.grid>.card').count();
  const firstTitle=await cards.first().locator('h3').innerText();
  await section.locator('.catalog-next').click();
  assert.equal(await cards.count(),Math.min(initial,total-initial),'Pagination replaces the previous page instead of accumulating cards');
  assert.notEqual(await cards.first().locator('h3').innerText(),firstTitle);
  assert.equal(await section.locator('[aria-current="page"]').innerText(),'2');
  const last=Math.ceil(total/initial);
  await section.locator(`[data-page="${last}"]`).click();assert.equal(await cards.count(),total-(last-1)*initial);assert.ok(await section.locator('.catalog-next').isDisabled());
  await section.locator('[data-page="1"]').click();assert.equal(await cards.count(),initial);assert.ok(await section.locator('.catalog-prev').isDisabled());
  const summary=cards.first().locator('.product-details summary');await summary.click();
  const dialog=page.locator('.product-dialog');await dialog.waitFor({state:'visible'});
  assert.ok((await dialog.locator('.details-body').innerText()).length>100);
  assert.equal(await dialog.locator('.card-price strong').innerText(),'USD 50');
  await page.keyboard.press('Escape');assert.ok(!await dialog.isVisible());assert.ok(await summary.evaluate(el=>el===document.activeElement));
  await summary.click();await dialog.locator('.btn-checkout').click();await page.locator('#checkout-overlay').waitFor({state:'visible'});await page.locator('#checkout-cancel').click();
  await page.locator('#filter-q').fill('zzzxnonexistent');await page.waitForTimeout(250);assert.equal(await page.locator('.product-section.active .card:visible').count(),0);assert.ok(await page.locator('.catalog-empty').isVisible());
  await page.locator('#filter-clear').click();assert.equal(await page.locator('#filter-q').inputValue(),'');assert.equal(await page.locator('.tab.active').getAttribute('data-sec'),'sec-destacados');assert.ok((await page.locator('#catalog-state').innerText()).includes('86'));
  await page.locator('#filter-q').fill('python');await page.waitForTimeout(250);assert.ok(await page.locator('.product-section.active .card:visible').count()>0);assert.equal(await page.locator('.product-section.active').count(),1);
  await page.locator('[data-sec="sec-destacados"]').click();assert.equal(await page.locator('#filter-q').inputValue(),'');assert.ok((await page.locator('#catalog-state').innerText()).includes('86'));
  await page.locator('#filter-clear').click();await page.locator('[data-sec="sec-cursos"]').click();
  await page.evaluate(()=>localStorage.removeItem('gv-landing-cart'));await page.reload();await page.locator('[data-sec="sec-cursos"]').click();await page.mouse.move(0,0);
  await section.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/courses-${width}.png`});
  await page.locator('[data-sec="sec-destacados"]').click();await page.locator('#sec-destacados').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/featured-${width}.png`});
  await page.locator('#planes').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:`${out}/plans-${width}.png`});
  await page.locator('#alcance').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:`${out}/scope-${width}.png`});
  assert.equal(await page.locator('#planes .price-card').count(),0);
  assert.ok(!/A cotizar/i.test(await page.locator('#planes').innerText()));
  assert.ok(await page.locator('#alcance').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));
  await page.locator('.education-scope summary').click();assert.ok((await page.locator('.education-scope').innerText()).includes('60 prompts'));await page.locator('.education-scope summary').click();
  await page.locator('.guided-offer .btn-interest').click();assert.ok((await page.locator('#interest-text').innerText()).includes('Definir acompañamiento'));
  if(width===1440){await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const contrast=await page.evaluate(async()=>{const result=await (window as any).axe.run(document,{runOnly:['color-contrast']});return result.violations.map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>n.target)}));});assert.deepEqual(contrast,[],'Dark theme contrast');}
  await page.locator('#academy-theme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  if(width===1440){const contrast=await page.evaluate(async()=>{const result=await (window as any).axe.run(document,{runOnly:['color-contrast']});return result.violations.map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>n.target)}));});assert.deepEqual(contrast,[],'Light theme contrast');}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${out}/light-${width}.png`});await page.locator('#academy-theme').click();
  await page.goto(base);await page.screenshot({path:`${out}/hero-${width}.png`});
  if(width===390||width===1440){await page.locator('.academy-footer').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/footer-${width}.png`});}
  cases.push({width,columns,initial,cardHeight:Math.max(...heights),pagination:true,fullDetails:true,modalToCheckout:true,filter:true,keyboard:true});
 }
 // Decorative motion must be controllable and suspend outside its focal stage.
 const motionPage=await browser.newPage({reducedMotion:'no-preference',viewport:{width:1440,height:1000}});
 await readOnlyQA(motionPage.context(),base);
 await motionPage.goto(base);
 await motionPage.waitForFunction(()=>document.documentElement.dataset.academyMotion==='playing');
 assert.equal(await motionPage.locator('.knowledge-flow').first().evaluate(el=>getComputedStyle(el).animationPlayState),'running');
 await motionPage.locator('#academy-motion').click();
 assert.equal(await motionPage.locator('html').getAttribute('data-academy-motion'),'paused');
 assert.equal(await motionPage.locator('.knowledge-flow').first().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
 await motionPage.locator('#academy-motion').click();
 await motionPage.locator('#alcance').scrollIntoViewIfNeeded();
 await motionPage.waitForFunction(()=>document.documentElement.dataset.academyMotion==='suspended');
 await motionPage.emulateMedia({reducedMotion:'reduce'});
 await motionPage.waitForFunction(()=>(document.querySelector('#academy-motion') as HTMLButtonElement).disabled);
 assert.ok(await motionPage.locator('#academy-motion').isDisabled());
 assert.equal(await motionPage.locator('.academy-knowledge-paths').evaluate(el=>getComputedStyle(el).display),'none');
 await motionPage.close();
 const fallback=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:1000}});
 await readOnlyQA(fallback.context(),base);
 await fallback.goto(base);const detail=fallback.locator('#sec-destacados .product-details').first();await detail.locator('summary').click();assert.ok(await detail.evaluate(el=>el.hasAttribute('open')));assert.ok((await detail.locator('.details-body').innerText()).length>100);await fallback.close();
 assert.deepEqual(errors,[]);writeFileSync(`${out}/report.json`,JSON.stringify({base,cases,errors,motion:{pause:true,offscreenSuspension:true,reducedMotionChange:true},noJavaScriptReading:true,paymentSubmitted:false},null,2));console.log(`PASS catalog: ${cases.length} widths, row-aware pagination, details/focus, price, checkout preview, filters, motion pause/suspension, reduced motion and native reading fallback.`);
}finally{await browser.close();}
