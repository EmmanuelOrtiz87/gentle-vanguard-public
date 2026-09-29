# Presentations

Material de presentación actual del stack Gentle-Vanguard v4.0.0. Versiones antiguas quedan fuera de
la documentación viva.

> **Nota de alcance**: este material es la documentación oficial de presentación del stack. La ruta
> canónica de instalación y uso vive en [`GETTING-STARTED.md`](../../GETTING-STARTED.md),
> [`docs/OPERATIONS.md`](../OPERATIONS.md) y [`docs/GOVERNANCE-USERS.md`](../GOVERNANCE-USERS.md).
> Métricas verificadas 2026-09-22: watchtower 154 checks / 29 componentes · pipeline de sesión
> 110 steps (32 + 78 lazy) · 191 archivos de test.

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
- [marketing.html](marketing.html) — marketing del stack
- [md-viewer.html](md-viewer.html) — visor de markdown

## Diseño

Todas las páginas usan el **shell canónico del stack** (homologado con las apps — ADR-0017
local-first, ADR-0026 design system v2.0):

- **Topbar canónica** `.gv-topbar` + `.gv-brand` (logo 32px + wordmark `GentleVanguard`) en 24/24
- **Idioma canónico** `.gv-lang-dropdown` (dropdown oculto-hasta-toggle con ✓) — key `gv-cc-lang`
- **Tema canónico** `.gv-icon-btn.gv-theme-toggle` + `data-theme` en `<html>` — key `gv-cc-theme`
- **Local-first total**: cero CDN — Bootstrap, bootstrap-icons, marked, highlight y github-dark
  vendored en `assets/vendor/` (ADR-0017)
- **Atmósfera canónica**: `.gv-grid-bg` + `.gv-glow-a/b` (sin aurora/grain)
- Paleta: `#a78bfa` (purple) / `#22d3ee` (cyan) / `#0F1115` (bg) / `#e8eef4` (texto)
- Gradiente oficial: `linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%)`
- Tipografía: Space Grotesk (display) / Inter (body) / JetBrains Mono (mono)
- Logo oficial: `assets/logo.svg` (monograma v1 con gradiente v2 — v2.1)
- Sin carouseles: todo el contenido es visible y estático (secciones apiladas con títulos de
  grupo); `carousel.js` ya no se usa en ninguna página

## Internacionalización (i18n)

- **24/24 páginas** con contenido traducido (0 títulos sin `data-i18n` — auditoría
  `scripts/maintenance/content-i18n-audit.mjs`)
- Idiomas: en / es / pt-BR — diccionarios en `assets/js/i18n.js` (160+ keys de contenido)
- Verificación visual: `scripts/maintenance/screenshots-eye.mjs` (Playwright — texto visible real)
- **Bug conocido y corregido**: apóstrofes en strings JS (`won't`) rompen la sintaxis de todo el
  script — SIEMPRE verificar con `new Function()` tras inyectar keys

## Diagramas

- 27 diagramas SVG en 12 páginas, **integrados en las secciones temáticas que los mencionan**
  (con card + caption descriptivo), no apilados al final
- Script de reubicación: `scripts/maintenance/diagrams-in-context.mjs`

## Assets

- `assets/css/gv.css` — design system compartido (tokens oficiales v2.0 + shell canónico)
- `assets/js/` — i18n (en/es/pt-BR), lightbox, theme-toggle, gv.js (shell canónico)
- `assets/vendor/` — bootstrap.min.css, bootstrap-icons (css+woff2/woff), marked, highlight,
  github-dark (local-first, cero CDN)
- `diagrams/` — 5 diagramas SVG con colores oficiales
- `social-assets/`, `social-templates/` — plantillas sociales
