/**
 * gv-music-instruments-visual — validacion visual de la capa de instrumentos.
 *
 * Regresion del incidente 2026-10-29 (synth-card): una columna con contenido
 * creciente aplastaba a la copy a width 0. Este check mira, en los 3 anchos
 * canonicos (390/900/1440), que:
 *   1. no hay overflow horizontal,
 *   2. la copy del generador conserva ancho util,
 *   3. la fila de instrumentos existe con sus 6 chips y ninguno queda en 0px,
 *   4. elegir un instrumento lo deja marcado como activo.
 *
 * Uso: node --import tsx tests/smoke/gv-music-instruments-visual.ts
 * Exit 0 = todo ok · Exit 1 = hallazgos.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.GV_MUSIC_URL ?? "http://127.0.0.1:1420/";
const auditDir = resolve(process.cwd(), ".runtime/visual-audit");
mkdirSync(auditDir, { recursive: true });

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-900", width: 900, height: 900 },
  { name: "desktop-1440", width: 1440, height: 1000 },
] as const;

const EXPECTED_INSTRUMENTS = ["", "guitar", "drums", "flute", "violin", "piano"];

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
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.locator(".synth-card").waitFor({ state: "visible", timeout: 8_000 });
      await page.locator(".synth-card").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);

      const layout = await page.evaluate(() => {
        const copy = document.querySelector<HTMLElement>(".synth-copy");
        const row = document.querySelector<HTMLElement>(".synth-instruments");
        const chips = Array.from(document.querySelectorAll<HTMLElement>("[data-synth-instrument]"));
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          copyWidth: copy?.getBoundingClientRect().width ?? 0,
          rowWidth: row?.getBoundingClientRect().width ?? 0,
          chipCount: chips.length,
          zeroWidthChips: chips.filter((chip) => chip.getBoundingClientRect().width <= 0).length,
        };
      });

      if (layout.documentWidth > layout.viewportWidth + 1) {
        failures.push(`overflow (${layout.documentWidth} > ${layout.viewportWidth})`);
      }
      if (layout.copyWidth < 120) {
        failures.push(`copy aplastada (${Math.round(layout.copyWidth)}px)`);
      }
      if (layout.rowWidth <= 0) {
        failures.push("fila de instrumentos sin ancho");
      }
      if (layout.chipCount !== EXPECTED_INSTRUMENTS.length) {
        failures.push(`chips esperados ${EXPECTED_INSTRUMENTS.length}, hay ${layout.chipCount}`);
      }
      if (layout.zeroWidthChips > 0) {
        failures.push(`${layout.zeroWidthChips} chips con ancho 0`);
      }

      // Elegir un instrumento debe marcarlo activo (y solo ese).
      await page.locator('[data-synth-instrument="guitar"]').click();
      await page.waitForTimeout(150);
      const active = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-synth-instrument]"))
          .filter((chip) => chip.classList.contains("is-active"))
          .map((chip) => chip.dataset.synthInstrument ?? ""),
      );
      if (active.length !== 1 || active[0] !== "guitar") {
        failures.push(`selección activa incorrecta: ${active.join(",") || "ninguna"}`);
      }

      // ── Fila de mezcla: el slider aparece con la voz y muestra el perfil ──
      const mix = await page.evaluate(() => {
        const slider = document.querySelector<HTMLInputElement>("#synth-mix-level");
        const note = document.querySelector<HTMLElement>("#synth-mix-note");
        const value = document.querySelector<HTMLElement>("#synth-mix-value");
        const row = document.querySelector<HTMLElement>("#synth-mix");
        return {
          hasSlider: Boolean(slider),
          disabled: slider?.disabled ?? true,
          sliderWidth: slider?.getBoundingClientRect().width ?? 0,
          note: note?.textContent?.trim() ?? "",
          value: value?.textContent?.trim() ?? "",
          rowWidth: row?.getBoundingClientRect().width ?? 0,
        };
      });
      if (!mix.hasSlider) failures.push("no existe el slider de mezcla (#synth-mix-level)");
      if (mix.disabled) failures.push("el slider de mezcla sigue deshabilitado con una voz elegida");
      if (mix.sliderWidth <= 0) failures.push("el slider de mezcla tiene ancho 0");
      if (!/%/.test(mix.value)) failures.push(`el valor de mezcla no es un porcentaje: "${mix.value}"`);
      if (!/\d+%/.test(mix.note)) failures.push(`la nota de mezcla no muestra el perfil: "${mix.note}"`);
      if (mix.rowWidth <= 0) failures.push("la fila de mezcla no tiene ancho");

      // Mover el slider debe cambiar el valor (y no romper nada).
      await page.locator("#synth-mix-level").fill("120");
      await page.waitForTimeout(150);
      const mixAfter = await page.evaluate(() => ({
        value: document.querySelector<HTMLElement>("#synth-mix-value")?.textContent?.trim() ?? "",
        stored: localStorage.getItem("gv-music-synth-mix") ?? "",
      }));
      if (mixAfter.value !== "120%") failures.push(`el slider no actualizó el valor: "${mixAfter.value}"`);
      if (!mixAfter.stored) failures.push("el ajuste de mezcla no se persistió");

      if (pageErrors.length) failures.push(`errores de página: ${pageErrors.join(" | ")}`);

      await page.screenshot({ path: resolve(auditDir, `gv-music-instruments-${viewport.name}.png`), fullPage: false });
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
