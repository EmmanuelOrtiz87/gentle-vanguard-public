/** Regression: translated documents must not resurrect obsolete hero metrics or carousels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser=await chromium.launch();
const out='.runtime/qa-presentations-review';mkdirSync(out,{recursive:true});
const results=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  for(const lang of ['es','en','pt-BR']) {
    await page.goto(`http://127.0.0.1:4195/docs/presentations/index.html?lang=${lang}`);
    await page.evaluate(()=>document.fonts.ready);
    const hero=await page.locator('#overview').innerText();
    assert.ok(!/96\s*\/\s*96|Health PASS|100%|92\s*Skills|v4\.0/i.test(hero),`${lang}: stale hero metrics`);
    assert.ok(hero.includes('254')&&hero.includes('4.2.0'),`${lang}: current inventory`);
    const layout=await page.locator('#overview').evaluate(el=>({title:el.querySelector('h1')!.getBoundingClientRect().bottom,lead:el.querySelector('.lead')!.getBoundingClientRect().top}));
    assert.ok(layout.lead>=layout.title,`${lang}: hero reads vertically without squeezed columns`);
    const footer=await page.locator('footer').innerText();
    assert.ok(footer.includes('GentleVanguard')&&!/v4\.0|100%/.test(footer),`${lang}: footer identity/version`);
    assert.equal(await page.locator('.gv-carousel,[data-autoplay],script[src*="carousel.js"]').count(),0);
    await page.screenshot({path:`${out}/index-${lang}.png`});
    results.push({lang,currentHero:true,footer:true,noCarousel:true});
  }
  writeFileSync(`${out}/report.json`,JSON.stringify(results,null,2));
  console.log('PASS presentation review: ES/EN/PT current hero, footer and no active carousel.');
}finally {await browser.close();}
