/** Browser checks for the real public navigation and purchase UI; never submits a sale. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {readOnlyQA} from '../web-presence/read-only-qa.js';
const base=process.argv[2]||'http://127.0.0.1:4188/';
const out='.runtime/qa-unified-public-web';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
try{
 const page=await browser.newPage({reducedMotion:'reduce'});
 await readOnlyQA(page.context(),base);
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:1000});
  await page.goto(base);
  await page.locator('a[data-i18n="academyDemo"]').click();
  await page.waitForURL('**/academy/');
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://gentlevanguard.github.io/academy/');
  const links=await page.locator('a[href]').evaluateAll(els=>els.map(e=>e.getAttribute('href')!).filter(h=>!h.startsWith('#')&&!/^[a-z][a-z0-9+.-]*:/i.test(h)));
  for(const href of [...new Set(links)])assert.ok((await page.request.get(new URL(href,page.url()).href)).ok(),href);
  await page.locator('.btn-checkout').first().click();
  await page.locator('#checkout-overlay').waitFor({state:'visible'});
  assert.ok(await page.locator('#checkout-product').innerText());
  await page.locator('#checkout-cancel').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${out}/academy-${width}.png`});
  await page.locator('.academy-company[href="/"]').click();
  await page.waitForURL(base);
  await page.screenshot({path:`${out}/corporate-${width}.png`});
  results.push({width,navigation:true,relativeLinks:true,checkoutModal:true});
 }
 assert.deepEqual(errors,[]);
 await page.goto(base+'#sec-cursos');await page.waitForURL('**/academy/#sec-cursos');
 writeFileSync(`${out}/report.json`,JSON.stringify({base,results,legacyAnchorRedirect:true,errors,paymentSubmitted:false},null,2));
 console.log('PASS corporate ↔ Academy, relative assets/downloads, checkout open/cancel, mobile reflow and legacy links; no payment submitted.');
}finally{await browser.close();}
