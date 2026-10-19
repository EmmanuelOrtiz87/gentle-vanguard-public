#!/usr/bin/env node
/**
 * shell-visual-verify — verificación visual NATIVA de la homologación GV.
 *
 * Recorre las apps homologadas EN VIVO (chromium headless vía librería
 * playwright — sin CLI, sin sesiones persistentes, sin ventanas) y verifica
 * el contrato de identidad del shell compartido:
 *   1. topbar presente
 *   2. wordmark "Gentle" blanco (color opaco, NO transparente/gradiente)
 *   3. span "Vanguard" con gradiente (background-clip:text)
 *   4. botón idioma 文A a 13px
 *
 * Uso:      npm run shell:verify
 * Exit 0 = todas las apps homologadas · Exit 1 = algún FAIL (detalle en tabla).
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';

interface AppTarget {
  name: string;
  url: string;
  /**
   * full-contract: usa el shell GV compartido (topbar + wordmark + dropdown idioma).
   * keys-only: topbar custom (Tailwind/propio) — solo comparte claves gv-cc-*;
   * se verifica que carga y tiene control de idioma en algún lugar.
   */
  contract: 'full' | 'keys-only' | 'waiver';
}

const APPS: AppTarget[] = [
  { name: 'academy-web', url: 'http://127.0.0.1:4173', contract: 'full' },
  // Public conversion surface: its explicit DESIGN-WAIVER permits a custom
  // landing structure while retaining canonical tokens, fonts and brand assets.
  { name: 'academy-landing', url: 'http://127.0.0.1:4174', contract: 'waiver' },
  { name: 'content-cms', url: 'http://127.0.0.1:5175', contract: 'full' },
  { name: 'academy-crm', url: 'http://127.0.0.1:4792', contract: 'full' },
  { name: 'archify', url: 'http://127.0.0.1:5181', contract: 'full' },
  { name: 'web-dashboard', url: 'http://127.0.0.1:5173', contract: 'keys-only' },
  { name: 'gv-analytics', url: 'http://127.0.0.1:5174', contract: 'keys-only' },
  { name: 'alexandria', url: 'http://127.0.0.1:5180', contract: 'keys-only' },
  { name: 'prompt-studio', url: 'http://127.0.0.1:5178', contract: 'full' },
  { name: 'design-hub', url: 'http://127.0.0.1:8095', contract: 'full' },
  { name: 'command-center', url: 'http://127.0.0.1:8092', contract: 'full' },
];

const PROBE_FULL = `(() => {
  const wm = document.querySelector('.gv-brand-wordmark, .gv-wordmark, .gv-brand .name');
  const wmSpan = wm ? wm.querySelector('span') : null;
  // Botón de idioma: cualquier button dentro del dropdown (algunas apps usan SVG, no glifo 文A)
  const langBtn = document.querySelector('.gv-lang-dropdown button, .gv-lang-dropdown-toggle');
  const topbar = document.querySelector('.gv-topbar');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const wmCs = cs(wm), spanCs = cs(wmSpan), langCs = cs(langBtn);
  const hasSvgIcon = langBtn ? !!langBtn.querySelector('svg') : false;
  return JSON.stringify({
    topbar: !!topbar,
    wordmark: wmCs ? wmCs.color : 'NO-EL',
    spanGradient: spanCs ? (spanCs.backgroundImage !== 'none' && spanCs.backgroundImage.includes('gradient')) : false,
    langFontSize: langCs ? langCs.fontSize : 'NO-BTN',
    langIcon: langBtn ? (langBtn.textContent.trim().includes('文') || hasSvgIcon) : false,
  });
})()`;

