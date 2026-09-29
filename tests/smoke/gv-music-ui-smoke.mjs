import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.GV_MUSIC_URL ?? "http://127.0.0.1:1420/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Conexiones" }).click();
  assert.equal(await page.locator("#settings-view").isVisible(), true);
  assert.equal(await page.locator("#provider-list .provider-card").count(), 7);
  await page.getByRole("button", { name: "Configurar" }).first().click();
  assert.match(await page.locator("#provider-list .provider-card").first().textContent(), /Configurado/u);
  assert.match(await page.locator("#app-toast").textContent(), /Configuración guardada localmente/u);
  await page.getByRole("button", { name: "Configurar API key" }).click();
  // El diálogo abre tras el fetch asíncrono al proxy local: esperar, no asumir.
  await page.locator("#action-dialog").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.locator("#action-dialog").isVisible(), true);
  assert.equal(await page.locator("#action-input").getAttribute("type"), "password");
  await page.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("button", { name: "Descubrir" }).click();
  await page.locator("#catalog-search").fill("ambient");
  await page.getByRole("button", { name: "Buscar catálogo" }).click();
  await page.waitForSelector("#catalog-list .library-row", { timeout: 15000 });
  assert.ok(await page.locator("#catalog-list .library-row").count() > 0);
  await page.locator("#catalog-source").selectOption("archive");
  await page.waitForFunction(() => document.querySelector("#catalog-status")?.textContent?.includes("Internet Archive"), { timeout: 30000 });
  assert.ok(await page.locator("#catalog-list .library-row").count() > 0);

  await page.getByRole("button", { name: "Inicio" }).click();
  assert.match(await page.locator("#home-view").textContent(), /Tu espacio empieza aquí/u);
  await page.locator(".nav-item[data-view='library']").click();
  assert.match(await page.locator("#library-list").textContent(), /Tu biblioteca está vacía/u);
  await page.locator("#local-files").setInputFiles({
    name: "gv-local-test.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF", "ascii"),
  });
  assert.equal(await page.locator("#library-list .library-row").count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, libraryTracks: 1 }, null, 2));
} finally {
  await browser.close();
}
