import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readRenderedTokens} from '../../packages/gv-design-system/src/cli/rendered-tokens.js';
test('rendered comparison normalizes minified CSS, ignores probe transitions and still detects real drift',async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.setContent('<style>*{transition:color 10s}body{color:#fff}:root{--gv-cyan:#06B6D4;--gv-font-body:\'Inter\',sans-serif;--gv-duration-fast:180ms;--gv-elev-sm:0 1px 2px rgba(0,0,0,.4)}</style>');
  const names=['--gv-cyan','--gv-font-body','--gv-duration-fast','--gv-elev-sm'];
  const before=await page.evaluate(readRenderedTokens,names);
  assert.equal(before['--gv-cyan'],'rgb(6, 182, 212)');
  await page.addStyleTag({content:':root{--gv-font-body:"Inter",sans-serif;--gv-duration-fast:.18s;--gv-elev-sm:0 1px 2px #0006}'});
  assert.deepEqual(await page.evaluate(readRenderedTokens,names),before);
  await page.addStyleTag({content:':root{--gv-cyan:#00BFFF}'});
  assert.notEqual((await page.evaluate(readRenderedTokens,names))['--gv-cyan'],before['--gv-cyan']);
 }finally{await browser.close();}
});