const PROBE_KEYS = `(() => {
  // keys-only: la app comparte claves gv-cc-* pero tiene topbar propio.
  // Verificamos: página carga + algún control de idioma/tema presente.
  const langish = document.querySelector('[class*=lang], [aria-label*=Idioma], [aria-label*=Language], [id*=lang]');
  const themish = document.querySelector('[class*=theme], [aria-label*=tema], [aria-label*=theme], [id*=theme]');
  return JSON.stringify({ loaded: document.readyState === 'complete' || document.readyState === 'interactive', langish: !!langish, themish: !!themish });
})()`;

interface ProbeFull {
  topbar: boolean;
  wordmark: string;
  spanGradient: boolean;
  langFontSize: string;
  langIcon: boolean;
}
interface ProbeKeys {
  loaded: boolean;
  langish: boolean;
  themish: boolean;
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const AUDIT_DIR = resolve(import.meta.dirname, '../../.runtime/visual-audit');
mkdirSync(AUDIT_DIR, { recursive: true });

async function verifyPage(
  browser: Browser,
  app: AppTarget,
): Promise<{ pass: boolean; detail: string }> {
  const page = await browser.newPage();
  const failures: string[] = [];
  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(app.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      await page
        .waitForSelector('.gv-topbar, .gv-theme-toggle, [class*=lang], [class*=theme]', {
          timeout: 5_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
      const layout = await page.evaluate(() => ({
        // documentElement is the user-visible scroll container; body can keep
        // the intrinsic width of intentionally clipped decorative children.
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      if (layout.documentWidth > layout.viewportWidth + 1) {
        failures.push(`${viewport.name}-overflow`);
      }
      await page.screenshot({
        path: resolve(AUDIT_DIR, `${app.name}-${viewport.name}.png`),
        fullPage: false,
      });
      if (app.contract === 'waiver') continue;
      if (app.contract === 'keys-only') {
        const probe = JSON.parse(await page.evaluate(PROBE_KEYS)) as ProbeKeys;
        if (!probe.loaded) failures.push(`${viewport.name}-carga`);
        if (!probe.langish && !probe.themish) failures.push(`${viewport.name}-control-idioma-o-tema`);
        continue;
      }
      const probe = JSON.parse(await page.evaluate(PROBE_FULL)) as ProbeFull;
      const checks = [
        { k: 'topbar', ok: probe.topbar },
        { k: 'wordmark-blanco', ok: probe.wordmark.startsWith('rgb(') && !probe.wordmark.includes('rgba(0, 0, 0, 0)') },
        { k: 'vanguard-gradiente', ok: probe.spanGradient },
        { k: 'idioma-13px', ok: probe.langFontSize === '13px' },
        { k: 'icono-idioma', ok: probe.langIcon },
      ];
      failures.push(...checks.filter((c) => !c.ok).map((c) => `${viewport.name}-${c.k}`));
    }
    return {
      pass: failures.length === 0,
      detail: failures.length ? `FAIL: ${failures.join(', ')}` : 'ok (desktop + mobile)',
    };
  } catch (e) {
    return { pass: false, detail: `no accesible: ${String(e).slice(0, 90)}` };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log('═══ shell-visual-verify — identidad GV en vivo ═══\n');
  const browser = await chromium.launch({ headless: true });
  try {
    const results: Array<{ name: string; pass: boolean; detail: string }> = [];
    // A slow local app (notably Command Center) must not starve the audit
    // while the other surfaces are already ready. Keep a small bounded batch
    // so Chromium remains stable and the full audit fits CI/runner limits.
    for (let i = 0; i < APPS.length; i += 3) {
      const batch = await Promise.all(APPS.slice(i, i + 3).map(async (app) => ({
        name: app.name,
        ...(await verifyPage(browser, app)),
      })));
      for (const r of batch) {
        results.push(r);
        console.log(`${r.pass ? '✅' : '❌'} ${r.name.padEnd(16)} ${r.detail}`);
      }
    }
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} apps homologadas en vivo.`);
    if (failed.length) {
      console.error('\nApps con fallos: ' + failed.map((f) => f.name).join(', '));
      process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error('shell-visual-verify error:', e);
  process.exit(1);
});
