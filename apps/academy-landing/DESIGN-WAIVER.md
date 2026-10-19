# DESIGN-WAIVER — academy-landing

> Registrado conforme a `rules/NORMATIVA-DESIGN-SYSTEM.md` §4.13 y
> `docs/brand/DESIGN-DECISIONS-LOG.md` (DD-20261002-03, cierre de O-2).

## Excepción

**Composición comercial propia** en la landing pública (`apps/academy-landing/`). Desde el
19-10-2026 utiliza cabecera `.gv-topbar`, botones, preferencias de tema y snapshots canónicos
del shell, tokens y fuentes. Conserva una estructura de catálogo/conversión, no el tablero
de navegación de una app operativa.

## Razón

Es la **cara pública de conversión** (ruta `gentlevanguard.github.io/academy/`): el patrón de landing de
conversión (hero, secciones de oferta, CTAs, catálogo) tiene su propia arquitectura de lectura y
usa la identidad y las primitivas compartidas sin forzar una composición de aplicación interna.

## Alcance del waiver

- **Estructura**: propia (waiver).
- **Tokens/colores**: canon v2.1.0 alineado (bg `#0B1020`, cyan `#06B6D4`, violeta `#8B5CF6`).
- **Tipografía**: canónica Poppins/Inter/JetBrains Mono self-host (`gv-fonts.css` local, O-1).
- **Marca**: logo canon byte-idéntico + favicon canon SVG (`/favicon.svg`); sin `.ico` como
  primario.
- Tema claro/oscuro con `gv-cc-theme`; sin selector de idioma (contenido es-AR por diseño).
- Retorno a la empresa como botón, navegación móvil y back-to-top inferior derecho.
- `design:surfaces:check/sync` incluye los snapshots de Academy para impedir drift.

## Vigencia

Desde 2026-10-01. Si la landing pasa a ser producto con estado (portal logueado), re-evaluar
migración completa al shell.
