/**
 * academy-tutor-visual — validación visual del Tutor IA (FAB móvil + keys).
 *
 * Lo que el owner pidió:
 *   1. el ícono del bot NO está anclado en la esquina inferior derecha: se
 *      arrastra a cualquier punto de la pantalla (click presionado),
 *   2. el bot reconoce las keys que el stack ya tiene configuradas.
 *
 * Este check lo verifica en los 3 anchos canónicos (390/900/1440):
 *   1. sin overflow horizontal,
 *   2. el FAB se mueve con un arrastre real (mouse) y el arrastre NO abre el panel,
 *   3. un clic SÍ abre el panel, y el panel entra en pantalla,
 *   4. el badge de keys dice algo (stack con key / sin key / registry caído).
 *
 * Uso: node --import tsx tests/smoke/academy-tutor-visual.ts
 * Exit 0 = todo ok · Exit 1 = hallazgos.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.GV_ACADEMY_URL ?? "http://127.0.0.1:4173/";
const auditDir = resolve(process.cwd(), ".runtime/visual-audit");
mkdirSync(auditDir, { recursive: true });

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-900", width: 900, height: 900 },
  { name: "desktop-1440", width: 1440, height: 1000 },
] as const;

interface ViewportResult {
  name: string;
  failures: string[];
}

const browser = await chromium.launch({ headless: true });
const results: ViewportResult[] = [];

try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const failures: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const fab = page.locator("#gv-tutor-fab");
      await fab.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(400);

      const before = await fab.boundingBox();
      if (!before) throw new Error("el FAB no tiene caja");

      // ── 1. Arrastre real: el botón se mueve y el panel NO se abre ─────────
      const target = { x: Math.round(viewport.width * 0.3), y: Math.round(viewport.height * 0.35) };
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(250);

      const after = await fab.boundingBox();
      if (!after) throw new Error("el FAB desapareció tras el arrastre");
      const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
      if (moved < 20) failures.push(`el FAB no se movió con el arrastre (${Math.round(moved)}px)`);
      if (after.x < 0 || after.y < 0 || after.x + after.width > viewport.width + 1) {
        failures.push(`el FAB quedó fuera de pantalla (x=${Math.round(after.x)})`);
      }
      const panelOpenAfterDrag = await page.locator("#gv-tutor-panel").evaluate((el) => (el as HTMLElement).style.display !== "none");
      if (panelOpenAfterDrag) failures.push("el arrastre abrió el panel (debería abrirlo solo un clic)");

      // ── 2. Clic: abre el panel y el panel entra en pantalla ───────────────
      const box = await fab.boundingBox();
      if (!box) throw new Error("el FAB no tiene caja para el clic");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(700);

      const panel = page.locator("#gv-tutor-panel");
      const panelVisible = await panel.isVisible();
      if (!panelVisible) failures.push("el clic no abrió el panel");
      const panelBox = await panel.boundingBox();
      if (panelBox) {
        if (panelBox.x < -1 || panelBox.y < -1) failures.push(`el panel quedó fuera de pantalla (${Math.round(panelBox.x)}, ${Math.round(panelBox.y)})`);
        if (panelBox.x + panelBox.width > viewport.width + 1) failures.push("el panel desborda a la derecha");
      }

      // ── 3. Badge de keys: tiene que reflejar la realidad del stack ──────
      const badge = (await page.locator("#gv-tutor-keys").textContent())?.trim() ?? "";
      if (!badge) failures.push("el badge de keys está vacío");
      if (/Buscando keys en el stack…$/.test(badge)) failures.push("el badge de keys quedó en 'buscando' (no resolvió)");

      // El badge no puede inventar: se compara con lo que el registry responde.
      const registry = await page.evaluate(async () => {
        try {
          const res = await fetch("http://127.0.0.1:3045/keys");
          const data = await res.json();
          const providers = Array.isArray(data.providers) ? data.providers : [];
          return { ok: true, configured: providers.filter((p: { configured?: boolean }) => p.configured).map((p: { id: string }) => p.id) };
        } catch {
          return { ok: false, configured: [] as string[] };
        }
      });
      if (registry.ok && registry.configured.length) {
        if (!/detectada en el stack/i.test(badge)) {
          failures.push(`el stack tiene key (${registry.configured.join(",")}) pero el badge no la reconoce: "${badge}"`);
        }
      } else if (registry.ok) {
        if (!/no tiene keys/i.test(badge)) {
          failures.push(`el stack no tiene keys pero el badge dice otra cosa: "${badge}"`);
        }
      } else if (!/no está corriendo/i.test(badge)) {
        failures.push(`el registry no respondió pero el badge dice otra cosa: "${badge}"`);
      }

      // ── 4. Sin overflow horizontal ────────────────────────────────────────
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`overflow horizontal (${overflow}px)`);

      if (pageErrors.length) failures.push(`errores de página: ${pageErrors.join(" | ")}`);

      await page.screenshot({ path: resolve(auditDir, `academy-tutor-${viewport.name}.png`), fullPage: false });
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
  const status = result.failures.length ? "FAIL" : "ok";
  console.log(`${result.name.padEnd(14)} ${status}${result.failures.length ? ` — ${result.failures.join("; ")}` : ""}`);
}
console.log(`capturas: ${auditDir}`);

const failed = results.filter((result) => result.failures.length);
process.exit(failed.length ? 1 : 0);
