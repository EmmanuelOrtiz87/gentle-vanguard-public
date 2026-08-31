# Gentle-Vanguard — UI Standard del Ecosistema (Apps)

> Registro oficial del estandar visual para toda aplicacion del ecosistema Gentle-Vanguard
> (dashboard, academy, analytics, y las que vengan). Version 1.0.0 · 2026-08-28. Fuente de
> referencia viva: `apps/academy-web/style.css` + `apps/academy-web/assets/logo.svg`. Aplicacion de
> referencia implementada: `apps/gv-analytics`.

## Regla de oro

Toda app del ecosistema **nace con esta identidad aplicada**: mismos tokens, misma tipografia,
mismos componentes, mismo logo. La libertad por superficie es de contenido y layout, nunca de
identidad. Este documento es contrato: si una app no cumple, se considera sin branding.

## 1. Tokens de marca (copiar tal cual en `:root`)

```css
:root {
  color-scheme: dark;
  --gv-purple: #a78bfa; /* acento secundario, titulos de seccion */
  --gv-cyan: #22d3ee; /* acento primario, links, foco, datos */
  --gv-cyan-deep: #06b6d4;
  --gv-bg: #121212; /* fondo base */
  --gv-bg-deep: #0a0e17; /* fondo profundo, inputs, code */
  --gv-surface: #1f2937; /* superficie */
  --gv-surface-raised: #273548; /* superficie elevada (menus, dropdowns) */
  --gv-text: #e5e7eb;
  --gv-muted: #9ca3af;
  --gv-glass: rgba(31, 41, 55, 0.6); /* panel glass */
  --gv-glass-border: rgba(167, 139, 250, 0.18);
  --gv-gradient: linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%);
  --gv-glow: rgba(34, 211, 238, 0.35);
  --gv-amber: #f4bb4f; /* warning */
  --gv-red: #ee6d75; /* error / pendiente */
  --gv-green: #4ade80; /* ok */
  --font: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  --header-h: 62px;
}
```

- Prohibido introducir paletas alternativas (verdes, azules off-brand) o fondos claros.
- Sin webfonts externas (local-first): se declara la familia y cae a fallback del OS.

## 2. Logo

- Archivo canonico: `apps/academy-web/assets/logo.svg` (monograma GV, gradiente 135deg
  violeta->cyan). Copiarlo a `public/logo.svg` de la app; nunca redibujar variantes.
- Uso en header: `<img>` de 32px de alto + wordmark `Gentle**Vanguard** <small>AppName</small>`
  donde `Vanguard` lleva `background: var(--gv-gradient)` con background-clip: text.
- Favicon = mismo SVG.

## 3. Fondo y atmosfera

Tres capas fijas en todo body de app:

1. `.grid-bg`: grilla de 48px con lineas violeta/cyan al 4.5%.
2. `.glow-a`: radial violeta 16%, 720px, top -340px right -220px.
3. `.glow-b`: radial cyan 13%, 640px, bottom -320px left -200px.

## 4. Header

- Sticky, `background: rgba(18,18,18,.88)`, `backdrop-filter: blur(14px)`, border-bottom
  `var(--gv-glass-border)`.
- Contenido: brand (logo+wordmark) · nav (links 13.5px/600 muted, hover bg `rgba(31,41,55,.7)`) ·
  status pill (mono, borde 1.5px, punto de estado con glow si ok).
- Mobile: nav colapsa debajo del header con border-top.

## 5. Componentes base

| Componente         | Receta                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Panel/card         | glass + blur(10px) + border glass-border + radius 18px                                               |
| Boton primario     | pill 999px, gradiente, texto `#0a0e17`, hover: translateY(-1px) + shadow `0 8px 30px var(--gv-glow)` |
| Boton fantasma     | pill, border 1.5px `rgba(34,211,238,.5)`, hover bg cyan 8%                                           |
| Inputs/textarea    | bg `rgba(10,14,23,.75)`, border `rgba(156,163,175,.25)`, radius 10-12px, focus cyan 55%              |
| Chips/badges       | pill, uppercase 11-12px/700, gradiente (curso primario) o borde cyan/violeta                         |
| Metricas/stat      | glass card, numero mono 22-26px con gradiente clip-text                                              |
| Dropdown/menu      | `--gv-surface-raised`, border glass-border, radius 14px, shadow `0 20px 60px rgba(0,0,0,.55)`        |
| Scrollbar          | thumb `--gv-surface-raised` radius 8px, hover cyan 40%                                               |
| Animacion de vista | `viewIn` 0.28s (opacity 0->1, translateY 8px->0); respetar `prefers-reduced-motion`                  |
| Hover de filas     | `translateX(3px)` + border cyan 45% (listas tipo lesson-row)                                         |
| Eyebrow            | 12-13px, uppercase, letter-spacing .18-.22em, cyan o violeta, weight 600-700                         |

## 6. Tipografia

| Rol               | Fuente              | Peso    | Nota                              |
| ----------------- | ------------------- | ------- | --------------------------------- |
| Body              | Inter               | 400     | line-height 1.65                  |
| Titulos           | Inter               | 800-900 | letter-spacing -0.01em a -0.025em |
| Nav/labels        | Inter               | 600-700 | 13-13.5px                         |
| Datos/mono        | JetBrains Mono      | 600-700 | ids, metricas, metadata, code     |
| Palabra destacada | gradiente clip-text | 800     | keywords de marca                 |

## 7. Semantica de estado

- OK/listo: cyan (con glow en punto de estado).
- Parcial/warning: amber `#f4bb4f`.
- Pendiente/error: red `#ee6d75`.
- Neutro: muted.

## 8. Checklist de homologacion (al crear o auditar una app)

- [ ] `:root` con los tokens exactos de la seccion 1.
- [ ] Logo canonico + wordmark con gradiente en `Vanguard` + sufijo de app en `small`.
- [ ] Capas de fondo grid-bg + glow-a + glow-b.
- [ ] Header sticky con blur y status pill mono.
- [ ] Botones pill gradiente / fantasma cyan; sin botones cuadrados planos.
- [ ] Paneles glass radius 18px con border violeta 18%.
- [ ] Metricas con numero mono en gradiente.
- [ ] Animacion viewIn en cambios de vista; scrollbar custom.
- [ ] Sin colores fuera de la paleta; dark-only.

## 9. Excepciones

El dashboard observabilidad (`apps/web-dashboard`) conserva su tema por superficie hasta su
migracion; toda app **nueva** se rige por este estandar desde el primer commit. Cambios a este
documento = version bump + registro en PROGRESS del repo.
