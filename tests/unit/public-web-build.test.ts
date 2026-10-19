import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPublicSite, publicFiles, PUBLIC_SITE } from '../../src/web-presence/build.js';
describe('unified public website boundary',()=>{
  it('exports corporate root and Academy with isolated install scope, without source/runtime files',()=>{
    const out=mkdtempSync(join(tmpdir(),'gv-public-'));
    buildPublicSite(resolve('.'),out);
    const files=publicFiles(out);
    expect(files).toContain('academy/index.html');
    expect(files).toContain('index.html');
    expect(files.some(f=>/\.ts$|start\.sh|stop\.sh|DESIGN-WAIVER|\.runtime|server\//.test(f))).toBe(false);
    const root=readFileSync(join(out,'index.html'),'utf8');
    expect(root).toContain(`rel="canonical" href="${PUBLIC_SITE}"`);
    expect(root).toContain('href="academy/"');
    expect(files).toContain('public-chrome.css');
    expect(root).toContain('data-public-surface="corporate"');
    expect(root).toContain('href="public-chrome.css"');
    const academy=readFileSync(join(out,'academy/index.html'),'utf8');
    expect(academy).toContain(`rel="canonical" href="${PUBLIC_SITE}academy/"`);
    expect(academy).toContain('href="/"');
    expect(academy).toContain('data-public-surface="academy"');
    expect(academy).toContain('href="../public-chrome.css"');
    expect(JSON.parse(readFileSync(join(out,'academy/manifest.webmanifest'),'utf8')).scope).toBe('/academy/');
  });
});
