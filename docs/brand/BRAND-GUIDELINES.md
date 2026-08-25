# Gentle-Vanguard Brand Guidelines

> Source of truth: `config/brand.json` | Version 1.0.0 | 2026-05-18

---

## Identity

**Name:** Gentle-Vanguard  
**Display:** `GENTLE-VANGUARD`  
**Tagline:** `ADVANCED TECHNOLOGY SOLUTIONS`  
**CLI Subtitle:** `-- NATIVE AI COGNITIVE DEVELOPMENT ECOSYSTEM --`

---

## Color Palette

| Token          | Hex       | Usage                            |
| -------------- | --------- | -------------------------------- |
| `primary`      | `#00BFFF` | Brand text, UI accents, labels   |
| `primaryLight` | `#4DCFFF` | Logo top, selections, highlights |
| `primaryDark`  | `#0055BB` | Logo bottom gradient             |
| `accent`       | `#A855F7` | Icon/favicon variant (purple)    |
| `accentTeal`   | `#06B6D4` | Icon gradient end                |
| `background`   | `#0D1117` | Primary dark background          |
| `surface`      | `#1A2035` | Cards, panels, header bg         |
| `surfaceIcon`  | `#2A2D3A` | Rounded icon/favicon background  |
| `circuit`      | `#1A3050` | Circuit board pattern lines      |
| `textPrimary`  | `#FFFFFF` | Primary text                     |
| `textBrand`    | `#00BFFF` | Brand name text in banners       |
| `textMuted`    | `#6B7280` | Subtitles, help text             |
| `border`       | `#1E3A5F` | Panel borders                    |
| `success`      | `#22C55E` | Success states                   |
| `warning`      | `#F59E0B` | Warning / override states        |
| `error`        | `#EF4444` | Error states                     |

---

## Gradients

### Logo Primary (main logo, splash screens, docs banners)

- Top: `#4DCFFF` → Bottom: `#0055BB` (vertical)

### Logo Icon (favicon, minimalist icon, GitHub header)

- Start: `#A855F7` → End: `#06B6D4` (diagonal, top-left to bottom-right)

---

## Typography

| Role           | Font                                | Weight | Letter-spacing |
| -------------- | ----------------------------------- | ------ | -------------- |
| Display / Logo | Orbitron, Rajdhani, Share Tech Mono | 700    | 0.1em          |
| Heading        | Inter, Segoe UI                     | 600    | 0.05em         |
| Body           | Inter, Segoe UI                     | 400    | normal         |
| Mono / CLI     | JetBrains Mono, Cascadia Code       | 400    | normal         |

---

## Logo Usage

### Variants

| Variant        | File                                  | Use case                             |
| -------------- | ------------------------------------- | ------------------------------------ |
| Primary logo   | `docs/brand/assets/logo-primary.svg`  | Splash screens, presentations, print |
| Icon / Favicon | `docs/brand/assets/logo-icon.svg`     | App icons, favicons, social avatars  |
| Favicon (32px) | `docs/brand/assets/favicon.svg`       | Browser tab, small contexts          |
| Docs banner    | `docs/brand/assets/banner-docs.svg`   | README, documentation headers        |
| GitHub header  | `docs/brand/assets/banner-github.svg` | GitHub repository header (1280×320)  |

### Rules

- Minimum clear space: 16px around all logo variants
- Do not change logo colors outside of the two defined gradients
- Do not stretch, rotate, or add effects beyond the defined glow
- On light backgrounds, use the `surface` (`#1A2035`) or `surfaceIcon` (`#2A2D3A`) background behind
  the logo
- Preferred background: `#0D1117` (dark)

---

## Social Media Dimensions

| Platform          | Size     | Asset                 |
| ----------------- | -------- | --------------------- |
| Open Graph / Meta | 1200×630 | `banner-og.svg`       |
| GitHub Header     | 1280×320 | `banner-github.svg`   |
| LinkedIn Banner   | 1584×396 | `banner-linkedin.svg` |
| Twitter/X Header  | 1500×500 | `banner-twitter.svg`  |

---

## CLI / TUI Color Application

The TUI (`model-router-tui`) and all CLI scripts use the brand palette:

```
titleStyle    → #00BFFF (primary)
headerStyle   → #FFFFFF on #1A2035 (surface)
selectedStyle → #4DCFFF (primaryLight)
defaultStyle  → #6B7280 (textMuted)
overrideStyle → #F59E0B (warning)
errorStyle    → #EF4444 (error)
successStyle  → #22C55E (success)
helpStyle     → #6B7280 (textMuted)
labelStyle    → #00BFFF (primary)
bannerColor   → #00BFFF (cyan in Write-Host / echo)
```

---

## Background Pattern

All brand assets use a subtle **circuit board pattern** (`#1A3050` on `#0D1117`) as background
texture. The pattern consists of horizontal/vertical lines with small circles at junctions, 80-120px
tile size, ~50-60% opacity.

---

## Assets Directory

```
docs/brand/
├── BRAND-GUIDELINES.md     ← this file
└── assets/
    ├── logo-primary.svg    ← main GV monogram (cyan-blue gradient)
    ├── logo-icon.svg       ← rounded-square icon (purple-teal gradient)
    ├── favicon.svg         ← 32×32 favicon
    ├── banner-docs.svg     ← 900×120 horizontal docs banner
    └── banner-github.svg   ← 1280×320 GitHub repository header
```
