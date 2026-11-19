/** Native, repeatable browser/axe gate. Never sends forms or installs a browser silently. */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { AxeResults } from 'axe-core';
import type { Page } from 'playwright';

declare global {
  interface Window {
    axe: { run: (context: Document, options: unknown) => Promise<AxeResults> };
    qaVitals: { lcp: number; cls: number };
  }
}
const args = process.argv.slice(2);
const option = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const url = option('--url', '');
if (!/^https?:\/\//.test(url))
  throw new Error(
    'Usage: npm run qa:web -- --url URL [--browsers chromium,firefox,webkit] [--out PATH] [--slow] [--live] [--wiring-baseline PATH] [--wiring-check PATH]',
  );
const output = resolve(option('--out', `.runtime/qa-web/${Date.now()}`));
mkdirSync(output, { recursive: true });
const types = { chromium, firefox, webkit };
const selected = option('--browsers', 'chromium,firefox,webkit').split(
  ',',
) as (keyof typeof types)[];
if (selected.some((name) => !types[name])) throw new Error('Unknown browser');
// --live: apps con polling en vivo o CSP dura — navega con load+settle y bypassCSP.
// Sin --live, un networkidle que no se asienta hace fallback automático al modo live.
const live = args.includes('--live');
const limitations: string[] = [];
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const failures: string[] = [];
const results: unknown[] = [];
// Wiring baseline (hallmark --before/--kept, absorbido 2026-11-18): graba el cableado
// interactivo de la página (links, fields, botones, headings) antes de un rediseño y
// verifica que sobrevive después — el visual baseline cubre píxeles, esto cubre cableado.
const wiringBaseline = option('--wiring-baseline', '');
const wiringCheck = option('--wiring-check', '');
interface WiringCapture {
  url: string;
  headings: Array<{ level: string; text: string }>;
  links: Array<{ href: string; text: string }>;
  fields: Array<{ tag: string; type: string; name: string; id: string; placeholder: string }>;
  buttons: Array<{ text: string; testid: string }>;
}
async function gotoSettled(page: {
  goto: (u: string, o: Record<string, unknown>) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
}): Promise<void> {
  if (live) {
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForTimeout(3_000);
    return;
  }
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch {
    limitations.push(
      `networkidle no se asentó en ${url}; fallback a load+settle (app con polling en vivo)`,
    );
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForTimeout(3_000);
  }
}
async function captureWiring(page: Page): Promise<WiringCapture> {
  // Sin funciones ligadas a const dentro del evaluate: tsx/esbuild las envuelve con el
  // helper __name, que no existe dentro del sandbox del navegador (regresión medida).
  return page.evaluate((): WiringCapture => ({
    url: location.href,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => ({
      level: h.tagName.toLowerCase(),
      text: ((h as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    })),
    links: Array.from(document.querySelectorAll('a[href]')).map((a) => ({
      href: (a as HTMLAnchorElement).getAttribute('href') || '',
      text: ((a as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    })),
    fields: Array.from(document.querySelectorAll('input,select,textarea')).map((f) => ({
      tag: f.tagName.toLowerCase(),
      type: (f as HTMLInputElement).type || '',
      name: (f as HTMLInputElement).name || '',
      id: f.id || '',
      placeholder: (f as HTMLInputElement).placeholder || '',
    })),
    buttons: Array.from(document.querySelectorAll('button,[role="button"]')).map((b) => ({
      text: ((b as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      testid: (b as HTMLElement).dataset.testid || '',
    })),
  }));
}
const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const linkKey = (link: { href: string; text: string }) =>
  link.href && link.href !== '#' ? `href:${link.href}` : `text:${norm(link.text)}`;
const fieldKey = (field: {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
}) => field.name || field.id || `${field.tag}:${field.type}:${norm(field.placeholder)}`;
const buttonKey = (button: { text: string; testid: string }) =>
  button.testid || `text:${norm(button.text)}`;
const headingKey = (heading: { level: string; text: string }) =>
  `${heading.level}:${norm(heading.text)}`;
function diffBy<T>(
  base: T[],
  current: T[],
  key: (item: T) => string,
): { removed: T[]; added: T[] } {
  const baseKeys = new Set(base.map(key));
  const currentKeys = new Set(current.map(key));
  return {
    removed: base.filter((item) => !currentKeys.has(key(item))),
    added: current.filter((item) => !baseKeys.has(key(item))),
  };
}
if (wiringBaseline || wiringCheck) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    await context.addInitScript((theme) => localStorage.setItem('gv-cc-theme', theme), 'dark');
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await gotoSettled(page);
    await page.evaluate(() => document.fonts.ready);
    const wiring = await captureWiring(page);
    if (wiringBaseline) {
      writeFileSync(
        resolve(wiringBaseline),
        JSON.stringify({ capturedAt: new Date().toISOString(), ...wiring }, null, 2),
      );
      console.log(
        JSON.stringify(
          {
            baseline: resolve(wiringBaseline),
            url: wiring.url,
            links: wiring.links.length,
            fields: wiring.fields.length,
            buttons: wiring.buttons.length,
            headings: wiring.headings.length,
          },
          null,
          2,
        ),
      );
    } else {
      const base = JSON.parse(readFileSync(resolve(wiringCheck), 'utf-8')) as WiringCapture;
      const links = diffBy(base.links, wiring.links, linkKey);
      const fields = diffBy(base.fields, wiring.fields, fieldKey);
      const buttons = diffBy(base.buttons, wiring.buttons, buttonKey);
      const headings = diffBy(base.headings, wiring.headings, headingKey);
      // El gate cubre cableado interactivo (links/fields/botones); los headings son estructura
      // de contenido que un rediseño puede cambiar legítimamente → advertencia, no fallo.
      for (const link of links.removed)
        failures.push(`link eliminado: ${linkKey(link)} (${link.text || 'sin texto'})`);
      for (const field of fields.removed) failures.push(`field eliminado: ${fieldKey(field)}`);
      for (const button of buttons.removed) failures.push(`botón eliminado: ${buttonKey(button)}`);
      if (failures.length) process.exitCode = 1;
      const report = {
        baseline: resolve(wiringCheck),
        currentUrl: wiring.url,
        urlMismatch: base.url !== wiring.url,
        removed: { links: links.removed, fields: fields.removed, buttons: buttons.removed },
        added: { links: links.added, fields: fields.added, buttons: buttons.added },
        headingsRemoved: headings.removed,
        headingsAdded: headings.added,
        failures,
        note: 'Links/fields/botones eliminados son fallos; headings eliminados son advertencia.',
      };
      writeFileSync(resolve(output, 'wiring-check.json'), JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify(
          {
            report: resolve(output, 'wiring-check.json'),
            removed: {
              links: links.removed.length,
              fields: fields.removed.length,
              buttons: buttons.removed.length,
            },
            added: {
              links: links.added.length,
              fields: fields.added.length,
              buttons: buttons.added.length,
            },
            headingsRemoved: headings.removed.length,
            failures,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await browser.close();
  }
  process.exit(process.exitCode ?? 0);
}
for (const name of selected) {
  const browser = await types[name].launch({ headless: true });
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: theme as 'dark' | 'light',
        reducedMotion: 'reduce',
        hasTouch: true,
        bypassCSP: live,
      });
      await context.addInitScript((theme) => localStorage.setItem('gv-cc-theme', theme), theme);
      const page = await context.newPage();
      page.on('pageerror', (error) => failures.push(`${name}/${theme}: ${error.message}`));
      page.on('response', (response) => {
        if (response.status() >= 400)
          failures.push(`${name}: HTTP ${response.status()} ${response.url()}`);
      });
      await gotoSettled(page);
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ path: axePath });
      const languages = await page
        .locator('#language option')
        .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const lang of languages.length ? languages : ['default']) {
          if (lang !== 'default') await page.selectOption('#language', lang);
          // Sample settled states, like Playwright screenshots with animations disabled.
          // Firefox can retain near-zero reduced-motion transitions at time 0 in headless mode.
          await page.evaluate(() =>
            document.getAnimations().forEach((a) => {
              if (a instanceof CSSTransition) a.finish();
            }),
          );
          const layout = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth,
            lang: document.documentElement.lang,
          }));
          if (layout.overflow)
            failures.push(`${name}/${theme}/${width}/${lang}: horizontal overflow`);
          if (lang !== 'default' && layout.lang !== lang)
            failures.push(`${name}: language did not change to ${lang}`);
          let accessibility: unknown;
          if (lang === (languages[0] || 'default')) {
            const scan = await page.evaluate(() =>
              window.axe.run(document, {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
                resultTypes: ['violations', 'incomplete'],
              }),
            );
            accessibility = {
              violations: scan.violations.map((v) => ({
                id: v.id,
                nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
              })),
              incomplete: scan.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })),
            };
            for (const violation of scan.violations)
              failures.push(
                `${name}/${theme}/${width}: ${violation.id} (${violation.nodes.length} nodes)`,
              );
            if (width === 390 || width === 1440)
              await page.screenshot({
                path: resolve(output, `${name}-${theme}-${width}.png`),
                animations: 'disabled',
              });
          }
          results.push({
            browser: name,
            theme,
            width,
            languageSelection: lang,
            ...layout,
            accessibility,
          });
        }
      }
      await context.close();
    }
    if (name === 'chromium' && args.includes('--slow')) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 128 * 1024,
        uploadThroughput: 64 * 1024,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        window.qaVitals = { lcp: 0, cls: 0 };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.qaVitals.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput)
              window.qaVitals.cls += (entry as PerformanceEntry & { value: number }).value;
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(url, { waitUntil: live ? 'load' : 'networkidle', timeout: 45_000 });
      if (live) await page.waitForTimeout(3_000);
      results.push({
        syntheticMobile: true,
        latencyMs: 150,
        downloadKiBps: 128,
        cpuSlowdown: 4,
        ...(await page.evaluate(() => ({
          vitals: window.qaVitals,
          loadMs: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
            .loadEventEnd,
        }))),
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
writeFileSync(
  resolve(output, 'report.json'),
  JSON.stringify(
    {
      url,
      live,
      limitations: limitations.length ? limitations : undefined,
      results,
      failures,
      limitations_note:
        'Browser engines and synthetic network, not physical devices or a complete WCAG certification.',
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, cases: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
