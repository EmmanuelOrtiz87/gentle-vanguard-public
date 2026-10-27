/** Read-only UI regression: language changes preserve drafts; no OTP requests or profile writes. */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch();const out='.runtime/qa-phone-auth-design';mkdirSync(out,{recursive:true});
const results=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4787');await page.locator('#phoneForm').waitFor();
 await page.locator('#phone').fill('+5492640000000');
 for(const [locale,request,existing] of [['en','Request code','I already have a code'],['pt','Solicitar código','Já tenho um código'],['es','Solicitar código','Ya tengo un código']]){
  await page.locator('#language').selectOption(locale!);
  assert.equal(await page.locator('html').getAttribute('lang'),locale);
  assert.equal(await page.locator('#phone').inputValue(),'+5492640000000','Language preserves entered draft');
  assert.equal(await page.locator('#phoneForm button').innerText(),request);
  assert.equal(await page.locator('#existingCode').innerText(),existing);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone form reflows');
  await page.screenshot({path:`${out}/phone-${locale}.png`});results.push({locale,draftPreserved:true,phoneLabels:true,reflow:true});
 }
 await page.locator('#existingCode').click();await page.locator('#existingForm').waitFor();
 await page.locator('#existingPhone').fill('+5492640000000');await page.locator('#existingCodeInput').fill('000000');
 await page.locator('#language').selectOption('en');
 assert.equal(await page.locator('#existingForm button').innerText(),'Sign in with code');
 assert.equal(await page.locator('#existingCodeInput').inputValue(),'000000');
 await page.locator('#language').selectOption('es');
 assert.equal(await page.locator('#existingForm button').innerText(),'Ingresar con código');
 assert.deepEqual(errors,[]);
 writeFileSync(`${out}/report.json`,JSON.stringify({results,existingCodeDraftPreserved:true,errors,limits:'No OTP sent, no authentication, no profile changes; customer data and unknown server errors retain source language.'},null,2));
 console.log('PASS phone-auth: three UI languages, reversible translations, preserved phone/code drafts and mobile reflow; no outbound actions.');
}finally{await browser.close();}
