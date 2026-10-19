# Presentations

Material de presentación del stack GentleVanguard. Versión vigente: package.json (4.2.0 al 2026-10-18). Versiones antiguas quedan fuera de
la documentación viva.

> **Nota de alcance**: este material es la documentación oficial de presentación del stack. La ruta
> canónica de instalación y uso vive en [`GETTING-STARTED.md`](../../GETTING-STARTED.md),
> [`docs/OPERATIONS.md`](../OPERATIONS.md) y [`docs/GOVERNANCE-USERS.md`](../GOVERNANCE-USERS.md).
> Métricas verificadas 2026-09-22: watchtower 154 checks / 29 componentes · pipeline de sesión
> 110 steps (32 + 78 lazy) · 191 archivos de test.

## Estado vigente

Revisión visual del 18-10: carruseles inactivos comprobados en los HTML; quedan sólo el script legado sin carga y referencias de contenido a carruseles de redes. Índice con hero vertical, resumen de versión/contadores vigente y prueba en tres idiomas (`npm run docs:presentations:review`). Topbars y footers actuales usan GentleVanguard e icono transparente. Ver [matriz de homologación y límites](../design/10-native-homologation-2026-10-18.md). El contenido histórico técnico todavía requiere la revisión del propietario; el registro de fuentes no lo convierte en información vigente.

Actualización de integración: la campaña ya está en Content Studio (5 contenidos, 10 variantes y 10 medios), sin aprobación ni agenda. Registro de **25 presentaciones** en `presentation-register.json`; `docs:presentations:sync` actualiza clasificación, fuentes y resúmenes desde Stack Facts, y `docs:presentations:check` detecta drift. Marketing conserva hipótesis previas en un disclosure histórico cerrado; no son resultados/servicios aprobados. `STACK-FACTS-BRIEF.md` ya deriva del inventario actual, no del recuento de septiembre.

Los scripts de las herramientas documentales Image/Video Studio recuperaron sus indicadores de canvas/resolución y reflow móvil; el visor Markdown resuelve imágenes/enlaces respecto al documento de origen. Estas correcciones de apertura no acreditan todas las funciones de exportación, proveedores o conectores. La operación de contenidos real sigue en `apps/content-cms`.

`npm run docs:presence:verify` recorre las 25 páginas del registro, dos anchos y ambos temas (100 casos): tokens renderizados, fuentes, cabecera/footer compartidos, ausencia de carteles/carruseles, errores JS/HTTP y lectura móvil. El visor de contratos apila paneles en móvil; Recursos incorpora navegación de secciones desplegable. No certifica todas las acciones ni traducciones. `docs:presence:check` y `docs:presentations:check` quedaron incorporados al job de identidad de CI; su ejecución remota depende del siguiente push del workspace. No se afirmó una corrida de Actions para estos cambios locales.

[Web, marca y difusión](public-presence.html) reúne avances, evidencias y pendientes. Fuente: [ficha de estado](../status/PRESENCIA-PUBLICA-Y-DISENO.md). `npm run docs:presence:sync` genera HTML, accesos y snapshots canónicos; `npm run docs:presence:check` detecta drift. La web está publicada; la campaña está en revisión.

## Contenido

- [index.html](index.html) — landing principal: arquitectura, componentes, autonomía, data layer,
  executive systems, feature matrix
- [architecture.html](architecture.html) — arquitectura en 6 capas, 16 DAOs, pipeline de sesión,
  optimizaciones de rendimiento
- [autonomy.html](autonomy.html) — sistemas autónomos: executive loop, auto-apply, circuit breaker
- [dashboard.html](dashboard.html) — observabilidad LLM (React/TS/Vite + WebSocket)
- [quickstart.html](quickstart.html) — arranque rápido del stack
- [memory-knowledge.html](memory-knowledge.html) — memoria y conocimiento (Engram, CodeGraph,
  Graphify, Nexus)
- [knowledge-systems.html](knowledge-systems.html) — Obsidian, Engram, Nexus, CodeGraph y Graphify
- [security-governance.html](security-governance.html) — seguridad, gobernanza y normativas
- [agents-pipeline.html](agents-pipeline.html) — 21 agentes especializados + pipeline
- [operations-cloud.html](operations-cloud.html) — operaciones, cloud y CI/CD
- [patterns-conventions.html](patterns-conventions.html) — patrones y convenciones
- [health.html](health.html) — watchtower 154 checks / 29 componentes
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

Las 25 páginas comparten cabecera de Arquitectura, icono transparente, controles de idioma/tema y footer. `presentation-shell.css` vincula los aliases históricos con tokens canónicos, unifica tipografía y corrige paneles móviles sin rediseñar canvases. El registro editorial permanece en JSON: los carteles se eliminan del generador, no se ocultan con CSS. La ficha de estado conserva su cuerpo documental en español aunque comparta navegación multilingüe. Autoridad: [Brand Kit](../brand/BRAND-KIT.md) y [Motion & UX Standard](../design/07-motion-ux-standard.md).

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

- 27 diagramas SVG en 12 páginas, **integrados en las secciones temáticas que los mencionan**
  (con card + caption descriptivo), no apilados al final
- Script de reubicación: `scripts/maintenance/diagrams-in-context.mjs`

## Assets

- `assets/css/gv.css` — composición de documentación; importa tokens/fuentes de `assets/canon/`, snapshots verificados del paquete
- `assets/js/` — i18n (en/es/pt-BR), lightbox, theme-toggle, gv.js (shell canónico)
- `assets/vendor/` — bootstrap.min.css, bootstrap-icons (css+woff2/woff), marked, highlight,
  github-dark (local-first, cero CDN)
- `diagrams/` — 5 diagramas SVG con colores oficiales
- `social-assets/`, `social-templates/` — plantillas sociales
