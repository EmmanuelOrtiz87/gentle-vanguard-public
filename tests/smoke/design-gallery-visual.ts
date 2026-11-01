/**
 * design-gallery-visual — validación visual de la galería de estilos.
 *
 * Verifica en los 3 anchos canónicos (390/900/1440):
 *   1. la página carga sin errores de consola,
 *   2. hay 8 estilos renderizados y el filtro por nivel funciona,
 *   3. cada preview tiene tokens aplicados (el fondo NO es el del chrome:
 *      si el estilo no aplicara, los 8 previews se verían iguales),
 *   4. los previews son visualmente distintos entre sí (huella de color),
 *   5. el inventario de capacidades tiene filas,
 *   6. sin overflow horizontal y sin copy aplastada.
 *
 * Uso: node --import tsx tests/smoke/design-gallery-visual.ts
 * Exit 0 = ok · Exit 1 = hallazgos.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.GV_GALLERY_URL ?? 'http://127.0.0.1:8097/';
const auditDir = resolve(process.cwd(), '.runtime/visual-audit');
mkdirSync(auditDir, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-900', width: 900, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
] as const;

const browser = await chromium.launch({ headless: true });
const results: Array<{ name: string; failures: string[] }> = [];

try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const failures: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForSelector('.style-card', { timeout: 10_000 });
      await page.waitForTimeout(350);

      const cards = await page.locator('.style-card').count();
      if (cards !== 8) failures.push(`deberían ser 8 estilos y hay ${cards}`);

      // El filtro por nivel tiene que filtrar de verdad.
      await page.locator('.filter', { hasText: 'Cinético' }).click();
      await page.waitForTimeout(200);
      const filtered = await page.locator('.style-card').count();
      if (filtered !== 1) failures.push(`el filtro "Cinético" debería dejar 1 estilo y deja ${filtered}`);
      await page.locator('.filter', { hasText: 'Todos' }).click();
      await page.waitForTimeout(200);
      const restored = await page.locator('.style-card').count();
      if (restored !== 8) failures.push(`al volver a "Todos" deberían ser 8 y hay ${restored}`);

      // Los previews tienen que verse distintos: si los tokens no se aplicaran,
      // los 8 compartirían el mismo fondo.
      const fingerprints = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.pv')).map((el) => {
          const cs = getComputedStyle(el);
          return `${cs.backgroundColor}|${cs.borderRadius}|${cs.fontFamily}|${getComputedStyle(el.querySelector('h4')!).fontSize}`;
        })
      );
      if (new Set(fingerprints).size < 6) {
        failures.push(`los previews son demasiado parecidos (${new Set(fingerprints).size} huellas distintas de 8)`);
      }

      // El inventario de capacidades tiene que tener filas.
      const capRows = await page.locator('.cap-table tbody tr').count();
      if (capRows < 30) failures.push(`el inventario lista ${capRows} filas (se esperaban 30+)`);

      // ── familias: cada capacidad tiene que verse, no solo nombrarse ──────
      const famCards = await page.locator('.fam-card').count();
      if (famCards < 17) failures.push(`deberían ser 17 familias y hay ${famCards}`);

      // Ninguna demo puede estar vacía: un recuadro en blanco no explica nada.
      const demosVacias = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.fam-demo'))
          .map((el, i) => ({ i, h: el.getBoundingClientRect().height, kids: el.children.length }))
          .filter((d) => d.h < 20 || d.kids === 0)
          .map((d) => `#${d.i}(${Math.round(d.h)}px/${d.kids}k)`)
      );
      if (demosVacias.length) failures.push(`demos vacías o aplastadas: ${demosVacias.slice(0, 4).join(' ')}`);

      // Las demos tienen que verse distintas entre sí (si todas fueran el mismo
      // bloque, la galería no estaría mostrando capacidades, sino un adorno).
      const famHuellas = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.fam-demo')).map(
          (el) => `${el.firstElementChild?.className}|${el.getBoundingClientRect().height}|${el.innerHTML.length}`
        )
      );
      if (new Set(famHuellas).size < 12) {
        failures.push(`las demos son demasiado parecidas (${new Set(famHuellas).size} huellas distintas de ${famHuellas.length})`);
      }

      // El inventario completo tiene que estar desplegable.
      const detailsAbrible = await page.locator('details.panel summary').count();
      if (detailsAbrible < 1) failures.push('falta el <details> con el inventario completo');

      // ── efectos: 32 demos vivas (10 motion + 8 scroll + 7 imagen + 7 nativas) ─
      const sfxCards = await page.locator('.sfx-card').count();
      if (sfxCards !== 32) failures.push(`deberían ser 32 efectos y hay ${sfxCards}`);

      const sfxDemosVacias = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.sfx-demo'))
          .map((el, i) => ({ i, h: el.getBoundingClientRect().height, kids: el.children.length }))
          .filter((d) => d.h < 40 || d.kids === 0)
          .map((d) => `#${d.i}(${Math.round(d.h)}px/${d.kids}k)`)
      );
      if (sfxDemosVacias.length) failures.push(`demos de efectos vacías o aplastadas: ${sfxDemosVacias.slice(0, 4).join(' ')}`);

      // Las demos de efecto tienen que verse distintas entre sí.
      const sfxHuellas = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.sfx-demo')).map((el) => el.innerHTML.length + '|' + el.firstElementChild?.className)
      );
      if (new Set(sfxHuellas).size < 20) {
        failures.push(`las demos de efectos son demasiado parecidas (${new Set(sfxHuellas).size} huellas de ${sfxHuellas.length})`);
      }

      // Los stages de scroll tienen que tener recorrido real, si no el efecto no se ve.
      const stagesSinScroll = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-stage]'))
          .filter((el) => el.scrollHeight - el.clientHeight < 20)
          .map((el) => el.className)
      );
      if (stagesSinScroll.length) failures.push(`stages sin recorrido de scroll: ${stagesSinScroll.join(' | ')}`);

      // ── container query: el card tiene que cambiar de layout con el ancho
      //    de SU contenedor (y no con el de la ventana) ─────────────────────
      const cqTracks = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>('[data-cq-shell]');
        const card = document.querySelector<HTMLElement>('.sfx-cq-card');
        if (!shell || !card) return { before: 0, after: 0 };
        // Sin transition: con ella, el computed style devuelve el ancho viejo.
        shell.style.transition = 'none';
        shell.style.width = '200px';
        const before = getComputedStyle(card).gridTemplateColumns.split(' ').length;
        shell.style.width = '420px';
        const after = getComputedStyle(card).gridTemplateColumns.split(' ').length;
        shell.style.width = '';
        shell.style.transition = '';
        return { before, after };
      });
      if (cqTracks.after <= cqTracks.before) {
        failures.push(`la container query no cambió el layout (tracks ${cqTracks.before} → ${cqTracks.after})`);
      }

      // ── anclaje nativo: el tooltip tiene que quedar pegado al botón ──
      const anchorOk = await page.evaluate(async () => {
        const btn = document.querySelector<HTMLElement>('.sfx-anchor-btn');
        const tip = document.querySelector<HTMLElement>('.sfx-anchor-tip');
        if (!btn || !tip) return { ok: false, why: 'no hay demo de anclaje' };
        btn.focus();
        btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 260));
        const b = btn.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        const pegado = t.top >= b.bottom - 4 && t.top < b.bottom + 40 && t.height > 10;
        return { ok: pegado, why: `tooltip ${Math.round(t.top)} vs botón ${Math.round(b.bottom)}` };
      });
      if (!anchorOk.ok) failures.push(`el anclaje nativo no pega el tooltip al botón (${anchorOk.why})`);

      // ── popover nativo: abre, se anima y cierra ──
      const popAntes = await page.locator('.sfx-pop-menu').count();
      await page.locator('.sfx-pop-btn').first().click();
      await page.waitForTimeout(250);
      const popAbierto = await page.evaluate(() => {
        const m = document.querySelector<HTMLElement>('.sfx-pop-menu');
        return m ? m.matches(':popover-open') : false;
      });
      if (!popAbierto) failures.push('el popover nativo no abrió al clickear el disparador');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const popCerrado = await page.evaluate(() => {
        const m = document.querySelector<HTMLElement>('.sfx-pop-menu');
        return m ? !m.matches(':popover-open') : false;
      });
      if (!popCerrado) failures.push('el popover nativo no cerró con Escape');
      if (popAntes !== 1) failures.push(`debería haber 1 popover en la demo y hay ${popAntes}`);

      // ── contraste alto: el toggle tiene que cambiar los tokens ──
      const hc = await page.evaluate(async () => {
        const root = document.documentElement;
        const before = getComputedStyle(root).getPropertyValue('--gv-border').trim();
        const btn = document.querySelector<HTMLElement>('[data-hc-toggle]');
        if (!btn) return { ok: false, why: 'no hay toggle de contraste' };
        btn.click();
        await new Promise((r) => setTimeout(r, 120));
        const after = getComputedStyle(root).getPropertyValue('--gv-border').trim();
        btn.click();
        await new Promise((r) => setTimeout(r, 120));
        const back = getComputedStyle(root).getPropertyValue('--gv-border').trim();
        return { ok: before !== after && back === before, why: `${before} → ${after} → ${back}` };
      });
      if (!hc.ok) failures.push(`el toggle de contraste alto no cambia los tokens (${hc.why})`);

      // ── text-wrap: el titular equilibrado tiene que estar equilibrado ──
      const tw = await page.evaluate(() => {
        const bal = document.querySelector<HTMLElement>('.sfx-tw-balance');
        const plain = document.querySelector<HTMLElement>('.sfx-tw-plain');
        if (!bal || !plain) return { ok: false, why: 'no hay demo de text-wrap' };
        return {
          ok: getComputedStyle(bal).textWrap.includes('balance') && !getComputedStyle(plain).textWrap.includes('balance'),
          why: `${getComputedStyle(bal).textWrap} / ${getComputedStyle(plain).textWrap}`,
        };
      });
      if (!tw.ok) failures.push(`el equilibrio de titulares no está activo (${tw.why})`);

      // ── pantalla completa: el overlay abre, muestra el estilo y se cierra ─
      await page.locator('[data-fs]').first().click();
      await page.waitForTimeout(350);
      const fsVisible = await page.locator('#fs.is-open .pv').count();
      if (fsVisible !== 1) failures.push(`el overlay de pantalla completa deberia mostrar 1 preview (mostró ${fsVisible})`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const fsClosed = await page.locator('#fs.is-open').count();
      if (fsClosed !== 0) failures.push('el overlay de pantalla completa no se cierra con Escape');
      // Con el overlay cerrado tiene que quedar la página usable.
      const overlayBloquea = await page.evaluate(() => {
        const el = document.getElementById('fs');
        if (!el || el.hidden) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (overlayBloquea) failures.push('el overlay sigue tapando la página después de cerrarse');

      // Sin overflow horizontal y sin copy aplastada.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`overflow horizontal (${overflow}px)`);

      const squashed = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('.pv h4, .style-head h3, .cap-table td, .fam-head h3, .fam-summary'))) {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0 && rect.height < 12) bad.push(`${el.className}: ${Math.round(rect.height)}px`);
        }
        return bad;
      });
      if (squashed.length) failures.push(`copy aplastada: ${squashed.slice(0, 3).join(' | ')}`);

      if (pageErrors.length) failures.push(`errores de página: ${pageErrors.join(' | ')}`);

      await page.screenshot({ path: resolve(auditDir, `design-gallery-${viewport.name}.png`), fullPage: false });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(auditDir, `design-gallery-${viewport.name}-bottom.png`), fullPage: false });
      await page.locator('#families').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(auditDir, `design-gallery-${viewport.name}-families.png`), fullPage: false });
      await page.locator('#efectos').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(auditDir, `design-gallery-${viewport.name}-efectos.png`), fullPage: false });
      await page.evaluate(() => {
        const el = document.getElementById('efectos');
        if (el) window.scrollBy(0, 520);
      });
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(auditDir, `design-gallery-${viewport.name}-efectos-2.png`), fullPage: false });

      // ── showroom: la web de ejemplo tiene que entrar por sí sola ────────
      await page.goto(`${baseUrl}showcase/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(700);
      const scOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (scOverflow > 1) failures.push(`showroom: overflow horizontal (${scOverflow}px)`);
      const scSecciones = await page.locator('main section, section[id]').count();
      if (scSecciones < 8) failures.push(`showroom: solo ${scSecciones} secciones (se esperaban 8+)`);
      await page.screenshot({ path: resolve(auditDir, `showcase-${viewport.name}.png`), fullPage: false });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(auditDir, `showcase-${viewport.name}-bottom.png`), fullPage: false });
    } catch (error) {
      failures.push(`excepción: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await page.close();
    }
    results.push({ name: viewport.name, failures });
  }
} finally {
  await browser.close();
}

for (const result of results) {
  console.log(
    `${result.name.padEnd(14)} ${result.failures.length ? 'FAIL' : 'ok'}${result.failures.length ? ` — ${result.failures.join('; ')}` : ''}`
  );
}
console.log(`capturas: ${auditDir}`);
process.exit(results.some((r) => r.failures.length) ? 1 : 0);
