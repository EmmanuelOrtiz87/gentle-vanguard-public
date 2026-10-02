# DESIGN-WAIVER — academy-landing

> Registrado conforme a `rules/NORMATIVA-DESIGN-SYSTEM.md` §4.13 y
> `docs/brand/DESIGN-DECISIONS-LOG.md` (DD-20261002-03, cierre de O-2).

## Excepción

**Estructura propia (sin shell GV)** en la landing pública (`apps/academy-landing/`): no usa
`gv-topbar`/`gv-view-tabs`/`gv-footer` del shell canónico; tiene layout de conversión propio.

## Razón

Es la **cara pública de conversión** (sync a `gentlevanguard.github.io`): el patrón de landing de
conversión (hero, secciones de oferta, CTAs, catálogo) tiene su propia arquitectura de lectura y
no debe cargar el shell de "app" (tabs, i18n switch, tema). Acoplamiento visual mínimo, máxima
libertad de conversión.

## Alcance del waiver

- **Estructura**: propia (waiver).
- **Tokens/colores**: canon v2.1.0 alineado (bg `#0B1020`, cyan `#06B6D4`, violeta `#8B5CF6`).
- **Tipografía**: canónica Poppins/Inter/JetBrains Mono self-host (`gv-fonts.css` local, O-1).
- **Marca**: logo canon byte-idéntico + favicon canon SVG (`/favicon.svg`); sin `.ico` como
  primario.
- Sin i18n switch/tema (página es-AR por diseño).

## Vigencia

Desde 2026-10-01. Si la landing pasa a ser producto con estado (portal logueado), re-evaluar
migración completa al shell.
