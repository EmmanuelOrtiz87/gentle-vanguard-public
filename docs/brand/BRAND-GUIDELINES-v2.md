# Gentle-Vanguard Academy — Brand Guidelines v2.0

> **Design Evolution: From AI-Generic to Human-Crafted Premium**  
> Version: 2.0.0  
> Date: 2026-09-01  
> Scope: Academy web, all Gentle-Vanguard apps, marketing materials, documentation  
> Decision: `BRAND-DECISION-2026-09-01.md` (v2 Premium + logo v1 = official) · Visual reference:
> Design Hub `apps/design-hub/` (:8095) · Tokens package: `packages/gv-design-system/` v2.0.0
> (official since 2026-09-02)

---

## 1. PHILOSOPHY

### Design Read

**"An educational platform for technical learners, with a dark-tech premium language, leaning toward
refined glassmorphism and intentional micro-interactions that elevate beyond AI defaults through
craft details and meaningful motion."**

### Core Principle

This is not a redesign for the sake of change. It is an **evolution** that:

- Keeps what works (purple→cyan identity, glassmorphism foundation)
- Adds what matters (depth, craft, human intention)
- Removes what feels generic (static glows, default hover states)

### Three Dials (Design Parameters)

| Dial             | Value | Purpose                                   |
| ---------------- | ----- | ----------------------------------------- |
| DESIGN_VARIANCE  | 7/10  | Familiar structure with premium asymmetry |
| MOTION_INTENSITY | 6/10  | Functional motion, not decorative         |
| VISUAL_DENSITY   | 4/10  | Balanced breathing room                   |

---

## 2. COLOR SYSTEM

### 2.1 Background Scale

