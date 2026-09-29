#!/usr/bin/env node
/**
 * mp-bridge/worker.ts — MercadoPago Checkout Bridge (P0-#2 del plan de evolución).
 *
 * Puente serverless entre la landing estática (GitHub Pages) y la API de
 * MercadoPago. Mantiene el ACCESS_TOKEN del lado servidor (nunca llega al
 * navegador) y recibe los webhooks de pago para registrar la venta.
 *
 * Formato: Cloudflare Worker (fetch handler + env bindings). También corre en
 * modo local para dev/tests: `node --import tsx src/mp-bridge/worker.ts` con
 * las mismas env vars (MP_ACCESS_TOKEN, MP_PUBLIC_KEY, MP_BRIDGE_SECRET).
 *
 * Endpoints:
 *   POST /api/mp/preference  — crea una preferencia Checkout Pro (server-side)
 *   POST /api/mp/webhook     — IPN de MercadoPago: verifica el pago y notifica
 *   GET  /api/mp/health      — health check (sin secretos)
 *
 * Env vars:
 *   MP_ACCESS_TOKEN     — access token de MercadoPago (obligatorio)
 *   MP_PUBLIC_KEY       — public key para el Wallet Brick del cliente (obligatorio)
 *   MP_BRIDGE_SECRET    — secreto compartido opcional: si está definido, el
 *                         cliente debe mandarlo como header `x-bridge-secret`
 *                         en /api/mp/preference (protege contra uso abusivo).
 *   CRM_WEBHOOK_URL     — URL opcional que recibe la venta confirmada (POST JSON).
 *                         Ej: el Apps Script de la landing (misma hoja de leads)
 *                         o un endpoint del CRM local vía túnel.
 *   WEBHOOK_SIGNING_SECRET — opcional: secreto whsec_... compartido con el receptor
 *                         (mismo valor que CRM_WEBHOOK_SECRET del lado CRM). Si
 *                         está definido, notifySale() firma el body según
 *                         Standard Webhooks 2026 spec (webhook-id / -timestamp /
 *                         -signature, HMAC-SHA256, replay protection). El receptor
 *                         debe verificar; si NO está definido, el envío es
 *                         best-effort sin firma (modo legacy, no recomendado).
 *                         Generar con: `npx tsx src/webhooks/secret-cli.ts generate`.
 *   ALLOWED_ORIGINS     — CSV de orígenes CORS permitidos (default: la landing).
 */

import { StandardWebhooks } from '../webhooks/standard-webhooks.js';
import { pathToFileURL } from 'url';

/** KV mínimo (evita depender de @cloudflare/workers-types). Exportado para
 *  que los tests puedan tipar el fake correctamente. */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>;
}

export interface Env {
  MP_ACCESS_TOKEN?: string;
  MP_PUBLIC_KEY?: string;
  MP_BRIDGE_SECRET?: string;
  CRM_WEBHOOK_URL?: string;
  WEBHOOK_SIGNING_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  /** Cola at-least-once de ventas aprobadas (polling del CRM local). */
  SALES_KV?: KVNamespace;
  /** Si está definido, /api/mp/sales/* exige header `x-poll-secret` igual. */
  SALES_POLL_SECRET?: string;
}

const MP_API = 'https://api.mercadopago.com';

const DEFAULT_ORIGINS = [
  'https://gentlevanguard.github.io',
  'http://127.0.0.1:8080',
  'http://localhost:8080',
];

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const list = allowed.length > 0 ? allowed : DEFAULT_ORIGINS;
  const ok = origin && list.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : list[0] ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-bridge-secret',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function error(msg: string, status = 400, headers: Record<string, string> = {}): Response {
  return json({ ok: false, error: msg }, status, headers);
}

/** Valida el secreto compartido si MP_BRIDGE_SECRET está definido. */
function authorized(req: Request, env: Env): boolean {
  if (!env.MP_BRIDGE_SECRET) return true;
  const header = req.headers.get('x-bridge-secret');
  return header === env.MP_BRIDGE_SECRET;
}

