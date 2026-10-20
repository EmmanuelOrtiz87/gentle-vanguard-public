/** Read-only rendered inventory. No messages, uploads, generation or business-data mutations. */
import {chromium} from 'playwright';
import {readRenderedTokens} from '../../packages/gv-design-system/src/cli/rendered-tokens.js';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const surfaces:Record<string,number>={'academy-web':4173,'academy-landing':4174,'academy-portal':4793,'academy-crm':4792,'alexandria':5180,'archify':5181,'client-phone-auth-sandbox':4787,'command-center':8094,'content-cms':5175,'corporate-web':4188,'design-hub':8095,'gv-agenda':4194,'gv-analytics':5174,'gv-knowledge-ops':4197,'gv-music':1420,'gv-wifikeys':4199,'prompt-studio':5178,'sandbox-gv':4000,'service-desk':4198,'voice-studio':5176,'web-dashboard':5173};
const css=readFileSync('packages/gv-design-system/dist/tokens.css','utf8');
const names=[...new Set(css.match(/--gv-[\w-]+(?=\s*:)/g))];
const out='.runtime/qa-native-design';mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const results:any[]=[];
try {
 const reference=await browser.newPage({reducedMotion:'reduce'});await reference.setContent('<html><body></body></html>');await reference.addStyleTag({content:css});
 const read=readRenderedTokens;
 for(const [app,port] of Object.entries(surfaces)) {
  const page=await browser.newPage({reducedMotion:'reduce'});const errors:string[]=[];
  page.on('pageerror',err=>errors.push(err.message));
  try {
   await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded',timeout:15000});
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(400);
   const cases=[];
   for(const theme of ['dark','light'])for(const width of [390,1440]) {
    await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.scrollBehavior='auto';},theme);
    await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
    await reference.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const expected=await reference.evaluate(read,names),actual=await page.evaluate(read,names);
    const drift=names.filter(n=>actual[n]!==expected[n]);
    const ui=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,bodyFont:getComputedStyle(document.body).fontFamily,headingFonts:[...new Set(Array.from(document.querySelectorAll('h1,h2,h3')).map(e=>getComputedStyle(e).fontFamily))],fonts:document.fonts.check('700 20px Poppins')&&document.fonts.check('400 16px Inter'),wordmark:document.querySelector('.gv-brand-wordmark,.brand-wordmark')?.textContent?.trim(),iconWidth:document.querySelector('.gv-brand-logo')?.getBoundingClientRect().width,title:document.title,lang:document.documentElement.lang}));
    await page.screenshot({path:`${out}/${app}-${theme}-${width}.png`});
    cases.push({theme,width,drift,...ui});
   }
   results.push({app,url:page.url(),cases,errors});
   console.log(`${app}: ${cases.filter(c=>!c.drift.length&&!c.overflow&&c.fonts).length}/4 token/font/reflow cases; errors=${errors.length}`);
  }catch(error){results.push({app,unavailable:String(error).split('\n')[0]});console.log(`${app}: unavailable`);}
  finally{await page.close();}
 }
 const passed=results.every(r=>r.cases?.length===4&&r.errors.length===0&&r.cases.every((c:any)=>!c.drift.length&&!c.overflow&&c.fonts));
 writeFileSync(`${out}/report.json`,JSON.stringify({passed,generatedAt:new Date().toISOString(),tokenCount:names.length,scope:'Rendered identity tokens, fonts and page reflow only. Screenshots require review. Does not certify every route, translation, contrast or business flow.',results},null,2));
 console.log(`${passed?'PASS':'FAIL'} ${results.length} surfaces / ${results.reduce((n,r)=>n+(r.cases?.length||0),0)} theme/viewport cases.`);
 if(!passed)process.exitCode=1;
}finally{await browser.close();}
