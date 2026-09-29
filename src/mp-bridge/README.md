# MercadoPago Checkout Bridge (P0-#2)

Puente serverless entre la landing estática (GitHub Pages) y la API de
MercadoPago. Reemplaza los links `mpago.la` (redirect plano, sin webhook, sin
entrega automática) por **Checkout Pro con preferencias server-side + Wallet
Brick embebido + webhook de pago** que registra la venta.

## Por qué un bridge

La landing es 100% estática (GitHub Pages). Para usar Checkout Pro hace falta:

1. **Crear preferencias server-side** — el ACCESS_TOKEN de MercadoPago nunca
   debe llegar al navegador (cualquiera podría robarlo del HTML).
2. **Recibir webhooks** — MercadoPago notifica el pago a una URL pública; una
   página estática no puede recibirlos.

El bridge resuelve ambos: expone `/api/mp/preference` (crea la preferencia con
el token del lado servidor) y `/api/mp/webhook` (IPN → verifica pago → notifica
la venta al CRM/hoja).

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/mp/preference` | Crea preferencia Checkout Pro. Body: `{ tier, title, unitPrice, currency, externalReference, backUrl }`. Devuelve `{ preferenceId, initPoint, externalReference }`. |
| POST | `/api/mp/webhook` | IPN de MercadoPago (JSON `{ type, data: { id } }` o `?topic=payment&id=`). Verifica el pago y notifica si `status === "approved"`. |
| GET | `/api/mp/health` | Health check: `{ ok, hasToken, hasPublicKey }`. |

## Env vars (secrets)

| Variable | Obligatoria | Descripción |
|---|---|---|
| `MP_ACCESS_TOKEN` | ✅ | Access token de MercadoPago (Panel → Desarrollo → Credenciales). |
| `MP_PUBLIC_KEY` | ✅ | Public key (misma pantalla). Se usa en el Wallet Brick del cliente. |
| `MP_BRIDGE_SECRET` | opcional | Si está definida, `/api/mp/preference` exige header `x-bridge-secret`. Protege contra uso abusivo del endpoint. |
| `CRM_WEBHOOK_URL` | opcional | URL que recibe la venta confirmada (POST JSON `{ event: "mp_sale", paymentId, status, amount, externalReference, payerEmail, ... }`). Ej: el Apps Script de la landing (misma hoja de leads) o un endpoint del CRM. |
| `ALLOWED_ORIGINS` | opcional | CSV de orígenes CORS. Default: `https://gentlevanguard.github.io` + localhost. |

## Activación (operatoria del dueño — un solo comando)

```bash
npm run mp:activate   # flujo interactivo completo desde la raíz del repo
npm run mp:check      # solo diagnóstico: auth CF, secrets configurados, health
```

`mp:activate` hace todo: valida auth de Cloudflare → pide `MP_ACCESS_TOKEN` y
`MP_PUBLIC_KEY` con **entrada oculta** (nada queda en historial de shell ni en
archivos) → valida el formato (`TEST-`/`APP-`) → sube cada secret vía stdin →
`wrangler deploy` → health check del worker → ofrece regenerar la landing con
`MP_BRIDGE_URL`. Requisito único previo: `npx wrangler login` (una vez).
No-interactivo: `MP_ACCESS_TOKEN=… MP_PUBLIC_KEY=… npm run mp:activate`.

### Por qué las credenciales viven en Cloudflare (y no en CRM/landing)

La landing corre en el navegador del COMPRADOR y el worker en la nube — un
worker de Cloudflare **no puede leer** secretos guardados en tu CRM local
(local-first en tu PC, no expuesto a internet). Cargarlas en la landing las
expondría públicamente en el bundle. El diseño correcto (y ya implementado):
credenciales cifradas como **secrets del worker** (persistentes, solo
editables por el dueño vía `mp:activate`/dashboard CF), la landing recibe solo
la URL pública del bridge, y las ventas confirmadas llegan al CRM vía
`CRM_WEBHOOK_URL`. Rotación = re-ejecutar `mp:activate`.

### Equivalente manual (si preferís el dashboard)

```bash
cd src/mp-bridge
npx wrangler login
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_PUBLIC_KEY
npx wrangler secret put CRM_WEBHOOK_URL       # opcional
npx wrangler deploy
```

La URL del worker (`https://gv-mp-bridge.<subdomain>.workers.dev`) se configura
en la landing como `MP_BRIDGE_URL` al regenerar (`mp:activate` lo ofrece solo).

## Modo local (dev/tests)

```bash
MP_ACCESS_TOKEN=... MP_PUBLIC_KEY=... node --import tsx src/mp-bridge/worker.ts
# health: http://127.0.0.1:8787/api/mp/health
```

## Integración con la landing

`apps/academy-web/scripts/build-landing.mjs` acepta `MP_BRIDGE_URL`:

```bash
MP_BRIDGE_URL=https://gv-mp-bridge.<subdomain>.workers.dev node scripts/build-landing.mjs
```

Con `MP_BRIDGE_URL` definido, el modal de checkout:
1. Captura contacto + order bump (flujo existente, sin cambios).
2. `POST {bridge}/api/mp/preference` con el tier/producto → `preferenceId`.
3. Embebe el **Wallet Brick** (`sdk.mercadopago.com/js/v2` + `MP_PUBLIC_KEY`)
   dentro del modal — el pago se procesa sin salir de la página.
