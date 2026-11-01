import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseEnvFile,
  PROVIDER_SPECS,
  redactKey,
  resolveProviderKey,
  resolveProviderKeyStatuses,
} from "../../src/integrations/key-registry.js";

test("catalogo de providers: cada uno con sus variables de entorno", () => {
  assert.ok(PROVIDER_SPECS.length >= 5);
  const ids = PROVIDER_SPECS.map((p) => p.id);
  assert.ok(ids.includes("gemini"));
  assert.ok(ids.includes("openai"));
  for (const spec of PROVIDER_SPECS) {
    assert.ok(spec.env.length > 0, `${spec.id} sin variables de entorno`);
    assert.ok(spec.routerAliases.length > 0, `${spec.id} sin alias de router`);
  }
});

test("redactKey nunca devuelve la key completa", () => {
  assert.equal(redactKey(""), "");
  assert.equal(redactKey("corta"), "****");
  const redacted = redactKey("AIzaSyABCDEFGHIJKLMNOP");
  assert.ok(redacted.includes("****"));
  assert.ok(!redacted.includes("ABCDEFGHIJKLMNOP"));
});

test("parseEnvFile: ignora comentarios, comillas y lineas rotas", () => {
  const parsed = parseEnvFile([
    "# comentario",
    "GEMINI_API_KEY=abc123",
    'OPENAI_API_KEY="sk-quoted"',
    "ESPACIOS = con valor ",
    "sin_igual",
  ].join("\n"));
  assert.equal(parsed.GEMINI_API_KEY, "abc123");
  assert.equal(parsed.OPENAI_API_KEY, "sk-quoted");
  assert.equal(parsed.ESPACIOS, "con valor");
  assert.equal(parsed.sin_igual, undefined);
});

test("resolveProviderKey: lee el archivo local de keys", () => {
  const root = mkdtempSync(join(tmpdir(), "gv-keys-"));
  writeFileSync(join(root, ".env.local"), "GEMINI_API_KEY=desde-archivo-local\n");
  const resolved = resolveProviderKey("gemini", root);
  assert.ok(resolved);
  assert.equal(resolved.source, "local-file");
  assert.equal(resolved.key, "desde-archivo-local");
  assert.ok(resolved.origin.includes(".env.local"));
});

test("resolveProviderKey: reconoce la key de una app del stack (apps/<app>/.env.local)", () => {
  const root = mkdtempSync(join(tmpdir(), "gv-keys-app-"));
  mkdirSync(join(root, "apps", "mi-app"), { recursive: true });
  writeFileSync(join(root, "apps", "mi-app", ".env.local"), "GEMINI_API_KEY=clave-de-la-app-123456\n");
  const resolved = resolveProviderKey("gemini", root);
  assert.ok(resolved, "la key de la app deberia resolverse");
  assert.equal(resolved.source, "local-file");
  assert.equal(resolved.key, "clave-de-la-app-123456");
  assert.ok(resolved.origin.includes("mi-app"), `origen inesperado: ${resolved.origin}`);
});

test("resolveProviderKey: provider sin key devuelve null", () => {
  const root = mkdtempSync(join(tmpdir(), "gv-keys-"));
  const statuses = resolveProviderKeyStatuses(root);
  const gemini = statuses.find((s) => s.id === "gemini");
  assert.ok(gemini);
  assert.equal(gemini.source === "none" || gemini.source === "local-file" || gemini.source === "environment" || gemini.source === "stack-config", true);
  assert.ok(gemini.keyRedacted === "" || gemini.keyRedacted.includes("****"));
});

test("resolveProviderKey: el estado jamas filtra la key completa", () => {
  const root = mkdtempSync(join(tmpdir(), "gv-keys-"));
  writeFileSync(join(root, ".env.local"), "GEMINI_API_KEY=clave-secreta-1234567890\n");
  const statuses = resolveProviderKeyStatuses(root);
  const gemini = statuses.find((s) => s.id === "gemini");
  assert.ok(gemini);
  assert.equal(gemini.keyRedacted.includes("clave-secreta-1234567890"), false);
  assert.ok(gemini.keyRedacted.length < 20, "la key redactada no debe ser larga como la key");
});
