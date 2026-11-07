/**
 * CONTRATESTS del descubrimiento local (ollama + LM Studio agnóstico).
 *
 * El owner pidió: "que tome cualquiera de los dos sin importar el modelo que
 * carguemos". El contrato:
 *   - LM Studio: todo lo CARGADO se descubre (ids exactos de /v1/models).
 *   - ollama: solo el modelo ACTIVO califica (cargar los demás = 30s de RAM).
 *   - Servidor caído/timeout → lista vacía, sin throw, sin ruido.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { discoverLocalModels, LOCAL_ENDPOINTS } from "../../src/ml/local-provider-discovery.js";

function fetchFrom(map: Record<string, unknown | Error>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = map[url];
    if (payload instanceof Error) throw payload;
    return new Response(JSON.stringify(payload ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
}

const OLLAMA_TAGS = {
  models: [
    { name: "qwen2.5-coder:14b" },
    { name: "qwen2.5vl:3b" },
    { name: "qwen2.5-coder:3b" },
  ],
};

const LM_MODELS = { data: [{ id: "prism-ml/bonsai-27b" }, { id: "qwen2.5-coder-7b-instruct" }] };

describe("local-provider-discovery: ambos servidores, cualquier modelo cargado", () => {
  it("POSITIVO: LM Studio entrega todos los cargados; ollama solo el activo", async () => {
    const found = await discoverLocalModels(
      "qwen2.5-coder:14b",
      LOCAL_ENDPOINTS,
      fetchFrom({
        "http://127.0.0.1:11434/api/tags": OLLAMA_TAGS,
        "http://127.0.0.1:1234/v1/models": LM_MODELS,
      }),
    );
    assert.deepEqual(found, [
      { provider: "ollama", modelId: "qwen2.5-coder:14b" },
      { provider: "lm-studio", modelId: "prism-ml/bonsai-27b" },
      { provider: "lm-studio", modelId: "qwen2.5-coder-7b-instruct" },
    ]);
  });

  it("NEGATIVO: ollama sin el activo instalado no aporta targets", async () => {
    const found = await discoverLocalModels(
      "mistral-7b",
      LOCAL_ENDPOINTS,
      fetchFrom({ "http://127.0.0.1:11434/api/tags": OLLAMA_TAGS }),
    );
    assert.equal(found.length, 0);
  });

  it("NEGATIVO: LM Studio caído no rompe el descubrimiento de ollama", async () => {
    const found = await discoverLocalModels(
      "qwen2.5-coder:14b",
      LOCAL_ENDPOINTS,
      fetchFrom({
        "http://127.0.0.1:11434/api/tags": OLLAMA_TAGS,
        "http://127.0.0.1:1234/v1/models": new Error("ECONNREFUSED"),
      }),
    );
    assert.deepEqual(found, [{ provider: "ollama", modelId: "qwen2.5-coder:14b" }]);
  });

  it("NEGATIVO: ollama caído no rompe LM Studio (cualquiera de los dos sirve)", async () => {
    const found = await discoverLocalModels(
      null,
      LOCAL_ENDPOINTS,
      fetchFrom({
        "http://127.0.0.1:11434/api/tags": new Error("ECONNREFUSED"),
        "http://127.0.0.1:1234/v1/models": LM_MODELS,
      }),
    );
    assert.equal(found.length, 2);
    assert.equal(found[0]!.provider, "lm-studio");
  });

  it("NEGATIVO: ambos caídos → lista vacía (sin throw)", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const found = await discoverLocalModels("qwen2.5-coder:14b", LOCAL_ENDPOINTS, failing);
    assert.deepEqual(found, []);
  });
});