/** Crea una preferencia de Checkout Pro (server-side, token nunca expuesto).
 *  workerOrigin: origen del PROPIO worker (derivado de req.url) — la
 *  notification_url debe apuntar al worker, NO a la landing (bug corregido:
 *  antes usaba backUrl=origen de la landing → MP posteaba el webhook a una
 *  página estática 404 y el CRM jamás se enteraba del pago). */
async function createPreference(env: Env, body: unknown, workerOrigin: string): Promise<Response> {
  if (!env.MP_ACCESS_TOKEN) return error('MP_ACCESS_TOKEN no configurado', 500);
  const b = body as {
    tier?: string;
    title?: string;
    unitPrice?: number;
    currency?: string;
    externalReference?: string;
    backUrl?: string;
  };
  const tier = b.tier || 'producto';
  const title = b.title || 'Gentle-Vanguard Academy';
  const unitPrice = Number(b.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return error('unitPrice inválido');
  }
  const currency = b.currency || 'USD';
  const externalReference =
    b.externalReference || `gv-${tier}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseUrl = (b.backUrl || '').replace(/\/+$/, '');

  const payload: Record<string, unknown> = {
    items: [
      {
        id: `tier-${tier}`,
        title,
        quantity: 1,
        unit_price: unitPrice,
        currency_id: currency,
      },
    ],
    auto_return: 'approved',
    external_reference: externalReference,
    statement_descriptor: 'GENTLE-VANGUARD ACADEMY',
    notification_url: `${workerOrigin}/api/mp/webhook`,
  };
  if (baseUrl) {
    payload.back_urls = {
      success: `${baseUrl}/?mp=success&ref=${encodeURIComponent(externalReference)}`,
      pending: `${baseUrl}/?mp=pending&ref=${encodeURIComponent(externalReference)}`,
      failure: `${baseUrl}/?mp=failure&ref=${encodeURIComponent(externalReference)}`,
    };
  }

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    init_point?: string;
    sandbox_init_point?: string;
    error?: string;
    message?: string;
    cause?: unknown;
  };
  if (!res.ok) {
    // Incluye el detalle completo (código de error MP) para diagnóstico.
    return error(
      JSON.stringify({
        mpStatus: res.status,
        message: data.message ?? data.error ?? `HTTP ${res.status}`,
        cause: data.cause ?? null,
      }),
      res.status,
    );
  }
  return json({
    ok: true,
    preferenceId: data.id,
    initPoint: data.init_point || data.sandbox_init_point,
    externalReference: externalReference,
  });
}

/** Verifica un pago contra la API de MercadoPago (idempotente por payment id). */
async function verifyPayment(env: Env, paymentId: string): Promise<Record<string, unknown> | null> {
  if (!env.MP_ACCESS_TOKEN) return null;
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Notifica la venta al CRM/hoja configurada (best-effort, nunca bloquea).
 *  Si WEBHOOK_SIGNING_SECRET está definido, firma con Standard Webhooks 2026:
 *  firma el BODY EXACTO (no re-serializar) con HMAC-SHA256, headers webhook-id/
 * timestamp/signature. El receptor (CRM) debe verificar con `StandardWebhooks.verify`.
 *  Si NO está definido, envía sin firma (legacy, no recomendado en prod).
 *
 *  SIEMPRE encola la venta en SALES_KV (cola at-least-once): aunque el push
 *  falle o no haya CRM_WEBHOOK_URL, el CRM local la recupera por polling
 *  (/api/mp/sales/pending → ack). Clave: `sale:<paymentId>:<externalRef>`.
 */
async function notifySale(env: Env, sale: Record<string, unknown>): Promise<void> {
  // 1) Encolar en KV (fuente de verdad para los pollers).
  //
  // FAN-OUT POR CONSUMIDOR
  // ----------------------
  // `/api/mp/sales/ack` hace `SALES_KV.delete(key)`: el ack es DESTRUCTIVO y
  // GLOBAL. Con una sola clave `sale:`, un segundo consumidor (hoy el Portal de
  // Cliente, apps/academy-portal) competiría con el CRM y ambos perderían
  // ventas — el que ackeara primero se llevaría la de los dos.
  //
  // Por eso cada consumidor tiene su PROPIA clave y su PROPIO ack. La clave
  // incluye el consumidor, así que borrar la de uno no afecta al otro, y cada
  // uno ve las ventas completas sin que el otro las borre.
  //
  // `crm` conserva el prefijo `sale:` para no cambiar el contrato del poller
  // que ya está en producción; los consumidores nuevos usan `consumer:<id>:`.
  if (env.SALES_KV) {
    const body = JSON.stringify({ ...sale, queuedAt: new Date().toISOString() });
    const ref = sale.externalReference ?? 'noref';
    const paymentId = sale.paymentId;
    // CRM: prefijo histórico, el poller en producción no cambia.
    const keys = [
      `sale:${paymentId}:${ref}`,
      `consumer:portal:${paymentId}:${ref}`,
    ];
    for (const key of keys) {
      try {
        await env.SALES_KV.put(key, body);
      } catch (err) {
        console.error(`[mp-bridge] KV enqueue falló (${key}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  // 2) Push best-effort al CRM (si hay URL configurada).
  if (!env.CRM_WEBHOOK_URL) return;
  const payload = { event: 'mp_sale', ts: new Date().toISOString(), ...sale };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.WEBHOOK_SIGNING_SECRET) {
    try {
      const sw = new StandardWebhooks(env.WEBHOOK_SIGNING_SECRET);
      const id = `mp_sale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ts = Math.floor(Date.now() / 1000);
      headers['webhook-id'] = id;
      headers['webhook-timestamp'] = ts.toString();
      headers['webhook-signature'] = sw.sign(id, ts, body);
    } catch (err) {
      // Firma malformada → no enviar antes que enviar sin firma; abort best-effort.
      console.error(`[mp-bridge] firma webhook inválida: ${err instanceof Error ? err.message : err}`);
      return;
    }
  }
  try {
    await fetch(env.CRM_WEBHOOK_URL, { method: 'POST', headers, body });
  } catch {
    /* best-effort */
  }
}

/** Autorización del poller: header `x-poll-secret` si SALES_POLL_SECRET está seteado. */
function pollAuthorized(req: Request, env: Env): boolean {
  if (!env.SALES_POLL_SECRET) return true; // sin secret → abierto (solo lectura de cola)
  return req.headers.get('x-poll-secret') === env.SALES_POLL_SECRET;
}

/**
 * Prefijo de los certificados reflejados en KV por el Portal de Cliente.
 *
 * Separate de la cola de ventas (`sale:` / `consumer:portal:`) a proposito:
 * los certificados no se consumen, se consultan, y mezclarlos haria que un
 * barrido de la cola los borrara.
 */
const CERT_PREFIX = 'cert:';

/**
 * Espejo de certificados — lo escribe el Portal de Cliente.
 *
 * El Portal corre en loopback (ADR-0017) asi que su SQLite no es alcanzable
 * desde internet: un tercero no podria verificar un certificado emitido en una
 * maquina. Al emitir, el Portal refleja aqui una COPIA minima (lo minimo
 * para verificar) y este endpoint lo sirve sin sesion.
 *
 * Lo que NO se copia: email, id del estudiante, score. El nombre va enmascarado
 * aca tambien — un store publico con el nombre completo de una persona es un
 * problema de privacidad, no un atajo.
 */
interface MirroredCertificate {
  code: string;
  courseTitle: string;
  /** Ya enmascarado ("Ana M. L."). */
  studentName: string;
  issuedAt: string;
  /** 1 = revocado. Un certificado revocado se marca, no se borra: borrar lo
   *  haria que un codigo revocado volviera "no existe" en vez de "revocado". */
  revoked: boolean;
  verified: number;
}

async function handleCertMirror(req: Request, env: Env): Promise<Response> {
  if (!env.SALES_KV) return error('SALES_KV no configurado', 503);
  // Reusa la auth de la cola: mismo secreto, misma razon (es el Portal).
  if (!pollAuthorized(req, env)) return error('no autorizado', 401);

  let body: Partial<MirroredCertificate>;
  try {
    body = (await req.json()) as Partial<MirroredCertificate>;
  } catch {
    return error('JSON invalido', 400);
  }

  const code = typeof body.code === 'string' ? body.code.replace(/[^0-9A-Z]/gi, '').toUpperCase() : '';
  if (code.length !== 24) return error('code requerido (24 caracteres normalizados)', 400);
  if (typeof body.courseTitle !== 'string' || !body.courseTitle.trim()) {
    return error('courseTitle requerido', 400);
  }
  if (typeof body.studentName !== 'string' || !body.studentName.trim()) {
    return error('studentName requerido', 400);
  }

  const record: MirroredCertificate = {
    code,
    courseTitle: body.courseTitle.trim().slice(0, 200),
    studentName: body.studentName.trim().slice(0, 120),
    issuedAt: typeof body.issuedAt === 'string' ? body.issuedAt : new Date().toISOString(),
    revoked: body.revoked === true,
    verified: 0,
  };

  try {
    // TTL de 2 años: pasado eso el certificado deja de poder verificarse, que
    // es preferible a servir un registro eterno de datos personales.
    await env.SALES_KV.put(`${CERT_PREFIX}${code}`, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 730,
    });
  } catch (err) {
    return error(`KV put fallo: ${err instanceof Error ? err.message : 'error'}`, 500);
  }
  return json({ ok: true, code: record.code, revoked: record.revoked });
}

/**
 * Verificacion PUBLICA de un certificado, sin sesion.
 *
 * Devuelve lo MINIMO: curso, nombre YA enmascarado, fecha, validez. Sin
 * email, sin score, sin id: un endpoint publico es un oraculo y cuanto menos
 * devuelve, menos se puede enumerar.
 */
async function handleCertVerify(req: Request, env: Env, rawCode: string): Promise<Response> {
  if (!env.SALES_KV) return error('SALES_KV no configurado', 503);
  const code = String(rawCode ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // Corrige los confundibles que la gente escribe al transcribir a mano.
    .split('')
    .map((ch) => ({ I: '1', L: '1', O: '0', U: 'V' })[ch] ?? ch)
    .join('');
  if (code.length !== 24) return json({ valid: false, error: 'codigo invalido' }, 400);

  const raw = await env.SALES_KV.get(`${CERT_PREFIX}${code}`);
  if (!raw) return json({ valid: false, error: 'no existe un certificado con ese codigo' }, 404);

  let rec: MirroredCertificate;
  try {
    rec = JSON.parse(raw) as MirroredCertificate;
  } catch {
    return json({ valid: false, error: 'registro corrupto' }, 500);
  }

  // Contador de verificaciones. Best-effort: no se le niega el dato al
  // usuario si falla la escritura. Sirve para detectar un codigo filtrado.
  const verified = (rec.verified ?? 0) + 1;
  env.SALES_KV.put(`${CERT_PREFIX}${code}`, JSON.stringify({ ...rec, verified })).catch(() => {});

  if (rec.revoked) {
    return json({ valid: false, revoked: true, code, error: 'el certificado fue revocado' });
  }
  return json({
    valid: true,
    code,
    courseTitle: rec.courseTitle,
    studentName: rec.studentName,
    issuedAt: rec.issuedAt,
  });
}

/** Prefijos de cola por consumidor. `crm` mantiene su prefijo histórico. */
const QUEUE_PREFIXES = { crm: 'sale:', portal: 'consumer:portal:' } as const;
type QueueConsumer = keyof typeof QUEUE_PREFIXES;

function resolveConsumer(value: string | null): QueueConsumer {
  return value === 'portal' ? 'portal' : 'crm';
}

/**
 * Una clave pertenece al consumidor cuyo prefijo tiene. Nada más: el resto
 * de la clave es `<paymentId>:<externalReference>` y contiene `:`-legítimamente.
 */
function isOwnKey(key: string, prefix: string): boolean {
  return key.startsWith(prefix) && key.length > prefix.length;
}

/** Un consumidor no puede tocar las claves de otro (ni las prefijas de sistema). */
function isForeignKey(key: string, prefix: string): boolean {
  if (key.startsWith(prefix)) return false;
  return key.startsWith('sale:') || key.startsWith('consumer:');
}

/**
 * GET /api/mp/sales/pending — ventas encoladas de un consumidor.
 *
 * `?consumer=crm` (default) o `?consumer=portal`. Cada uno ve su cola
 * completa; ackear una no afecta la del otro.
 */
async function handleSalesPending(req: Request, env: Env): Promise<Response> {
  if (!env.SALES_KV) return error('SALES_KV no configurado', 500);
  if (!pollAuthorized(req, env)) return error('no autorizado', 401);
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') || 50) || 50, 200);
  const consumer = resolveConsumer(url.searchParams.get('consumer'));
  const prefix = QUEUE_PREFIXES[consumer];

  const listed = await env.SALES_KV.list({ prefix });
  const sales: Array<Record<string, unknown>> = [];
  for (const k of listed.keys.slice(0, limit)) {
    if (!isOwnKey(k.name, prefix)) continue;
    const raw = await env.SALES_KV.get(k.name);
    if (raw) {
      try {
        sales.push({ ...JSON.parse(raw), _key: k.name, _consumer: consumer });
      } catch { /* entrada corrupta → se ignora */ }
    }
  }
  return json({ ok: true, consumer, prefix, count: sales.length, sales });
}

/**
 * POST /api/mp/sales/ack — el consumidor confirma procesamiento → se borra DE SU
 * cola. Las claves de otros consumidores se rechazan con 400 en vez de
 * borrarse: sin eso, un bug en un cliente podría vaciarle la cola al otro.
 */
async function handleSalesAck(req: Request, env: Env): Promise<Response> {
  if (!env.SALES_KV) return error('SALES_KV no configurado', 500);
  if (!pollAuthorized(req, env)) return error('no autorizado', 401);
  const body = (await req.json().catch(() => ({}))) as { keys?: string[]; consumer?: string };
  const consumer = resolveConsumer(body.consumer ?? new URL(req.url).searchParams.get('consumer'));
  const prefix = QUEUE_PREFIXES[consumer];

  const requested = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];
  if (requested.length === 0) return error('keys requerido (array de claves de tu cola)', 400);

  // Estricto: TODA clave debe pertenecer a la cola del consumidor. Se
  // distingue el caso de otro consumidor (aislamiento) del resto (basura).
  const foreign = requested.filter((k) => isForeignKey(k, prefix));
  if (foreign.length > 0) {
    return error(
      `rechazadas ${foreign.length} clave(s) de otro consumidor: ${foreign.slice(0, 3).join(', ')}`,
      400,
    );
  }
  const invalid = requested.filter((k) => !isOwnKey(k, prefix));
  if (invalid.length > 0) {
    return error(
      `${invalid.length} clave(s) no pertenecen a la cola '${prefix}' de '${consumer}': ${invalid.slice(0, 3).join(', ')}`,
      400,
    );
  }

  let acked = 0;
  for (const key of requested) {
    try { await env.SALES_KV.delete(key); acked++; } catch { /* best-effort */ }
  }
  return json({ ok: true, acked, consumer, prefix });
}

/** IPN de MercadoPago: verifica el pago y registra la venta. */
async function handleWebhook(req: Request, env: Env): Promise<Response> {
  // Formato nuevo: JSON { type, data: { id } } · Formato legacy: ?topic=payment&id=
  let paymentId: string | null = null;
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { data?: { id?: string | number } };
    paymentId = body.data?.id !== undefined && body.data?.id !== null ? String(body.data.id) : null;
  }
  if (!paymentId) {
    const url = new URL(req.url);
    paymentId = url.searchParams.get('id');
  }
  if (!paymentId) return error('payment id no encontrado', 400);

  const payment = await verifyPayment(env, paymentId);
  if (!payment) return error('no se pudo verificar el pago', 502);

  const status = String(payment.status || '');
  const sale = {
    paymentId,
    status,
    statusDetail: payment.status_detail || null,
    amount: payment.transaction_amount ?? null,
    currency: payment.currency_id || null,
    externalReference: payment.external_reference || null,
    payerEmail: (payment.payer as { email?: string } | undefined)?.email || null,
    paymentMethod: (payment.payment_method_id as string | undefined) || null,
    dateApproved: payment.date_approved || null,
  };

  if (status === 'approved') {
    await notifySale(env, sale);
  }
  // Responder 200 siempre (MercadoPago reintenta si no responde 2xx).
  return json({ ok: true, status, paymentId });
}

async function handlePreference(req: Request, env: Env): Promise<Response> {
  if (!authorized(req, env)) return error('no autorizado', 401);
  const body = await req.json().catch(() => ({}));
  return createPreference(env, body, new URL(req.url).origin);
}

/** Diagnóstico del token MP (sin exponerlo): valida contra /users/me en
 *  AMBOS hosts (api.mercadolibre.com = cuenta/usuario; api.mercadopago.com =
 *  pagos) y reporta el estado. Útil para depurar 403/401 de la API. */
async function handleDiag(env: Env): Promise<Response> {
  if (!env.MP_ACCESS_TOKEN) return error('MP_ACCESS_TOKEN no configurado', 500);
  const hosts = ['https://api.mercadolibre.com', 'https://api.mercadopago.com'];
  const results: Array<Record<string, unknown>> = [];
  for (const host of hosts) {
    const res = await fetch(`${host}/users/me`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    results.push({
      host,
      httpStatus: res.status,
      ok: res.ok,
      user: res.ok
        ? { id: data.id, nickname: data.nickname, siteId: data.site_id, countryId: data.country_id }
        : null,
      error: res.ok ? null : (data.message ?? data.error ?? `HTTP ${res.status}`),
    });
  }
  return json(
    {
      ok: results.some((r) => r.ok),
      tokenPrefix: env.MP_ACCESS_TOKEN.slice(0, 8),
      results,
    },
    200,
    corsHeaders(env, null),
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = corsHeaders(env, origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/api/mp/health') {
        return json(
          { ok: true, hasToken: Boolean(env.MP_ACCESS_TOKEN), hasPublicKey: Boolean(env.MP_PUBLIC_KEY) },
          200,
          cors,
        );
      }
      if (url.pathname === '/api/mp/diag') {
        return handleDiag(env);
      }
      if (url.pathname === '/api/mp/preference' && req.method === 'POST') {
        return handlePreference(req, env);
      }
      if (url.pathname === '/api/mp/webhook' && req.method === 'POST') {
        return handleWebhook(req, env);
      }
      if (url.pathname === '/api/mp/sales/pending' && req.method === 'GET') {
        return handleSalesPending(req, env);
      }
      if (url.pathname === '/api/mp/sales/ack' && req.method === 'POST') {
        return handleSalesAck(req, env);
      }
      // Certificados (espejo del Portal de Cliente). La verificacion es
      // PUBLICA y sin sesion: es lo que hace que el certificado valga para un
      // tercero. El espejo SI exige el secreto de la cola.
      if (url.pathname === '/api/mp/cert/mirror' && req.method === 'POST') {
        return handleCertMirror(req, env);
      }
      // Importante: `mirror` esta reservado para el POST. Si cae aca con GET,
      // responderiamos "codigo invalido" para un codigo de 6 letras que NO es
      // un certificado. Mejor 404 explicito: la URL no existe para GET.
      if (url.pathname.startsWith('/api/mp/cert/') && url.pathname !== '/api/mp/cert/mirror' && req.method === 'GET') {
        return handleCertVerify(req, env, decodeURIComponent(url.pathname.slice('/api/mp/cert/'.length)));
      }
      return error('not found', 404, cors);
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err), 500, cors);
    }
  },
};

// ─── Modo local (dev/tests) ────────────────────────────────────────────────
// `node --import tsx src/mp-bridge/worker.ts` levanta un servidor HTTP local
// con el mismo contrato, para probar sin desplegar.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createServer } = await import('node:http');
  const env: Env = {
    MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
    MP_PUBLIC_KEY: process.env.MP_PUBLIC_KEY,
    MP_BRIDGE_SECRET: process.env.MP_BRIDGE_SECRET,
    CRM_WEBHOOK_URL: process.env.CRM_WEBHOOK_URL,
    WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    SALES_POLL_SECRET: process.env.SALES_POLL_SECRET,
  };
  const handler = (await import('./worker')).default;
  const server = createServer(async (req, res) => {
    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : body,
    });
    const response = await handler.fetch(request, env);
    const headersOut: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersOut[key] = value;
    });
    res.writeHead(response.status, headersOut);
    res.end(await response.text());
  });
  const port = Number(process.env.PORT || 8787);
  server.listen(port, () => {
    console.log(`[mp-bridge] local server on http://127.0.0.1:${port}`);
    console.log(`[mp-bridge] health: http://127.0.0.1:${port}/api/mp/health`);
  });
}