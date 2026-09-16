# Gentle-Vanguard — BRAND KIT (v2 Premium · OFICIAL)

> **Única referencia operacional de la marca del stack.** Este documento es el punto de entrada para
> aplicar la identidad oficial de Gentle-Vanguard en cualquier formato y desde cualquier herramienta
> (agente, IA, modelo, app, documento, presentación).
>
> Last verified: 2026-09-02 · Canonical source: `docs/brand/BRAND-DECISION-2026-09-01.md`

---

## 1. ESTATUS DE MARCA (LEER PRIMERO)

| Variante                                           | Estatus                 | Uso                                              |
| -------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| **v2.0 APPLICATION FINAL (SVG Asset System v2.0)** | ✅ **OFICIAL**          | Usar SIEMPRE (2026-09-08)                        |
| **v2 Premium**                                     | 🗄 SUPERSEDED            | Reemplazada por la v2.0 APPLICATION FINAL        |
| **v3 GV New Identity (SVG Master Pack)**           | 🗄 HISTÓRICO             | Reemplazada por la v2.0 APPLICATION FINAL        |
| Design-system `#121212`/Orbitron (ADR-0026 alpha)  | 🗄 DEPRECADO (histórico) | NO usar para marca nueva                         |
| v3 Kinetic (lime/Outfit)                           | 📦 ARCHIVADO            | NO es marca; solo experimento en Design Hub Labs |

> **OFICIAL (2026-09-08):** La **v2.0 APPLICATION FINAL** (SVG Asset System v2.0) es la identidad
> oficial de Gentle-Vanguard. Monograma GV geométrico integrado y **centrado** (canvas 1024×1024,
> safe area 15-20%). Assets en `assets/brand/gentle-vanguard/v2/`. Ver
> `docs/adr/ADR-0033-nueva-identidad-marca-v3.md`. **Regla de oro:** Todo material nuevo de marca
> (doc, presentación, PDF, PPT, Word, app, banner, logo) usa la paleta y tipografía v2 Premium que
> se detalla abajo.

---

## 2. TOKENS OFICIALES (v2 Premium)

Fuente de verdad técnica: `docs/brand/TOKENS-v2.json`

### 2.1 Color

| Token                            | Hex                                     | Uso                                        |
| -------------------------------- | --------------------------------------- | ------------------------------------------ |
| `--gv-bg`                        | `#0F1115`                               | Fondo principal                            |
| `--gv-bg-deep`                   | `#090C11`                               | Code blocks, inputs, superficies profundas |
| `--gv-surface`                   | `#1a1f2a`                               | Cards, contenedores                        |
| `--gv-surface-raised`            | `#252b38`                               | Dropdowns, modals, elevado                 |
| `--gv-cyan`                      | `#22d3ee`                               | Acento primario, links, foco               |
| `--gv-cyan-deep`                 | `#0891b2`                               | Hover/pressed cyan                         |
| `--gv-cyan-soft`                 | `#67e8f9`                               | Cyan claro                                 |
| `--gv-purple`                    | `#a78bfa`                               | Acento secundario, headings                |
| `--gv-purple-deep`               | `#7c3aed`                               | Purple profundo                            |
| `--gv-purple-soft`               | `#c4b5fd`                               | Purple claro                               |
| `--gv-gold`                      | `#fbbf24`                               | Momentos premium (usar con moderación)     |
| `--gv-text`                      | `#e8eef4`                               | Texto primario                             |
| `--gv-muted`                     | `#c4cdd8`                               | Texto secundario                           |
| `--gv-faint`                     | `#8b95a8`                               | Meta, metadata                             |
| success / warning / error / info | `#4ade80` `#f4bb4f` `#ee6d75` `#22d3ee` | Estados                                    |

### 2.2 Gradient / Glass / Glow

```css
--gv-gradient: linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%);
--gv-glass: rgba(26, 31, 42, 0.72);
--gv-glass-border: rgba(167, 139, 250, 0.24);
--gv-glow: rgba(34, 211, 238, 0.45);
```

### 2.3 Tipografía

| Rol                               | Fuente             |
| --------------------------------- | ------------------ |
| Display (títulos, hero, wordmark) | **Space Grotesk**  |
| Body                              | **Inter**          |
| Mono (código)                     | **JetBrains Mono** |

---

## 3. LOGO E IDENTIFICADORES

| Asset                       | Ruta                                                            |
| --------------------------- | --------------------------------------------------------------- |
| **Logo oficial operativo**  | `assets/logo.svg` (GV monogram v2.0 centrado)                   |
| Logo principal (horizontal) | `assets/brand/gentle-vanguard/v2/svg/logos/logo-horizontal.svg` |
| Icono oficial               | `assets/logo-icon.svg` (app-icon-dark v2.0)                     |
| Mono light                  | `assets/logo-mono-light.svg` (gv-white v2.0)                    |
| Mono dark                   | `assets/logo-mono-dark.svg` (gv-black v2.0)                     |
| Favicon                     | `docs/brand/assets/favicon.svg`                                 |
| Banner GitHub               | `docs/brand/assets/banner-github.svg`                           |
| Banner LinkedIn             | `docs/brand/assets/banner-linkedin.svg`                         |
| Banner Twitter/X            | `docs/brand/assets/banner-twitter.svg`                          |
| Banner OG (social)          | `docs/brand/assets/banner-og.svg`                               |
| Banner docs                 | `docs/brand/assets/banner-docs.svg`                             |

