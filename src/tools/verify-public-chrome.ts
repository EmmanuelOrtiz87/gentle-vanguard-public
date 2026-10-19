/** Public chrome contract: compare rendered corporate and Academy chrome, not just tokens. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readOnlyQA} from '../web-presence/read-only-qa.js';
const base=(process.argv[2]||'http://127.0.0.1:4188/').replace(/\/?$/,'/');
const out='.runtime/qa-public-chrome';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const cases=[];
try {
 for(const width of [320,390,768,1440])for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await readOnlyQA(context,base);
  await context.addInitScript(value=>localStorage.setItem('gv-cc-theme',value),theme);
  const readings=[];
  for(const [name,path] of [['corporate',''],['academy','academy/']]){
   const page=await context.newPage();await page.goto(base+path);await page.evaluate(()=>document.fonts.ready);
   await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} ${width}: no overflow`);
   const reading=await page.evaluate(`(()=>{
    const style=(selector,keys)=>{const element=document.querySelector(selector);const css=getComputedStyle(element);return Object.fromEntries(keys.map(key=>[key,css.getPropertyValue(key)]));};
    return {header:style('.gv-topbar',['background-color','backdrop-filter','border-bottom-color']),inner:style('.gv-topbar-inner',['width','min-height','padding-top','padding-bottom','gap']),brand:style('.gv-topbar .gv-brand-wordmark',['display','font-size','font-family','font-weight']),logo:style('.gv-topbar .gv-brand-logo',['width','height']),footer:style('.gv-footer',['width','padding-top','padding-bottom','background-color','border-top-color']),footerBrand:style('.gv-footer .gv-brand-wordmark',['font-size','font-family','color']),closing:style('.brand-closing p',['font-size','line-height','font-family','color']),themeIcon:document.querySelector('.gv-topbar .gv-icon-btn svg')?.innerHTML};
   })()`);readings.push(reading);
   if(theme==='dark'&&(width===390||width===1440)){
    await page.screenshot({path:`${out}/${name}-header-${width}.png`});
    await page.locator('.gv-footer').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${name}-footer-${width}.png`});
   }
  }
  assert.deepEqual(readings[1],readings[0],`${width}px ${theme}: same rendered public chrome`);
  cases.push({width,theme,equal:true});await context.close();
 }
 writeFileSync(`${out}/report.json`,JSON.stringify({base,cases},null,2));
 console.log('PASS shared public chrome: 4 widths × dark/light; header, wordmark, logo, theme icon, footer and closing typography.');
}finally{await browser.close();}
