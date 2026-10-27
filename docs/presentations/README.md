# Presentations

Material de presentación del stack GentleVanguard. Versión vigente: package.json (4.3.0 al 2026-10-20). Versiones antiguas quedan fuera de
la documentación viva.

> **Nota de alcance**: este material es la documentación de presentación del stack. La ruta canónica
> de instalación y uso vive en [`GETTING-STARTED.md`](../../GETTING-STARTED.md),
> [`docs/OPERATIONS.md`](../OPERATIONS.md) y [`docs/GOVERNANCE-USERS.md`](../GOVERNANCE-USERS.md).
> No usar conteos de salud, pruebas o pasos como valores permanentes: consultar evidencia fechada y
> ejecutar los checks actuales antes de cada decisión de entrega.

## Estado vigente

Actualización editorial del 20-10: navegación de diagramas centralizada en esta galería, con 10 SVG accesibles y secciones de galería repetidas retiradas de las páginas temáticas. Se conservan sólo gráficos contextuales que explican su contenido. `docs:presentations:check` detecta drift del registro y del shell; no certifica por sí solo hechos históricos, todas las traducciones ni la funcionalidad de las herramientas.

El registro mantiene **26 páginas** (incluida esta galería). `docs:presentations:sync` actualiza clasificación, fuentes y resúmenes desde Stack Facts; `docs:presentations:check` detecta drift. Marketing conserva hipótesis previas en un disclosure histórico cerrado; no son resultados ni servicios aprobados.

Las páginas con cifras o afirmaciones de capacidad heredadas muestran una advertencia traducida (EN/ES/PT-BR): esos valores no representan verificación actual. Se marca explícitamente el contenido cuantificado de 19 páginas; esto no certifica la vigencia de todas las afirmaciones ni equivale a una auditoría completa del resto.

Los scripts de las herramientas documentales Image/Video Studio recuperaron sus indicadores de canvas/resolución y reflow móvil; el visor Markdown resuelve imágenes/enlaces respecto al documento de origen. Estas correcciones de apertura no acreditan todas las funciones de exportación, proveedores o conectores. La operación de contenidos real sigue en `apps/content-cms`.

`npm run docs:presentations:check` verifica el registro editorial y el shell compartido; `npm run docs:presence:check` verifica la salida de presencia y los snapshots canónicos. Ninguno certifica todas las acciones ni traducciones. La validación hosted no se presume aprobada por checks locales; consultar el estado de CI por separado.

[Web, marca y difusión](public-presence.html) reúne avances, evidencias y pendientes. Fuente: [ficha de estado](../status/PRESENCIA-PUBLICA-Y-DISENO.md). `npm run docs:presence:sync` genera HTML, accesos y snapshots canónicos; `npm run docs:presence:check` detecta drift. La web está publicada; la campaña está en revisión.

## Contenido

- [index.html](index.html) — landing principal: arquitectura, componentes, autonomía, data layer,
  executive systems, feature matrix
- [architecture.html](architecture.html) — capas, límites, componentes y optimizaciones
- [autonomy.html](autonomy.html) — sistemas autónomos: executive loop, auto-apply, circuit breaker
- [dashboard.html](dashboard.html) — observabilidad LLM (React/TS/Vite + WebSocket)
- [diagrams.html](diagrams.html) — catálogo central de 10 diagramas técnicos accesibles
- [quickstart.html](quickstart.html) — arranque rápido del stack
- [memory-knowledge.html](memory-knowledge.html) — memoria y conocimiento (Engram, CodeGraph,
  Graphify, Nexus)
- [knowledge-systems.html](knowledge-systems.html) — Obsidian, Engram, Nexus, CodeGraph y Graphify
- [security-governance.html](security-governance.html) — seguridad, gobernanza y normativas
- [agents-pipeline.html](agents-pipeline.html) — perfiles de agentes y pipeline
- [operations-cloud.html](operations-cloud.html) — operaciones, cloud y CI/CD
- [patterns-conventions.html](patterns-conventions.html) — patrones y convenciones
- [health.html](health.html) — comandos y evidencia de health; ejecutar para obtener estado actual
- [commands.html](commands.html) — comandos CLI del stack
- [glossary.html](glossary.html) — glosario de términos
- [study-material.html](study-material.html) — material de estudio
- [v4-features.html](v4-features.html) — características de la v4.0
- [resources-index.html](resources-index.html) — índice de recursos / CMS dashboard
- [case-study-before-after.html](case-study-before-after.html) — caso comparativo reproducible,
  fuentes y límites
