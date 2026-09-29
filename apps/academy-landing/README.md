# Academy Landing (pública)

Landing de marketing **estática y autocontenida** para tráfico externo. Es la puerta de entrada
comercial de la Academy fuera de la app: hero con stats, destacados con covers, manuales premium,
micro-ebooks, pricing por tiers y formulario de captura de leads.

## Servir

```bash
./start.sh   # idempotente: python http.server :4174 bind 127.0.0.1, pidfile .runtime/app-academy-landing-http.pid
./stop.sh    # pidfile + fallback por puerto
# Abrir http://127.0.0.1:4174/
```

Registrada en Command Center (`http://127.0.0.1:8090`, app `academy-landing`) con el mismo puerto y
pidfile, por lo que ambas vías conviven.

Alternativas manuales:

```bash
# Desde la raíz del repo (sirve la app directamente):
python -m http.server 4174 --bind 127.0.0.1 --directory apps/academy-landing
```

También funciona con `file://` abriendo `index.html` directamente (los covers son rutas relativas).

## Regenerar

```bash
cd apps/academy-web
node scripts/build-landing.mjs
```

El script lee los manifests de `data/ebooks/`, `data/toolkits/` y `data/courses/` y genera el HTML
con el catálogo embebido + copia los covers SVG de los productos destacados a `covers/`. **Regenerar
después de agregar productos.**

## Captura de leads y contacto (self-contained)

La conversión **no depende del stack**:

1. **Interés**: los botones "Me interesa" (productos) y "Solicitar" (planes) marcan qué quiere el
   prospecto — chip visible en el formulario.
2. **Formulario**: guarda el lead en `localStorage` (siempre) y, si el stack está corriendo, lo
   sincroniza best-effort al dashboard (`/api/academy-leads` vía command-center :8090).
3. **WhatsApp**: al enviar, se compone un mensaje con el interés + datos del prospecto y se abre el
   chat de negocio (`wa.me/message/YHVWXB5AZR4EJ1`). Como los links `wa.me/message/` no aceptan
   prefill, el mensaje viaja **copiado al portapapeles** con instrucción de pegar. Si se configura
   `whatsappPhone` (número internacional sin +) el prefill es directo vía `wa.me/<phone>?text=`.
4. **Email**: botón mailto con asunto y cuerpo pre-cargados — se activa solo cuando hay un email
   real en la config.

**Config de contacto**: objeto `CONTACT` al inicio del `<script>` en el HTML generado — se edita en
el generador (`apps/academy-web/scripts/build-landing.mjs`, variables `whatsappUrl` /
`whatsappPhone` / `email`) y se regenera.

## Catálogo JSON (`catalog.json`)

Export machine-readable del catálogo completo: counts, pricing por tier, y los 52 productos con
metadata (id, título, tipo, páginas, audiencia, links, priceTier). Consumible por integraciones
externas (CRM, checkout, agregadores). Se regenera con el script.

## SEO

La landing incluye Open Graph (og:title/description/image), Twitter Card, JSON-LD
(EducationalOrganization), `og-cover.svg` (1200×630 con marca GV), `sitemap.xml` y `robots.txt`. La
URL del sitemap se configura con la variable de entorno `ACADEMY_LANDING_URL` al regenerar (default:
GitHub Pages).

## Deploy a GitHub Pages

El workflow `.github/workflows/deploy-landing.yml` deploya automáticamente a GitHub Pages cuando hay
cambios en la landing, los datos de Academy o el script generador. Requiere: **Settings → Pages →
Source: GitHub Actions** en el repo.

Para deploy manual: `Actions → Deploy Academy Landing → Run workflow`.

## Estructura

| Archivo                                    | Qué es                                                        |
| :----------------------------------------- | :------------------------------------------------------------ |
| `index.html`                               | Landing generada (NO editar a mano — regenerar con el script) |
| `covers/*.svg`                             | Portadas de los productos destacados (copiadas por el script) |
| `../academy-web/scripts/build-landing.mjs` | Script generador (fuente de verdad del template)              |
