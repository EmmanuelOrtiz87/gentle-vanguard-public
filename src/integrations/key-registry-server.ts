#!/usr/bin/env node
/**
 * Key Registry Service — endpoint local para las apps del stack.
 *
 * Endpoints (solo 127.0.0.1):
 *   GET  /health → { ok, service, providers: n }
 *   GET  /keys   → { providers: [{ id, label, configured, source, keyRedacted, origin }] }
 *   POST /llm    → { provider, prompt, system?, model? } → { text, provider, model }
 *
 * El proxy /llm existe para que la key NUNCA llegue al navegador: la app manda
 * el prompt y el stack resuelve la key y llama al provider. Eso también elimina
 * el procedimiento repetido de pegar la key en cada app.
 *
 * Uso: node --import tsx src/integrations/key-registry-server.ts [--port 3045]
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolveProviderKey, resolveProviderKeyStatuses } from './key-registry.js';

const DEFAULT_PORT = 3045;
const HOST = '127.0.0.1';

function readPort(): number {
  const argIndex = process.argv.indexOf('--port');
  const fromArg = argIndex >= 0 ? Number(process.argv[argIndex + 1]) : NaN;
  const fromEnv = Number(process.env.GV_KEY_REGISTRY_PORT ?? NaN);
  return Number.isFinite(fromArg) && fromArg > 0 ? fromArg : Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PORT;
}

/** CORS: solo loopback (el stack es local-first, ADR-0017). */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  // Loopback check sin regex (security/detect-unsafe-regex): hostname exacto vía URL.
  const local = !origin || (() => {
    try {
      const u = new URL(origin);
      return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && (u.port === '' || /^\d{1,5}$/.test(u.port));
    } catch {
      return false;
    }
  })();
  res.setHeader('Access-Control-Allow-Origin', local ? (origin ?? 'null') : 'null');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('body no es JSON');
  }
}

/** Llama a Gemini con la key del stack (la app nunca la ve). */
async function callGemini(key: string, prompt: string, system: string | undefined, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`provider respondió ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return text.trim();
}

const server = createServer((req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = (req.url ?? '/').split('?')[0] ?? '/';

  if (req.method === 'GET' && url === '/health') {
    const statuses = resolveProviderKeyStatuses();
    json(res, 200, {
      ok: true,
      service: 'key-registry',
      providers: statuses.filter((s) => s.configured).length,
      total: statuses.length,
    });
    return;
  }

  if (req.method === 'GET' && url === '/keys') {
    json(res, 200, { providers: resolveProviderKeyStatuses() });
    return;
  }

  if (req.method === 'POST' && url === '/llm') {
    void (async () => {
      try {
        const body = (await readBody(req)) as {
          provider?: string;
          prompt?: string;
          system?: string;
          model?: string;
        };
        const provider = (body.provider ?? 'gemini').toLowerCase();
        const prompt = (body.prompt ?? '').trim();
        if (!prompt) {
          json(res, 400, { error: 'prompt vacio' });
          return;
        }
        const resolved = resolveProviderKey(provider);
        if (!resolved) {
          json(res, 409, { error: `sin key para ${provider}`, provider });
          return;
        }
        if (provider !== 'gemini') {
          json(res, 501, { error: `provider ${provider} sin proxy todavia`, provider });
          return;
        }
        const model = body.model ?? 'gemini-2.0-flash';
        const text = await callGemini(resolved.key, prompt, body.system, model);
        json(res, 200, { text, provider, model, source: resolved.source });
      } catch (error) {
        json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return;
  }

  json(res, 404, { error: 'ruta desconocida' });
});

const port = readPort();
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[key-registry] el puerto ${port} ya está en uso — ¿hay otra instancia?`);
    process.exit(1);
  }
  console.error(`[key-registry] error del servidor: ${error.message}`);
  process.exit(1);
});
server.listen(port, HOST, () => {
  const statuses = resolveProviderKeyStatuses();
  const configured = statuses.filter((s) => s.configured).map((s) => `${s.id}(${s.source})`);
  console.log(`[key-registry] escuchando en http://${HOST}:${port} — providers con key: ${configured.join(', ') || 'ninguno'}`);
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