### Identidad Oficial v2.0 — SVG Asset System v2.0

| Asset                      | Ruta                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| Master gradient (centrado) | `assets/brand/gentle-vanguard/v2/svg/icons/gv-master-gradient.svg` |
| Transparent master         | `assets/brand/gentle-vanguard/v2/svg/icons/gv-transparent.svg`     |
| App icon dark              | `assets/brand/gentle-vanguard/v2/svg/icons/app-icon-dark.svg`      |
| App icon light             | `assets/brand/gentle-vanguard/v2/svg/icons/app-icon-light.svg`     |
| App icon gradient          | `assets/brand/gentle-vanguard/v2/svg/icons/app-icon-gradient.svg`  |
| App icon maskable          | `assets/brand/gentle-vanguard/v2/svg/icons/app-icon-maskable.svg`  |
| Favicon                    | `assets/brand/gentle-vanguard/v2/svg/icons/favicon.svg`            |
| currentColor (CSS)         | `assets/brand/gentle-vanguard/v2/svg/icons/gv-currentColor.svg`    |
| Safari pinned tab          | `assets/brand/gentle-vanguard/v2/svg/icons/safari-pinned-tab.svg`  |
| Logo horizontal            | `assets/brand/gentle-vanguard/v2/svg/logos/logo-horizontal.svg`    |
| Logo vertical              | `assets/brand/gentle-vanguard/v2/svg/logos/logo-vertical.svg`      |
| Manifest                   | `assets/brand/gentle-vanguard/v2/asset-manifest.json`              |
| Tokens                     | `assets/brand/gentle-vanguard/v2/brand.tokens.json`                |
| Documentación              | `assets/brand/gentle-vanguard/v2/GENTLE_VANGUARD_ASSETS.md`        |

**Paleta oficial v2.0:**

| Token           | Hex       | Uso                   |
| --------------- | --------- | --------------------- |
| `gv-midnight`   | `#0B1020` | Fondos principales    |
| `gv-blue`       | `#1E40AF` | Azul tecnológico      |
| `gv-cyan`       | `#06B6D4` | Acentos / acciones    |
| `gv-violet`     | `#8B5CF6` | Identidad / acentos   |
| `gv-soft-white` | `#F8FAFC` | Fondos claros         |
| `gv-black`      | `#050A14` | Versión monocromática |

**Gradiente oficial v2.0:** `#6E4DEB → #7B63E8 → #06B6D4` (diagonal inferior-izquierda →
superior-derecha). Canvas 1024×1024, símbolo centrado, safe area 15-20%.

- Uso navbar/topbar: `<img class="gv-brand-logo">` a **32px**.
- Favicon: **16px** legible.
- Wordmark: "Gentle**Vanguard**" en **Space Grotesk** (parte "Vanguard" con gradiente).
- Versión primaria en dark; usá mono-dark sobre superficies claras y mono-light sobre oscuras.

---

## 4. CONSUMO POR FORMATO

### HTML / Web

- Copiar `docs/presentations/assets/css/gv.css` (ya alineado a v2 Premium) o los tokens CSS del
  punto 2.
- Logo: `<img src="assets/logo.svg" class="gv-brand-logo" style="width:32px;height:32px">`.

### PDF / Impresión

- Privado: fondos `#0F1115` / `#090C11` + texto `#e8eef4` + acentos `#a78bfa`/`#22d3ee`.
- Fuentes: Space Grotesk (títulos) + Inter (body). Usar la versión dark tail para imprimir si
  destino es claro.

### PowerPoint (PPTX / .potx)

- Fondo de diapositiva: `#0F1115`.
- Títulos: Space Grotesk; cuerpo: Inter; código: JetBrains Mono.
- Logo en la esquina superior: `docs/brand/assets/logo-icon-v2.svg`.
- Acento de portada: gradiente `#a78bfa → #22d3ee`.

### Word / Documento

- Fondo: `#ffffff` en impresión, pero acentos y wordmark de marca `#0F1115`/`#a78bfa`/`#22d3ee`.
- Títulos: Space Grotesk; cuerpo: Inter.
- Logo de cabecera: `docs/brand/assets/logo-primary.svg` en claro.

---

## 5. ASOCIADOS / CANON

- **Guidelines completas**: `docs/brand/BRAND-GUIDELINES-v2.md` (14 secciones: color, tipografía,
  spatial, componentes, motion, logo, accesibilidad, versionado).
- **Tokens técnicos**: `docs/brand/TOKENS-v2.json`.
- **Decisión oficial**: `docs/brand/BRAND-DECISION-2026-09-01.md`.
- **Implementación presentations**: `docs/presentations/assets/css/gv.css` (v2 Premium, verificado).

---

## 6. GOTCHAS / REGLAS

1. **El alpha `#121212`/Orbitron está DEPRECADO.** No confundir con v2 Premium (`#0F1115`/Space
   Grotesk).
2. **v3 Kinetic NO es marca** — solo experimento en Design Hub > Labs.
3. Display font es **Space Grotesk** (NO Orbitron ni Rajdhani).
4. Los assets SVG de logo se copian desde `docs/brand/assets/`; `assets/logo.svg` es el logo
   operativo raíz.
5. Para docs/presentations, el `gv.css` ya está alineado; no reintroducir `#121212`/Orbitron.
