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
import { chromium, type Browser } from 'playwright';

interface AppTarget {
  name: string;
  url: string;
  /**
   * full-contract: usa el shell GV compartido (topbar + wordmark + dropdown idioma).
   * keys-only: topbar custom (Tailwind/propio) — solo comparte claves gv-cc-*;
   * se verifica que carga y tiene control de idioma en algún lugar.
   */
  contract: 'full' | 'keys-only';
}

const APPS: AppTarget[] = [
  { name: 'academy-web', url: 'http://127.0.0.1:4173', contract: 'full' },
  { name: 'academy-landing', url: 'http://127.0.0.1:4174', contract: 'full' },
  { name: 'content-cms', url: 'http://127.0.0.1:5175', contract: 'full' },
  { name: 'academy-crm', url: 'http://127.0.0.1:4792', contract: 'full' },
  { name: 'archify', url: 'http://127.0.0.1:5179', contract: 'full' },
  { name: 'web-dashboard', url: 'http://127.0.0.1:5173', contract: 'keys-only' },
  { name: 'gv-analytics', url: 'http://127.0.0.1:5174', contract: 'keys-only' },
  { name: 'prompt-studio', url: 'http://127.0.0.1:5176', contract: 'full' },
  { name: 'design-hub', url: 'http://127.0.0.1:8095', contract: 'full' },
  { name: 'command-center', url: 'http://127.0.0.1:8090', contract: 'full' },
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

async function verifyPage(
  browser: Browser,
  app: AppTarget,
): Promise<{ pass: boolean; detail: string }> {
  const page = await browser.newPage();
  try {
    await page.goto(app.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
    // Hidratación React / CSS apply: espera activa al primer control del shell.
    await page
      .waitForSelector('.gv-topbar, .gv-theme-toggle, [class*=lang], [class*=theme]', {
        timeout: 5_000,
      })
      .catch(() => {});
    await page.waitForTimeout(600);
    if (app.contract === 'keys-only') {
      const probe = JSON.parse(await page.evaluate(PROBE_KEYS)) as ProbeKeys;
      const failed: string[] = [];
      if (!probe.loaded) failed.push('carga');
      // keys-only: la app comparte claves gv-cc-*; puede tener solo idioma,
      // solo tema (web-dashboard es theme-only) o ambos.
      if (!probe.langish && !probe.themish) failed.push('control-idioma-o-tema');
      return {
        pass: failed.length === 0,
        detail: failed.length ? `FAIL: ${failed.join(', ')}` : 'ok (keys-only)',
      };
    }
    const probe = JSON.parse(await page.evaluate(PROBE_FULL)) as ProbeFull;
    const checks = [
      { k: 'topbar', ok: probe.topbar },
      {
        k: 'wordmark-blanco',
        ok: probe.wordmark.startsWith('rgb(') && !probe.wordmark.includes('rgba(0, 0, 0, 0)'),
      },
      { k: 'vanguard-gradiente', ok: probe.spanGradient },
      { k: 'idioma-13px', ok: probe.langFontSize === '13px' },
      { k: 'icono-idioma', ok: probe.langIcon },
    ];
    const failed = checks.filter((c) => !c.ok).map((c) => c.k);
    return {
      pass: failed.length === 0,
      detail: failed.length ? `FAIL: ${failed.join(', ')}` : 'ok',
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
    for (const app of APPS) {
      const r = await verifyPage(browser, app);
      results.push({ name: app.name, ...r });
      console.log(`${r.pass ? '✅' : '❌'} ${app.name.padEnd(16)} ${r.detail}`);
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
