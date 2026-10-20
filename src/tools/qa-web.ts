/** Native, repeatable browser/axe gate. Never sends forms or installs a browser silently. */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { AxeResults } from 'axe-core';

declare global { interface Window { axe: {run: (context:Document,options:unknown)=>Promise<AxeResults>}; qaVitals:{lcp:number;cls:number}; } }
const args=process.argv.slice(2);
const option=(name:string,fallback:string)=>args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const url=option('--url','');
if(!/^https?:\/\//.test(url)) throw new Error('Usage: npm run qa:web -- --url URL [--browsers chromium,firefox,webkit] [--out PATH] [--slow]');
const output=resolve(option('--out',`.runtime/qa-web/${Date.now()}`));
mkdirSync(output,{recursive:true});
const types={chromium,firefox,webkit};
const selected=option('--browsers','chromium,firefox,webkit').split(',') as (keyof typeof types)[];
if(selected.some(name=>!types[name])) throw new Error('Unknown browser');
const axePath=createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const failures:string[]=[];
const results:unknown[]=[];
for(const name of selected){
  const browser=await types[name].launch({headless:true});
  try{
    for(const theme of ['dark','light']){
      const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme as 'dark'|'light',reducedMotion:'reduce',hasTouch:true});
      await context.addInitScript(theme=>localStorage.setItem('gv-cc-theme',theme),theme);
      const page=await context.newPage();
      page.on('pageerror',error=>failures.push(`${name}/${theme}: ${error.message}`));
      page.on('response',response=>{if(response.status()>=400)failures.push(`${name}: HTTP ${response.status()} ${response.url()}`);});
      await page.goto(url,{waitUntil:'networkidle'});
      await page.evaluate(()=>document.fonts.ready);
      await page.addScriptTag({path:axePath});
      const languages=await page.locator('#language option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
      for(const width of [320,390,768,1440]){
        await page.setViewportSize({width,height:900});
        for(const lang of languages.length ? languages : ['default']){
          if(lang!=='default')await page.selectOption('#language',lang);
          // Sample settled states, like Playwright screenshots with animations disabled.
          // Firefox can retain near-zero reduced-motion transitions at time 0 in headless mode.
          await page.evaluate(()=>document.getAnimations().forEach(a=>{if(a instanceof CSSTransition)a.finish();}));
          const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,lang:document.documentElement.lang}));
          if(layout.overflow)failures.push(`${name}/${theme}/${width}/${lang}: horizontal overflow`);
          if(lang!=='default'&&layout.lang!==lang)failures.push(`${name}: language did not change to ${lang}`);
          let accessibility:unknown;
          if(lang===(languages[0]||'default')){
            const scan=await page.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']},resultTypes:['violations','incomplete']}));
            accessibility={violations:scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:scan.incomplete.map(v=>({id:v.id,nodes:v.nodes.length}))};
            for(const violation of scan.violations)failures.push(`${name}/${theme}/${width}: ${violation.id} (${violation.nodes.length} nodes)`);
            if(width===390||width===1440)await page.screenshot({path:resolve(output,`${name}-${theme}-${width}.png`),animations:'disabled'});
          }
          results.push({browser:name,theme,width,languageSelection:lang,...layout,accessibility});
        }
      }
      await context.close();
    }
    if(name==='chromium'&&args.includes('--slow')){
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:128*1024,uploadThroughput:64*1024});
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await page.addInitScript(()=>{
        window.qaVitals={lcp:0,cls:0};
        new PerformanceObserver(list=>{for(const entry of list.getEntries())window.qaVitals.lcp=entry.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
        new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!(entry as PerformanceEntry & {hadRecentInput:boolean}).hadRecentInput)window.qaVitals.cls+=(entry as PerformanceEntry & {value:number}).value;}).observe({type:'layout-shift',buffered:true});
      });
      await page.goto(url,{waitUntil:'networkidle'});
      results.push({syntheticMobile:true,latencyMs:150,downloadKiBps:128,cpuSlowdown:4,...await page.evaluate(()=>({vitals:window.qaVitals,loadMs:(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).loadEventEnd}))});
      await page.close();
    }
  }finally{await browser.close();}
}
writeFileSync(resolve(output,'report.json'),JSON.stringify({url,results,failures,limitations:'Browser engines and synthetic network, not physical devices or a complete WCAG certification.'},null,2));
console.log(JSON.stringify({output,cases:results.length,failures},null,2));
if(failures.length)process.exitCode=1;