| Token              | Hex       | RGB          | Usage                                     |
| ------------------ | --------- | ------------ | ----------------------------------------- |
| `--gv-bg`          | `#0F1115` | `15, 17, 21` | Primary background (evolved from #121212) |
| `--gv-bg-elevated` | `#151921` | `21, 25, 33` | Cards, containers                         |
| `--gv-bg-deep`     | `#090C11` | `9, 12, 17`  | Code blocks, inputs, deep surfaces        |

### 2.2 Accent Colors

| Token              | Hex                     | Usage                                   |
| ------------------ | ----------------------- | --------------------------------------- |
| `--gv-cyan`        | `#22d3ee`               | Primary action, links, active states    |
| `--gv-cyan-deep`   | `#0891b2`               | Hover cyan, pressed states              |
| `--gv-cyan-glow`   | `rgba(34,211,238,0.45)` | Glow effects (increased from 0.35)      |
| `--gv-purple`      | `#a78bfa`               | Secondary accent, headings              |
| `--gv-purple-deep` | `#7c3aed`               | Deeper purple states                    |
| `--gv-gold`        | `#fbbf24`               | Premium moments, highlights (sparingly) |

### 2.3 Surface Colors

| Token                 | Hex                      | Usage                                |
| --------------------- | ------------------------ | ------------------------------------ |
| `--gv-surface`        | `#1a1f2a`                | Card backgrounds                     |
| `--gv-surface-raised` | `#252b38`                | Elevated elements: dropdowns, modals |
| `--gv-glass`          | `rgba(26,31,42,0.72)`    | Glassmorphism panels                 |
| `--gv-glass-border`   | `rgba(167,139,250,0.24)` | Glass borders (increased visibility) |

### 2.4 Text Colors

| Token                 | Hex       | Usage                         |
| --------------------- | --------- | ----------------------------- |
| `--gv-text`           | `#e8eef4` | Primary text (warmer than v1) |
| `--gv-text-secondary` | `#c4cdd8` | Secondary text                |
| `--gv-muted`          | `#8b95a8` | Muted text, metadata          |
| `--gv-text-disabled`  | `#5a6370` | Disabled states               |

### 2.5 Gradient Specification

**Primary Gradient (135°):**

```css
background: linear-gradient(
  135deg,
  #a78bfa 0%,
  color-mix(in srgb, #a78bfa 50%, #22d3ee) 50%,
  #22d3ee 100%
);
```

**Use for:** Primary buttons, wordmark "Vanguard", metric numbers, active states

**Glass Gradient (border):**

```css
background: linear-gradient(
  135deg,
  rgba(167, 139, 250, 0.3) 0%,
  rgba(34, 211, 238, 0.15) 50%,
  rgba(167, 139, 250, 0.2) 100%
);
```

---

## 3. TYPOGRAPHY SYSTEM

### 3.1 Font Families

```css
--gv-font-display: 'Space Grotesk', 'Orbitron', sans-serif;
--gv-font-body: 'Inter', 'Inter Variable', system-ui, sans-serif;
--gv-font-mono: 'JetBrains Mono NL', 'JetBrains Mono', monospace;
--gv-font-mono-accent: 'Space Mono', monospace;
```

### 3.2 Type Scale

| Level      | Size   | Weight | Line-Height | Letter-Spacing | Usage                       |
| ---------- | ------ | ------ | ----------- | -------------- | --------------------------- |
| Hero       | 52px   | 700    | 1.05        | -0.03em        | Page heroes                 |
| H1         | 40px   | 700    | 1.1         | -0.02em        | Major sections              |
| H2         | 28px   | 700    | 1.2         | -0.01em        | Section headers             |
| H3         | 22px   | 600    | 1.25        | 0              | Card titles                 |
| Eyebrow    | 11px   | 600    | 1           | 0.2em          | Labels (Space Mono)         |
| Body Large | 17px   | 400    | 1.75        | 0              | Featured paragraphs         |
| Body       | 15.5px | 400    | 1.7         | 0              | Default text                |
| Caption    | 12.5px | 500    | 1.5         | 0.02em         | Meta, captions (Space Mono) |
| Metric     | 32px   | 700    | 1           | 0              | KPI numbers (tabular-nums)  |

### 3.3 Typography Rules

- **Microsoft clarity, not Apple poetry**: Clear hierarchy over expressive
- **Never more than 3 weights per page**
- **Tabular numbers for metrics:** `font-variant-numeric: tabular-nums`
- **Maximum line length:** 70ch for body text

---

## 4. SPATIAL SYSTEM

### 4.1 Spacing Scale (4px base)

| Token        | Value | Usage                       |
| ------------ | ----- | --------------------------- |
| `--space-1`  | 4px   | Icon gaps, button padding Y |
| `--space-2`  | 8px   | Component internal gaps     |
| `--space-3`  | 12px  | Small section gaps          |
| `--space-4`  | 16px  | Default gaps, card padding  |
| `--space-5`  | 20px  | Medium gaps                 |
| `--space-6`  | 24px  | Section gaps                |
| `--space-8`  | 32px  | Large gaps                  |
| `--space-10` | 40px  | Major breaks                |
| `--space-12` | 48px  | Section padding             |
| `--space-16` | 64px  | Between major sections      |
| `--space-24` | 96px  | Hero padding                |

### 4.2 Border Radius Scale

| Token           | Value | Usage                        |
| --------------- | ----- | ---------------------------- |
| `--radius-sm`   | 6px   | Inputs, small elements       |
| `--radius-md`   | 10px  | Icon buttons, chips          |
| `--radius-lg`   | 14px  | Dropdowns, modals            |
| `--radius-xl`   | 20px  | Cards (evolved from 18px)    |
| `--radius-2xl`  | 28px  | Hero cards, feature elements |
| `--radius-pill` | 999px | Buttons, tags                |

---

## 5. COMPONENTS SPECIFICATION

### 5.1 Button Primary v2

```css
.gv-btn-primary-v2 {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 28px;
  border-radius: 999px;
  font-weight: 600;
  font-size: 14px;
  color: #0a0e17;
  background: linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%);
  border: none;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Specular highlight */
.gv-btn-primary-v2::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, transparent 50%);
}

/* Hover effects */
.gv-btn-primary-v2:hover {
  transform: translateY(-2px);
  box-shadow:
    0 10px 40px rgba(34, 211, 238, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}
```

**States:**

- **Default:** Gradient, subtle specular
- **Hover:** Lift +4px, cyan glow, shine animation
- **Active:** Scale 0.98, pressed shadow
- **Focus:** 2px outline + purple glow

### 5.2 Card v2 (Glass Premium)

```css
.gv-card-v2 {
  position: relative;
  padding: 24px;
  border-radius: 20px;
  background: rgba(26, 31, 42, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid transparent;
  background-clip: padding-box;
}

.gv-card-v2::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 20px;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(167, 139, 250, 0.3) 0%,
    rgba(34, 211, 238, 0.15) 50%,
    rgba(167, 139, 250, 0.2) 100%
  );
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
```

### 5.3 Input Fields v2

```css
.gv-input-v2 {
  width: 100%;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(9, 12, 17, 0.8);
  border: 1px solid rgba(139, 149, 168, 0.2);
  color: var(--gv-text);
  font-size: 15px;
  transition: all 0.2s ease;
}

.gv-input-v2:focus {
  border-color: rgba(34, 211, 238, 0.6);
  box-shadow:
    0 0 0 3px rgba(34, 211, 238, 0.1),
    0 0 20px rgba(34, 211, 238, 0.15);
  outline: none;
}
```

---

## 6. BACKGROUND & ATMOSPHERE

### 6.1 Grid Background (Brand Signature)

```css
.gv-grid-bg {
  position: fixed;
  inset: 0;
  z-index: -2;
  background-image:
    /* Main grid - purple */
    linear-gradient(rgba(167, 139, 250, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(167, 139, 250, 0.035) 1px, transparent 1px),
    /* Fine secondary grid - cyan */ linear-gradient(rgba(34, 211, 238, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(34, 211, 238, 0.02) 1px, transparent 1px);
  background-size:
    48px 48px,
    48px 48px,
    16px 16px,
    16px 16px;
  mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 80%);
}
```

### 6.2 Animated Atmosphere Elements

**Glow A (Purple - Upper Right):**

```css
.gv-glow-a {
  width: 600px;
  height: 600px;
  top: -250px;
  right: -150px;
  background: radial-gradient(
    circle,
    rgba(167, 139, 250, 0.18) 0%,
    rgba(167, 139, 250, 0.08) 40%,
    transparent 70%
  );
  filter: blur(60px);
  animation: glowPulseA 8s ease-in-out infinite;
}
```

**Glow B (Cyan - Lower Left):**

```css
.gv-glow-b {
  width: 500px;
  height: 500px;
  bottom: -200px;
  left: -100px;
  background: radial-gradient(
    circle,
    rgba(34, 211, 238, 0.12) 0%,
    rgba(34, 211, 238, 0.05) 40%,
    transparent 70%
  );
  filter: blur(80px);
  animation: glowPulseB 12s ease-in-out infinite;
}
```

### 6.3 Premium Noise Texture

```css
.gv-noise-overlay {
  position: fixed;
  inset: 0;
  z-index: -1;
  opacity: 0.025;
  pointer-events: none;
  background-image: url('data:image/svg+xml,...');
  mix-blend-mode: overlay;
}
```

---

## 7. MOTION SYSTEM

### 7.1 Duration Scale

| Token                | Value | Usage               |
| -------------------- | ----- | ------------------- |
| `--duration-instant` | 100ms | Hover color changes |
| `--duration-fast`    | 180ms | Button interactions |
| `--duration-base`    | 280ms | View transitions    |
| `--duration-slow`    | 400ms | Modals, drawers     |
| `--duration-epic`    | 800ms | Hero reveals        |

### 7.2 Easing Functions

```css
--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
--ease-bounce-subtle: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
```

### 7.3 Micro-interaction Patterns

**Card Hover:**

```css
transform: translateY(-4px) scale(1.01);
box-shadow:
  0 20px 40px rgba(0, 0, 0, 0.4),
  0 0 0 1px rgba(34, 211, 238, 0.1) inset,
  0 0 60px rgba(34, 211, 238, 0.1);
```

**Focus Ring:**

```css
box-shadow:
  0 0 0 2px var(--gv-bg),
  0 0 0 4px var(--gv-cyan);
```

---

## 8. LOGO SYSTEM

### 8.1 Logo Concept: "Connected Vanguard"

The logo evolves from generic circle+arrow to **node-network + forward motion**:

- **G:** Network node with connection points
- **V:** Arrow emerging from network, suggesting forward movement
- **Space:** Path/flow in negative space

### 8.2 Logo Variants

> **ACTUALIZACIÓN 2026-09-01 (decisión del propietario):** el logo oficial es el **monograma v1**
> (mejor visibilidad y lectura) con el gradiente v2 (#A78BFA→#22D3EE). Los archivos `*-v2.svg` de
> esta sección (node-network) quedan como **históricos/no oficiales**. Fuente operativa:
> `assets/logo.svg` (raíz del repo). Ver `BRAND-DECISION-2026-09-01.md`.

| Variant              | File                            | Size     | Usage                 |
| -------------------- | ------------------------------- | -------- | --------------------- |
| Primary (OFICIAL)    | `assets/logo.svg`               | Scalable | Headers, documents    |
| Icon (OFICIAL)       | `assets/logo-icon.svg`          | 16-64px  | Favicon, app icon     |
| Mono light (OFICIAL) | `assets/logo-mono-light.svg`    | Scalable | Single-color on dark  |
| Mono dark (OFICIAL)  | `assets/logo-mono-dark.svg`     | Scalable | Single-color on light |
| Histórico v2 network | `docs/brand/assets/logo-v2.svg` | —        | NO usar (rechazado)   |

### 8.3 Logo Spacing Rules

- **Minimum clear space:** 20% of logo height on all sides
- **Minimum size:** 24px height (web), 12mm (print)
- **Background contrast:** Always use on dark bg #0F1115 or light #FFFFFF

---

## 9. APPLICATIONS

### 9.1 Digital Applications

- Academy web platform
- Dashboard web app
- Analytics web app
- CMS interface
- Command Center

### 9.2 Document Applications

- PDF presentations (landscape 16:9)
- Word document headers
- PowerPoint templates
- GitHub README banners
- Social media assets

### 9.3 Marketing Assets

- Open Graph images (1200×630)
- Twitter/X headers (1500×500)
- LinkedIn banners (1584×396)
- GitHub repo headers (1280×320)

---

## 10. ACCESSIBILITY

### 10.1 Contrast Requirements

| Element            | Minimum Ratio |
| ------------------ | ------------- |
| Body text          | WCAG AA 4.5:1 |
| Large text (>18px) | WCAG AA 3:1   |
| UI components      | WCAG AA 3:1   |

### 10.2 Focus Requirements

- Visible focus indicators on all interactive elements
- 2px minimum focus outline
- Never rely on color alone for state

### 10.3 Motion Requirements

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 11. FILE STRUCTURE

```
docs/brand/v2/
├── BRAND-GUIDELINES-v2.md          # This file
├── TOKENS-v2.JSON                  # Complete token definitions
├── assets/
│   ├── logo-v2.svg                 # Primary logo
│   ├── logo-icon-v2.svg            # Icon variant
│   ├── logo-mono-light-v2.svg      # Monochrome light
│   ├── logo-mono-dark-v2.svg       # Monochrome dark
│   ├── font-recipes.md             # Font pairings
│   └── patterns/
│       ├── grid-pattern.svg
│       ├── glow-presets.svg
│       └── noise-texture.svg
├── components/
│   ├── button-primary.css
│   ├── card-glass.css
│   ├── input-field.css
│   └── nav-tab.css
├── templates/
│   ├── presentation-master.pptx
│   ├── document-header.docx
│   └── social-assets.fig
└── exports/
    ├── academy-theme.css
    ├── tokens-tailwind.js
    └── tokens-figma.json
```

---

## 12. COMPATIBILITY

### 12.1 Multi-Tool Support

This brand system is documented for use across:

- **ChatGPT / Claude / Gemini:** Full markdown + structured tokens
- **Figma / Sketch:** JSON tokens + component specs
- **Adobe CC:** Color swatches + typography specs
- **VS Code / IDEs:** CSS custom properties
- **Build Tools:** Tailwind config, CSS variables, SCSS

### 12.2 Export Formats Available

- JSON (tokens)
- CSS (custom properties)
- SCSS (variables + mixins)
- Tailwind config JS
- Figma Variables JSON
- Adobe ASE (color swatches)

---

## 13. VERSIONING

| Version | Date       | Notes                                         |
| ------- | ---------- | --------------------------------------------- |
| 1.0.0   | 2026-05-18 | Initial guidelines                            |
| 2.0.0   | 2026-09-01 | Evolution to premium, human-crafted aesthetic |
| 2.0.1   | TBD        | Rollout feedback integration                  |

---

## 14. CREDITS & REFERENCES

- **Design Principles:** `ui-taste` skill (Leonxlnx/taste-skill), `frontend-design`
  (anthropics/skills)
- **Brand Philosophy:** Gentle-Vanguard founding principles
- **Typography:** Space Grotesk, Inter, JetBrains Mono

---

_"Good design is as little design as possible. Less, but better."_ — Dieter Rams