4. Fallback: si el bridge no responde, redirige a `init_point` (Checkout Pro
   hosted) — nunca se pierde la venta.

Sin `MP_BRIDGE_URL`, la landing conserva el comportamiento actual (links
`mpago.la`) — la migración es no-destructiva.

## Flujo de venta completo (con bridge)

```
Usuario → click Comprar → modal (contacto + bump)
  → POST /api/mp/preference (server-side, token secreto)
  → Wallet Brick embebido → pago en MercadoPago
  → MercadoPago → POST /api/mp/webhook (IPN)
  → bridge verifica pago (GET /v1/payments/{id})
  → status=approved → ENCOLA en KV (sale:<paymentId>:<externalRef>)  ← fuente de verdad
  → (opcional) push firmado a CRM_WEBHOOK_URL si hay túnel
  → back_url success → landing muestra gracias + bump/upsells
```

## Arquitectura de cola at-least-once (polling — SIN túnel ni dominio)

Adoptada 2026-09-22. El CRM local consume las ventas por **polling** del
worker — cero túneles, cero dominio, sobrevive a reinicios y NAT (el CRM solo
hace requests salientes). Patrón absorbido de `src/posting/queue.ts`.

```
Worker (Cloudflare)                     CRM local (127.0.0.1:4792)
────────────────────                    ──────────────────────────
webhook MP → verifica pago
  → SALES_KV.put(sale:<pid>:<ref>)  ←── GET /api/mp/sales/pending (x-poll-secret)
                                        → firma Standard Webhooks
                                        → POST local /api/webhooks/mp-sale
                                        → deal "paid" (idempotente por ref)
  ←── POST /api/mp/sales/ack ──────    → KV.delete → cola vacía
```

- **Endpoints**: `GET /api/mp/sales/pending` (lista, `?limit=`) y
  `POST /api/mp/sales/ack` (`{keys: ["sale:..."]}`). Auth: header
  `x-poll-secret` = secret `SALES_POLL_SECRET` (mismo valor en el CRM).
- **CRM**: `apps/academy-crm/server/mp-sales-poller.ts` — el server carga
  `.runtime/academy-crm.env` él mismo (launcher-agnóstico: start.sh,
  command-center y arranque manual quedan cubiertos).
- **Idempotencia de punta a punta**: el CRM dedupea por `externalReference`;
  si el ack falla, la venta se re-procesa sin duplicar deals.
- **Latencia**: KV es eventualmente consistente (~60s lag global) — una venta
  tarda hasta ~90s en aparecer en el CRM. Aceptable para el volumen actual.
- **Push por túnel (opcional)**: si `CRM_WEBHOOK_URL` está configurada, el
  worker además pushea firmado — la cola es el fallback confiable.

## Seguridad

- El ACCESS_TOKEN vive solo en el worker (secret de Cloudflare).
- `MP_BRIDGE_SECRET` opcional protege `/api/mp/preference` de abuso.
- El webhook verifica el pago contra la API real (no confía en el payload).
- CORS restringido a los orígenes de la landing.
- Idempotencia: el webhook responde 200 siempre (MercadoPago reintenta si no);

## Troubleshooting (conocimiento absorbido 2026-09-21)

### 403 "At least one policy returned UNAUTHORIZED"

Código MP `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` — la cuenta está bloqueada o
sus API keys revocadas por el Policy Agent de MercadoPago. El token falla en
TODOS los endpoints (incluso `GET /users/me`), no solo en preferencias.

Diagnóstico: `GET {bridge}/api/mp/diag` (prueba `/users/me` en
`api.mercadolibre.com` y `api.mercadopago.com` sin exponer el token).

Causas y soluciones (en orden):
1. **Validación de identidad incompleta** → Perfil MP → completar validación.
2. **Cuenta restringida** → revisar banners de restricción en la cuenta MP.
3. **App sin producto Checkout Pro** → Panel → app → agregar Checkout Pro.
4. **Credenciales de un usuario de prueba** (no de la app) → usar las de
   "Pruebas > Credenciales de prueba" de la APLICACIÓN.
5. **Aislar cuenta vs credenciales**: crear una app NUEVA → copiar sus
   credenciales de prueba → re-ejecutar `mp:activate` → si falla igual, es la
   cuenta → contactar soporte MP citando `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.

### Formatos de credenciales MP 2026

El prefijo YA NO distingue prueba vs producción: las credenciales de prueba
pueden empezar con `APP_USR-` (doc oficial: "el prefijo puede variar según la
solución"). La única forma de saber el tipo es la SECCIÓN del panel de donde se
copiaron ("Pruebas > Credenciales de prueba" vs "Producción > Credenciales de
producción"). `activate.ts` acepta `TEST-`, `APP_USR-` y `APP-`.

### Webhook de MP no llega al CRM

Verificar que `notification_url` de la preferencia apunte al WORKER
(`https://gv-mp-bridge...workers.dev/api/mp/webhook`), no a la landing — bug
corregido 2026-09-21 (antes usaba el `backUrl` de la landing → MP posteaba a
una página estática 404). Test de regresión en `worker.test.ts`.
  la notificación al CRM es best-effort y no bloquea.