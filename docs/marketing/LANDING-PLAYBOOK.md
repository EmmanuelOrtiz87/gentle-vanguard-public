# Playbook comercial — Landing de Academy con clientes

> Cómo usar `https://gentlevanguard.github.io/` para captar, registrar y hacer
> seguimiento de clientes. QR listo para imprimir: `docs/marketing/assets/landing-qr.png` (apunta a
> la landing).

## 1. El flujo del cliente (lo que él vive)

1. **Llega** por el link que le compartiste (WhatsApp, email, bio de red social, QR impreso).
2. **Explora** el catálogo por pestañas: Destacados · Cursos · Manuales Premium · Micro-Ebooks ·
   Toolkits (20 cursos, 20 ebooks, 12 toolkits — con precio por tier). Un click por categoría, sin
   scroll infinito.
3. **Contacta por WhatsApp en 1 click desde el producto**: cada tarjeta y plan tiene "💬 Me
   interesa" que abre WhatsApp (**542645452221**) con el mensaje ya escrito ("Hola! Me interesa:
   \<producto\> (precio)") — cero fricción, sin formularios.
4. **Canal email (opcional)**: en la sección "Solicitá el material" hay DOS caminos a elección:
   **WhatsApp directo** o **dejar nombre + email + audiencia** y enviar por email a
   `gentlevanguard@gmail.com`. Nadie está forzado a un solo canal.
5. Si dejó sus datos en el formulario web, quedan en SU dispositivo y —si abre el link desde tu
   máquina— también sincronizan al CRM.

**Regla de oro**: el canal real de captura para tráfico público es **WhatsApp y el email** — el
cliente elige. El botón de cada producto abre WhatsApp directo; el email es la vía formal.

## 2. Cómo difundir la landing

| Canal           | Cómo                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| WhatsApp        | Estado/novedad con el link + QR; mensaje directo: "Mirá esto, contame qué te interesa y te armo propuesta" |
| Email           | Firma de correo con el link; campañas a listas propias                                                     |
| Redes           | Bio de Instagram/LinkedIn/Facebook con el link (Linktree o directo)                                        |
| Impreso         | El QR (`docs/marketing/assets/landing-qr.png`) en flyers, tarjetas, manuales PDF entregados                |
| PDFs de muestra | Los ebooks/toolkits de muestra llevan el link al final                                                     |

**Consejo**: al compartir por WhatsApp, el link genera preview con imagen de marca (og-cover
1200×630). Esperá ~2 segundos a que cargue la vista previa antes de enviar.

## 3. Cuando llega un lead (tu operativo)

**WhatsApp** (el mensaje ya dice producto + nombre + email + audiencia):

1. Abrí **CRM Studio** (`http://127.0.0.1:4791` → command-center → CRM Studio).
2. **Contacts → crear** con los datos del mensaje (audiencia incluida).
3. **Deals → crear** el deal asociado al producto consultado (status `lead` o `contacted`).
4. Respondé por el mismo chat con la propuesta (precio está en el propio mensaje del cliente).

**Email** (llega a gentlevanguard@gmail.com):

1. Mismo registro en CRM (el asunto trae "Academy GV: <producto>").
2. Respondé con la propuesta desde Gmail.

**Leads del formulario web sin WhatsApp/email**: quedan en el dispositivo del visitante (privacidad
del navegador) — no llegan solos al CRM. Por eso el mensaje de cierre de la landing empuja al
contacto directo. Academy ya no captura leads: desde 2026-09-14 es solo material de estudio (sin
precios, sin WhatsApp, sin formularios comerciales).

## 4. Seguimiento (pipeline del CRM)

- `lead → contacted`: al primer mensaje tuyo.
- `contacted → quoted`: cuando enviás propuesta con precio.
- `quoted → sold`: cierre (el CRM sella `close_date` automático).
- `sold → delivered → paid`: entrega del material y pago (`paid_date` automático).
- Cada transición queda auditada en `crm_deal_status_history` (útil para reportes de cierre por
  período: `/api/crm/close-report/{from}/{to}`).

## 5. Mantener la landing viva

