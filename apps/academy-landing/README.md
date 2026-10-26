# Academy Landing (pública)

Landing de marketing **estática y autocontenida** para tráfico externo. Es la puerta de entrada
comercial de Academy fuera de la app: portada de aprendizaje, catálogo paginado con portadas,
precio y alcance por ficha, acompañamiento y contacto revisable por WhatsApp/correo.


## Servir y publicar (sitio unificado)

Publicada en https://gentlevanguard.github.io/academy/. La raíz del host es la web corporativa.
Command Center muestra una sola tarjeta **Web GentleVanguard**; el ID `academy-landing` se conserva como alias compatible.
Los launchers `start.sh` y `stop.sh` delegan en el ciclo de vida de corporate-web.
Vista local: http://127.0.0.1:4188/academy/.
Fuente del catálogo: esta carpeta y su generador; no se duplica el catálogo en corporate-web.
Construcción única: `npm run web:prepare`. Validación: `npm run web:check` y `npm run web:verify`.
Publicación única: `npm run web:publish` (`-- --dry-run` sólo prepara y valida).
La exportación excluye scripts, README privados, runtime y launchers.

## Material de la charla

`config/academy-landing.json` controla `talkResourcesEnabled` (booleano). Está en `false`
hasta que se dicte la charla. Oculta sus materiales (`talk` en el manifest), la sección,
el enlace y las entradas del catálogo público; conserva el contenido original en Academy.
Para habilitarlo, cambiar a `true` y ejecutar `npm run web:publish`. La preparación regenera
la landing desde este parámetro y valida el resultado antes de publicar. Para volver a
ocultarlo, cambiar a `false` y publicar. No se controla con parámetros de URL ni localStorage.
Este control de publicación no revoca archivos descargados ni restringe por autenticación
los assets estáticos que ya se habían publicado.

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

Export machine-readable del catálogo completo: counts, pricing por tier, y los 78 productos con
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


## Catálogo · refinamiento del 18-10-2026

Tarjetas compactas con portada, resumen normalizado, precio y compra visibles. Descripción completa en detalle accesible; grilla de 1/2/3/4 columnas. Desde el 19-10-2026 se navega por páginas numeradas con Anterior/Siguiente. Búsqueda y tema filtran la vista seleccionada y su estado se explica junto al control de restablecimiento. El generador y `catalog-card.mjs` conservan esta estructura al regenerar; la presentación normaliza el nombre público sin renombrar slugs o el catálogo fuente. Precios en cada ficha y pack; acompañamiento y alcance usan `landing-sections.mjs`/`offers.css`, sin cambiar tarifas ni política comercial. Diseño y límites: [DESIGN.md](DESIGN.md). Regresión: `npm run web:catalog:verify`. Command Center mantiene una sola entrada pública, Web GentleVanguard, puerto 4188.

### Simplificación y continuidad corporativa · 19-10-2026

La vista inicial contiene los 86 materiales. La búsqueda opera en el tipo seleccionado y el estado visible explica tipo, texto, tema y cantidad. “Ver todo el material” restablece esos criterios y la página. Se retiró el comparador que actuaba como segunda navegación; precio y compra permanecen en las fichas y el pack mantiene una consulta independiente. Cabecera, retorno a la empresa como botón, menú móvil, tema claro/oscuro y back-to-top usan criterios GV. La portada añade arte propio de aprendizaje. Fuentes: `academy-page.mjs`, `academy.css/js`, `catalog.js`; shell/fonts/tokens se verifican con `npm run design:surfaces:check`. El español continúa según el waiver; no se afirma traducción integral ni certificación total de accesibilidad.

Cabecera, marca, icono de tema, cierre y footer comparten ahora `src/web-presence/public-chrome.css` con la web corporativa. El builder unificado carga esa capa después de las composiciones locales: los ajustes compartidos se realizan allí, sin duplicarlos en `academy.css` y `site.css`. `npm run web:chrome:verify` compara el resultado renderizado en cuatro anchos y ambos temas; ejecutar además la QA de catálogo al cambiar controles o márgenes. Evidencia en `.runtime/qa-public-chrome/`.

### Publicación y límites de contacto

`npm run web:gate` valida el export exacto; `web:publish` y la sincronización `--landing` lo exigen antes de enviar archivos. El comprobante externo al sitio se vincula con inventario, bytes y verificadores. Ver `docs/architecture/public-web-release-gate.md`. La QA bloquea escrituras y tráfico a otros orígenes; no genera ventas, contactos ni métricas.

Métricas externas desactivadas por defecto (`LANDING_TRACK_URL` vacío). CRM local sólo con `LANDING_LOCAL_CRM_ENABLED=true` y hostname loopback; la web pública no escribe en el `127.0.0.1` del visitante. Nombre/correo excluidos de eventos de contacto. `MP_BRIDGE_URL=''` desactiva explícitamente el bridge; consultar su health no certifica compra o entrega.
