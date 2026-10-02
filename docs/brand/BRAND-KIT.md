# Gentle-Vanguard — BRAND KIT (v2.0 APPLICATION FINAL · OFICIAL ÚNICA)

> **Única referencia operacional de la marca del stack.** Punto de entrada para aplicar la
> identidad oficial de Gentle-Vanguard en cualquier formato y desde cualquier herramienta (agente,
> IA, modelo, app, documento, presentación).
>
> Last verified: 2026-10-01 · Canonical source: `docs/adr/ADR-0033-nueva-identidad-marca-v3.md`
> (accepted 2026-09-08) · Tokens SoT: `docs/brand/TOKENS-v2.json` (v2.1.0) · Decisiones:
> `docs/brand/DESIGN-DECISIONS-LOG.md`

---

## 1. ESTATUS DE MARCA (LEER PRIMERO)

| Variante | Estatus | Uso |
| --- | --- | --- |
| **v2.1.0 — v2.0 APPLICATION FINAL (SVG Asset System v2.0)** | ✅ **OFICIAL — ÚNICA** | Usar SIEMPRE |
| v2 Premium (`#0F1115`/`#a78bfa`/`#22d3ee`, Space Grotesk) | 🗄 SUPERSEDED (2026-09-08) | NO usar |
| v3 GV New Identity (SVG Master Pack) | 🗄 HISTÓRICO | NO usar |
| Primer set v3 (SVG NEW FINAL, canvas 1000×1000) | 🗄 HISTÓRICO | NO usar |
| Design-system `#121212`/Orbitron (ADR-0026 alpha) | 🗄 DEPRECADO (histórico) | NO usar |
| v3 Kinetic (lime/Outfit) | 📦 ARCHIVADO | Solo experimento en Design Hub Labs; NO es marca |
| Tema claro web-dashboard | ⚠️ WAIVER | `apps/web-dashboard/DESIGN-WAIVER.md` (densidad de datos) |
| Estructura propia academy-landing | ⚠️ WAIVER | `apps/academy-landing/DESIGN-WAIVER.md` (página de conversión; tokens/marca canon) |
| Apps de clientes con identidad propia | ⚠️ WAIVER opt-in | `apps/<app>/DESIGN-WAIVER.md`; sin waiver = canon |

---

## 2. TOKENS OFICIALES (v2.1.0)

Fuente de verdad técnica: `docs/brand/TOKENS-v2.json` · CSS del paquete:
`packages/gv-design-system/dist/tokens.css`.

### 2.1 Color

| Token | Hex | Uso |
| --- | --- | --- |
| `--gv-bg` | `#0B1020` | Fondo principal (Midnight Navy) |
| `--gv-bg-elevated` | `#151921` | Cards, contenedores |
| `--gv-bg-deep` | `#090C11` | Code blocks, inputs, superficies profundas |
| `--gv-surface` | `#1a1f2a` | Cards, contenedores |
| `--gv-surface-raised` | `#252b38` | Dropdowns, modals, elevado |
| `--gv-cyan` | `#06B6D4` | **Acento primario**, links, foco |
| `--gv-cyan-deep` | `#0891b2` | Hover/pressed cyan |
| `--gv-cyan-soft` | `#67e8f9` | Cyan claro |
| `--gv-purple` | `#8B5CF6` | **Acento secundario** (Vanguard Violet), headings |
| `--gv-purple-deep` | `#7c3aed` | Purple profundo |
| `--gv-gold` | `#fbbf24` | Momentos premium (usar con moderación) |
| `--gv-text` | `#e8eef4` | Texto primario |
| `--gv-muted` | `#c4cdd8` | Texto secundario |
| `--gv-faint` | `#8b95a8` | Meta, metadata |
| success / warning / error / info | `#4ade80` `#f4bb4f` `#ee6d75` `#22d3ee` | Estados |

### 2.2 Gradient / Glass / Glow

```css
--gv-gradient: linear-gradient(135deg, #6E4DEB 0%, #7B63E8 52%, #06B6D4 100%);
--gv-glass: rgba(26, 31, 42, 0.72);
--gv-glass-border: rgba(167, 139, 250, 0.24);
--gv-glow: rgba(6, 182, 212, 0.45);
```

> El gradiente oficial es **3-stop** (`#6E4DEB → #7B63E8 → #06B6D4`). El 2-stop
> `#a78bfa → #22d3ee` quedó SUPERSEDED con v2 Premium.

### 2.3 Tipografía

| Rol | Fuente |
| --- | --- |
| Display (títulos, hero, wordmark) | **Poppins 700** |
| Body | **Inter** |
| Mono (código) | **JetBrains Mono NL** / JetBrains Mono |
| Mono accent | Space Mono |

**Regla (DD-20261001-05 + DD-20261002-01):** las fuentes son **nativas del stack** —
`@gentle-vanguard/design-system/fonts.css` (12 woff2 OFL self-host en el paquete; snapshot raíz
`assets/gv-fonts.css` + `assets/fonts/` para apps vanilla, servidas como `/gv-fonts.css`).
Prohibido depender de CDN para la UI del stack (offline-first, ADR-0017). Declarar sin cargar = drift.

Tamaños/espaciados/motion: ver `TOKENS-v2.json` (hero 52px, h1 40px, breakpoints 640/768/1024/1280,
easing outExpo).

---

## 3. LOGO E IDENTIFICADORES