- [contract-viewer.html](contract-viewer.html) — visor de contratos SDD
- [image-studio.html](image-studio.html) — estudio de imágenes
- [video-studio.html](video-studio.html) — estudio de video
- [social-post.html](social-post.html) — generador de posts sociales
- [marketing.html](marketing.html) — referencia legacy, con acceso al estado vigente; sus hipótesis de SaaS/ROI no son hechos actuales
- [md-viewer.html](md-viewer.html) — visor de markdown

## Diseño

Las 26 páginas comparten cabecera de Arquitectura, icono transparente, controles de idioma/tema y footer. `presentation-shell.css` vincula los aliases históricos con tokens canónicos, unifica tipografía y corrige paneles móviles sin rediseñar canvases. El registro editorial permanece en JSON: los carteles se eliminan del generador, no se ocultan con CSS. La ficha de estado conserva su cuerpo documental en español aunque comparta navegación multilingüe. Autoridad: [Brand Kit](../brand/BRAND-KIT.md) y [Motion & UX Standard](../design/07-motion-ux-standard.md).

Convenciones existentes, a verificar por superficie:

- **Topbar compartido** `.gv-topbar` + `.gv-brand` (logo 32px + wordmark `GentleVanguard`); referencia única: Arquitectura
- **Idioma de las presentaciones** `.lang-seg` ES/EN/PT (compatible con `pt`/`pt-BR`) — key `gv-cc-lang`
- **Tema canónico** `.gv-icon-btn.gv-theme-toggle` + `data-theme` en `<html>` — key `gv-cc-theme`
- **Local-first total**: cero CDN — Bootstrap, bootstrap-icons, marked, highlight y github-dark
  vendored en `assets/vendor/` (ADR-0017)
- **Atmósfera canónica**: `.gv-grid-bg` + `.gv-glow-a/b` (sin aurora/grain)
- Paleta: navy `#0B1020`, cyan `#06B6D4`, violeta `#8B5CF6`; texto/superficies por token semántico y tema.
- Gradiente oficial: tres paradas `#6E4DEB → #7B63E8 → #06B6D4`.
- Tipografía: Poppins 700 (display), Inter (lectura), fuentes self-hosted en `assets/canon/`.
- Logo: SVG oficial transparente en `assets/canon/icon.svg`; nombre público GentleVanguard unido. Activos antiguos pendientes de revisar por consumo.
- Sin carouseles: todo el contenido es visible y estático (secciones apiladas con títulos de
  grupo); `carousel.js` ya no se usa en ninguna página

## Internacionalización (i18n)

- La auditoría previa de claves i18n no certifica traducción completa del contenido nuevo. La ficha `public-presence.html` es un documento en español.
- Idiomas: en / es / pt-BR — diccionarios en `assets/js/i18n.js` (160+ keys de contenido)
- Verificación visual: `scripts/maintenance/screenshots-eye.mjs` (Playwright — texto visible real)
- **Bug conocido y corregido**: apóstrofes en strings JS (`won't`) rompen la sintaxis de todo el
  script — SIEMPRE verificar con `new Function()` tras inyectar keys

## Diagramas

- 10 SVG actuales en [diagrams.html](diagrams.html), accesibles y con fuentes documentales.
- Las páginas pueden conservar gráficos contextuales; la galería general no se repite en cada una.
- Los datos de Nexus, estimación y gates muestran sus límites o fecha de evidencia.

## Assets

- `assets/css/gv.css` — composición de documentación; importa tokens/fuentes de `assets/canon/`, snapshots verificados del paquete
- `assets/js/` — i18n (en/es/pt-BR), lightbox, theme-toggle, gv.js (shell canónico)
- `assets/vendor/` — bootstrap.min.css, bootstrap-icons (css+woff2/woff), marked, highlight,
  github-dark (local-first, cero CDN)
- `diagrams/` — 10 SVG fuente usados por la galería central
- `social-assets/`, `social-templates/` — plantillas sociales
