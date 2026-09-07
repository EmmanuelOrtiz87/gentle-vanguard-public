# Presentations

Material de presentación actual del stack Gentle-Vanguard v4.0.0. Versiones antiguas quedan fuera de
la documentación viva.

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
- [health.html](health.html) — watchtower 96 checks / 22 componentes
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

Todas las páginas usan el design system oficial v2.0 (`assets/css/gv.css`), alineado con
`packages/gv-design-system/src/tokens/tokens.json` (v2.0.0-alpha.1, ADR-0026) y la decisión de marca
oficial (`docs/brand/BRAND-DECISION-2026-09-01.md` — v2 Premium; v3 Kinetic archivada):

- Paleta: `#a78bfa` (purple) / `#22d3ee` (cyan) / `#121212` (bg)
- Gradiente oficial: `linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%)`
- Tipografía: Orbitron (display) / Inter (body) / JetBrains Mono (mono)
- Logo oficial: `assets/logo.svg` (monograma v1 con gradiente v2 — v2.1)

## Assets

- `assets/css/gv.css` — design system compartido (tokens oficiales v2.0)
- `assets/js/` — i18n (en/es/pt-BR), carousel, lightbox, theme-toggle
- `diagrams/` — 5 diagramas SVG con colores oficiales
- `social-assets/`, `social-templates/` — plantillas sociales
