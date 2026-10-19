import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('generated checkout parses USD amounts, including decimals, instead of zero',()=>{
 const source=html.match(/function parsePriceUSD[\s\S]*?\n}/)?.[0];
 assert.ok(source);
 for(const [label,expected] of [['USD 40',40],['USD 20.50',20.5],['A cotizar',0]] as const) {
   assert.equal(runInNewContext(`${source}; parsePriceUSD(${JSON.stringify(label)})`),expected);
 }
});
test('published checkout never links to unsynchronized fixed-price payment URLs',()=>{
 assert.ok(!/href="https:\/\/mpago\.la\//.test(html));
 assert.ok(html.includes('catalogRevision'));
 const buttons=[...html.matchAll(/<a[^>]+class="[^"]*btn-checkout[^>]+>/g)];
 assert.ok(buttons.length>0);
 for(const [button] of buttons) assert.match(button,/data-slug="[a-z0-9-]+"/);
 assert.ok(!html.includes('data-slug="ia-docentes"'));
});