| Acción                    | Cómo                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agregar/cambiar productos | Editar manifests en `apps/academy-web/data/` → `node scripts/build-landing.mjs` (desde academy-web)                                                                                                                                              |
| Publicar                  | Copiar `apps/academy-landing/*` al repo de publicación **`gentlevanguard/gentlevanguard.github.io`** (clon local: `C:\Workspace_local\gentlevanguard-pages`) → commit + push a su `main` → Pages deploya por branch (~1 min)                       |
| Ver estado del deploy     | Repo de publicación → **Settings → Pages** (builds por branch: refrescar la URL tras ~1 min)                                                                                                                                                     |
| Cambiar contacto          | `CONTACT` en `build-landing.mjs` (landing) y `data/store/pricing.json` (academy-web)                                                                                                                                                             |
| Cambiar precios           | FUENTE ÚNICA: los precios del CRM (Configuración) son la referencia. Reflejarlos en `resolveTierLabel` (build-landing.mjs) y `data/store/pricing.json`. Los links de MercadoPago se crean a mano con el mismo precio (en ARS al cambio del día). |

> **Migración 2026-09-14:** la landing canónica vive ahora en `https://gentlevanguard.github.io/`
> (repo público `gentlevanguard/gentlevanguard.github.io`, cuenta de marca — sin "emmanuelortiz87"
> en la URL). El deploy es por branch (sin Actions). La URL vieja
> (`emmanuelortiz87.github.io/gentle-vanguard/`) queda de espejo mientras se difunde la nueva;
> el QR de `docs/marketing/assets/landing-qr.png` ya apunta a la nueva.

## 6. Flujo de pago y entrega (post-venta)

1. **Aviso de pago**: MercadoPago te avisa por mail/app cuando acreditan un pago. El link de pago
   identifica el producto (ej. "Toolkit").
2. **Registrar en el CRM**: abrir el deal del cliente → transición a **paid** (sella la fecha).
3. **Entrega**: la tarjeta del deal en "Cobrados" muestra el **📦 checklist de entrega** con los
   pasos por tipo de producto (exportar PDFs desde Academy → enviar por WhatsApp/email).
4. **Cerrar**: transición a **delivered** cuando el cliente confirma recepción.

## 7. Métricas — las 3 capas

**Capa 1 — Interés (gratis, ya instrumentado, falta activar el receptor)**

La landing ya emite eventos (`track()`): click en "Me interesa" de cada producto (`product_wa`),
selección de plan (`plan_interest`), apertura de WhatsApp (`whatsapp_open`), envío de formulario
(`form_lead` con nombre/email/audiencia) y navegación por pestañas (`tab_view`). Llegan a un
**Google Sheet** vía Apps Script:

1. Crear un Google Sheet → Extensiones → Apps Script → pegar
   `docs/marketing/captura-leads-apps-script.gs` → Deploy como Web app (acceso: Anyone) → copiar la
   URL.
2. Pegar esa URL en `TRACK_URL` (generador `build-landing.mjs`) → regenerar + deploy.

Desde ese momento la hoja "Leads" muestra en vivo: qué productos generan interés, cuántos
formularios llegan y los datos de contacto — **aunque el cliente no envíe el WhatsApp**.

**Capa 2 — Contactos y conversión (CRM)**

Cuando el cliente escribe por WhatsApp o email: cargarlo en CRM Studio (contacto + deal). El
pipeline (`lead → contacted → quoted → sold → paid`) y el reporte de cierre por período
(`GET /api/crm/close-report/{desde}/{hasta}`) dan la métrica de negocio: leads contactados,
propuestas, ventas e ingresos.

**Capa 3 — Tráfico del sitio (opcional, requiere cuenta externa)**

Visitas, origen y dispositivo: Cloudflare Web Analytics (gratis, un `<script>`) o GoatCounter. Se
agrega el snippet al generador cuando se active.

## 8. Próximas mejoras sugeridas (no bloqueantes)

- **Dominio propio** (ej. `academy.tudominio.com`): más profesional y estable ante cambios de
  usuario de GitHub. Guía completa: `docs/marketing/DOMINIO-PROPIO-GUIA.md`.
- **Testimonios**: sección social-proof con 2-3 casos reales.
- **Checkout real**: hoy el cierre es manual por WhatsApp; un botón de pago (MercadoPago Payment
  Link por producto, en ARS) eliminaría fricción. Los links que generes se conectan a cada card
  junto al price-tag.