| Asset | Ruta |
| --- | --- |
| **Logo oficial operativo (serialización única)** | `assets/logo.svg` |
| Icono oficial | `assets/logo-icon.svg` |
| Mono light | `assets/logo-mono-light.svg` |
| Mono dark | `assets/logo-mono-dark.svg` |
| Favicon canónico | `assets/brand/gentle-vanguard/v2/svg/icons/favicon.svg` |
| Logo horizontal / vertical | `assets/brand/gentle-vanguard/v2/svg/logos/logo-{horizontal,vertical}.svg` |
| App icons (dark/light/gradient/maskable) | `assets/brand/gentle-vanguard/v2/svg/icons/app-icon-*.svg` |
| currentColor (CSS) | `assets/brand/gentle-vanguard/v2/svg/icons/gv-currentColor.svg` |
| Manifest + tokens del set | `assets/brand/gentle-vanguard/v2/asset-manifest.json` |
| Banner GitHub / LinkedIn / X / OG / docs | `docs/brand/assets/banner-*.svg` |

**Identidad oficial v2.0:** monograma GV geométrico integrado y **centrado** (canvas 1024×1024,
safe area 15–20%, marca 800px). Gradiente `#6E4DEB → #7B63E8 → #06B6D4` (diagonal inferior-izq →
superior-der). Paleta de asset: Midnight `#0B1020`, Electric Blue `#1E40AF`, Tech Cyan `#06B6D4`,
Vanguard Violet `#8B5CF6`, Soft White `#F8FAFC`, Black `#050A14`.

**Reglas de uso:**

- Toda copia debe ser **byte-idéntica** al canon (DD-20261001-02). Propagar solo con
  `apps/design-hub/tools/propagate.js` o copia directa del canon; jamás regenerar a mano.
- Uso navbar/topbar: `<img class="gv-brand-logo">` a **32px**. Favicon: **16px** legible.
- Wordmark: "Gentle**Vanguard**" en **Poppins 700** — "Gentle" blanco (`--gv-text`), "Vanguard"
  con gradiente. Versión primaria en dark; `mono-dark` sobre superficies claras, `mono-light`
  sobre oscuras.
- Footer: `.gv-footer-brand` — "Gentle" blanco + "Vanguard" gradiente (misma mecánica del
  wordmark), luego tagline — versión — año.

---

## 4. CONSUMO POR FORMATO

### Apps nativas del stack (obligatorio)

- Tokens: `@gentle-vanguard/design-system` (exports oficiales del paquete) — **no** rutas
  relativas ni legacy congelado (DD-20261001-03/04).
- Shell: `gv-app-shell` + tokens cargados antes de estilos de app; topbar con logo 32px,
  wordmark, nav, i18n (`gv-cc-lang`), tema (`gv-cc-theme`); footer homologado; favicon `/favicon.svg`.
- Nueva UI pasa `npm run conformance --prefix packages/gv-design-system` + `impeccable detect`.

### HTML / Web (materiales)

- Copiar los tokens CSS del punto 2 o `docs/presentations/assets/css/gv.css` (verificar alineación
  antes de reutilizar). Logo: `<img src="assets/logo.svg" class="gv-brand-logo" style="width:32px">`.

### PDF / Impresión

- Fondos `#0B1020` / `#090C11` + texto `#e8eef4` + acentos `#06B6D4`/`#8B5CF6`.
- Fuentes: Poppins (títulos) + Inter (body). Si el destino es claro, usar mono-dark del logo.

### PowerPoint (PPTX / .potx)

- Fondo de diapositiva `#0B1020`. Títulos Poppins 700; cuerpo Inter; código JetBrains Mono.
- Logo esquina superior: `assets/logo-icon.svg`. Acento de portada: gradiente 3-stop
  `#6E4DEB → #7B63E8 → #06B6D4`.

### Word / Documento

- Fondo `#ffffff` en impresión; acentos y wordmark de marca `#0B1020`/`#06B6D4`/`#8B5CF6`.
- Títulos Poppins 700; cuerpo Inter. Logo de cabecera: `logo-horizontal.svg` (variante mono-dark
  en claro).

---

## 5. ASOCIADOS / CANON

- **ADR de marca vigente**: `docs/adr/ADR-0033-nueva-identidad-marca-v3.md`
- **Tokens técnicos**: `docs/brand/TOKENS-v2.json` (v2.1.0)
- **Registro de decisiones**: `docs/brand/DESIGN-DECISIONS-LOG.md`
- **Normativa**: `rules/NORMATIVA-DESIGN-SYSTEM.md`
- **Paquete**: `packages/gv-design-system/` (DESIGN.md para spec de componentes)
- **Auditoría de canon por app**: `docs/design/09-brand-canon-audit-2026-10-01.md`
- Docs históricas (leer solo con contexto): `BRAND-DECISION-2026-09-01.md`,
  `BRAND-GUIDELINES-v2.md` — ambas marcadas SUPERSEDED.

---

## 6. GOTCHAS / REGLAS

1. **El alpha `#121212`/Orbitron está DEPRECADO.** No confundir con el canon.
2. **Space Grotesk ya NO es la display font** (fue de v2 Premium). Hoy: Poppins 700. Space *Mono*
   es otra fuente (mono-accent) — no confundir los nombres.
3. **v3 Kinetic NO es marca** — solo experimento en Design Hub > Labs.
4. Los assets SVG de logo se copian SOLO desde el canon (`assets/logo.svg` o el set v2.0); jamás
   desde `docs/brand/assets/` histórico ni desde otra app.
5. Para docs/presentations, verificar que el CSS reutilizado esté alineado al canon (paleta y
   gradiente 3-stop); no reintroducir `#121212`/Orbitron ni el 2-stop viejo.
6. Cambios de marca → flujo del decision log (§4.3 de la normativa). Jamás editar valores a mano
   en apps.
