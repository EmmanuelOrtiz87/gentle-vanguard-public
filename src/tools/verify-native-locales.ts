/** Shared language preference smoke test. Does not prove translation of every sentence/route. */
import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const inventory=JSON.parse(readFileSync('.runtime/qa-native-design/report.json','utf8'));
const browser=await chromium.launch();const results=[];
try {
 for(const app of inventory.results) {
  const locales=[];
  for(const locale of ['es','en','pt']) {
   const context=await browser.newContext({reducedMotion:'reduce'});
   await context.addInitScript(l=>{localStorage.setItem('gv-cc-lang',l);localStorage.setItem('gv-cc-theme','dark');},locale);
   const page=await context.newPage();
   try {
    await page.goto(app.url,{waitUntil:'domcontentloaded',timeout:15000});
    await page.waitForTimeout(350);
    const actual=await page.locator('html').getAttribute('lang');
    const text=await page.locator('body').innerText();
    locales.push({requested:locale,actual,preferenceApplied:actual?.split('-')[0]===locale,visibleTextSha256:createHash('sha256').update(text).digest('hex')});
   }catch(error){locales.push({requested:locale,error:String(error).split('\n')[0]});}
   finally{await context.close();}
  }
  const waiver=app.app==='academy-landing';
  results.push({app:app.app,waiver:waiver?'Spanish conversion page, DESIGN-WAIVER.md':undefined,locales});
  console.log(`${app.app}: ${locales.filter(l=>'preferenceApplied' in l&&l.preferenceApplied).length}/3 shared preferences${waiver?' (Spanish-only waiver)':''}`);
 }
 writeFileSync('.runtime/qa-native-design/locales.json',JSON.stringify({scope:'Startup language preference and rendered text changes only; not complete content translation.',results},null,2));
}finally{await browser.close();}
