# Gentle-Vanguard Academy v2.0 — Implementation Guide

> **Quick-start guide for implementing the v2.0 design system** Version: 2.0.0  
> Last updated: 2026-09-01

---

## Quick Start (5 minutes)

### Step 1: Backup Current Files

```bash
cd apps/academy-web
cp style.css style-v1-backup.css
cp index.html index-v1-backup.html
```

### Step 2: Copy New Design Files

```bash
# From project root
cp docs/brand/assets/logo-v2.svg apps/academy-web/assets/logo.svg
cp docs/brand/assets/logo-icon-v2.svg apps/academy-web/assets/logo-icon.svg
```

### Step 3: Update HTML (index.html)

Replace the CSS imports:

```html
<!-- OLD (in <head>) -->
<link rel="stylesheet" href="./gv-design-system.css" />
<link rel="stylesheet" href="style.css" />

<!-- NEW (in <head>) -->
<link rel="stylesheet" href="academy-style-v2.css" />
```

Replace the logo:

```html
<!-- OLD -->
<img src="assets/logo.svg" alt="Gentle-Vanguard" />

<!-- Keep the same path, we've replaced the file -->
<img src="assets/logo.svg" alt="Gentle-Vanguard" />
```

### Step 4: Add v2 Atmosphere Classes

In `<body>`, verify these elements exist (usually already present):

```html
<body>
  <!-- These create the atmosphere -->
  <div class="gv-grid-bg"></div>
  <!-- Grid background -->
  <div class="gv-glow-a"></div>
  <!-- Purple animated glow -->
  <div class="gv-glow-b"></div>
  <!-- Cyan animated glow -->
  <div class="gv-noise-overlay"></div>
  <!-- Subtle film grain -->

  <!-- Your existing content -->
  <header class="gv-topbar">...</header>
  <main id="app">...</main>
</body>
```

### Step 5: Test

```bash
# Start the Academy server (if not running)
cd apps/academy-web
python -m http.server 8080

# Open in browser
# http://localhost:8080
```

---

## Design System Structure

### File Overview

```
apps/academy-web/
├── academy-tokens-v2.css      # Design tokens (imported automatically)
├── academy-atmosphere-v2.css  # Backgrounds, glows, grid
├── academy-components-v2.css  # Buttons, cards, inputs
├── academy-style-v2.css       # Main entry + Academy overrides
├── style-v1-backup.css        # Your backup
└── assets/
    ├── logo.svg               # New logo v2
    └── logo-icon.svg          # Icon variant
```

### CSS Import Chain

```
academy-style-v2.css
├── academy-tokens-v2.css      # Tokens first
├── academy-atmosphere-v2.css  # Then atmosphere
└── academy-components-v2.css  # Then components
    └── Academy-specific styles  # Academy overrides
```

**Important**: Use only `academy-style-v2.css` in your HTML. It imports the others.

---

## Component Usage Guide

### Button Primary v2

```html
<button class="gv-btn-primary-v2">Get Started</button>

<!-- With icon -->
<button class="gv-btn-primary-v2">
  <svg>...</svg>
  <!-- Icon -->
  Get Started
</button>
```

**Features**:

- Gradient background (purple → cyan)
- Specular highlight (top-left)
- Shine sweep on hover
- Lift + glow effect

### Button Secondary

```html
<button class="gv-btn-secondary-v2">Learn More</button>
```

**Features**:

- Pill outline (cyan)
- Subtle fill on hover
- Translates up 1px on hover

### Card v2 (Premium Glass)

```html
<!-- Basic card -->
<div class="gv-card-v2">
  <h3>Card Title</h3>
  <p>Card content...</p>
</div>

<!-- Clickable card (with interactions) -->
<a href="#" class="gv-card-v2 gv-card-clickable">
  <h3>Track Name</h3>
  <p>Description...</p>
</a>
```

**Features**:

- 20px radius (was 18px)
- Gradient border effect
- Shine on hover
- Lift + scale on hover
- Darker shadow

### Card with Badge

```html
<div class="gv-card-v2">
  <div class="badge-row">
    <span class="gv-badge-v2 gv-badge-primary">Course</span>
  </div>
  <h3>Track Name</h3>
  <p>Description...</p>
</div>
```

### Input Field v2

```html
<input type="text" class="gv-input-v2" placeholder="Search..." />

<textarea class="gv-input-v2" placeholder="Description..."></textarea>
```

**Features**:

- Deep background (#090C11)
- Focus glow animation
- Blue focus ring

### Eyebrow Label

```html
<span class="gv-eyebrow">Section Label</span>
<h2>Main Title</h2>
```

**Features**:

- Monospace font (Space Mono)
- Uppercase
- Wide letter-spacing
- Cyan color

### Metric Display

```html
<div class="hstat">
  <div class="n">47</div>
  <div class="l">Modules</div>
</div>
```

**Features**:

- Gradient text
- Tabular numbers
- Monospace label

---

## Token Customization

### Customizing Colors

Edit `academy-tokens-v2.css`:

```css
:root {
  /* Change primary accent */
  --gv-cyan: #00d4ff;

  /* Change purple */
  --gv-purple: #b794f6;

  /* Change background */
  --gv-bg: #0a0c10;
}
```

### Customizing Fonts

The v2 system uses these fonts (fallbacks provided):

1. **Space Grotesk** (Display) — Primary
2. **Inter** (Body) — Available on most systems
3. **JetBrains Mono** (Code) — Available on most dev machines
4. **Space Mono** (Labels) — For eyewear/labels

To use custom fonts, edit tokens:

```css
:root {
  --gv-font-display: 'Your Font', sans-serif;
  --gv-font-body: 'Your Body Font', sans-serif;
}
```

Or load via Google Fonts CDN in `<head>`:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

---

## Migration Guide

### v1 → v2 Changes

| Element           | v1        | v2           | Notes                |
| ----------------- | --------- | ------------ | -------------------- |
| **Background**    | `#121212` | `#0F1115`    | Darker, richer       |
| **Text primary**  | `#e5e7eb` | `#e8eef4`    | Warmer               |
| **Text muted**    | `#9ca3af` | `#8b95a8`    | Cooler               |
| **Card radius**   | 18px      | 20px         | Slightly rounder     |
| **Header height** | 62px      | 64px         | Slightly taller      |
| **Grid mask**     | None      | Radial fade  | Grid fades at edges  |
| **Glows**         | Static    | Animated     | Breathing animations |
| **Shine effect**  | None      | Yes          | Card hover shine     |
| **Noise texture** | None      | 2.5% opacity | Film grain overlay   |

### Common Class Mappings

| v1 Class       | v2 Class               | Notes                            |
| -------------- | ---------------------- | -------------------------------- |
| `.btn-primary` | `.gv-btn-primary-v2`   | New shine effect                 |
| `.btn-ghost`   | `.gv-btn-secondary-v2` | Renamed                          |
| `.track-card`  | `.track-card`          | Adds v2 features automatically   |
| `.lesson-row`  | `.lesson-row`          | Enhanced interactions            |
| `.hstat`       | `.hstat`               | Uses new `.n` and `.l` structure |

### Breaking Changes

1. **CSS imports**: Must use `academy-style-v2.css`
2. **Body classes**: Must include `.gv-grid-bg`, `.gv-glow-a`, `.gv-glow-b`
3. **Font sizing**: Body text is now 15.5px (was 16px)

---

## Browser Support

### Tested & Supported

- **Chrome/Edge**: 90+ ✅
- **Firefox**: 88+ ✅
- **Safari**: 14+ ✅

### Fallbacks Included

- `backdrop-filter` fallback: transparent backgrounds
- `color-mix()` fallback: standard RGB blending
- `font-variant-numeric`: Default to standard numbers

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  /* All animations collapse to instant transitions */
}
```

---

## Performance

### Optimizations Applied

1. **will-change**: Used sparingly on interactive elements
2. **Containment**: CSS containment where appropriate
3. **GPU layers**: transform/opacity only for animations
4. **Font-display**: swap for web fonts

### GPU Usage

The following use GPU:

- Grid background (fixed layer)
- Glow animations (transform + opacity)
- Card hover (transform)
- Button transitions (transform)

### Examples

```css
/* GPU accelerated */
transform: translateY(-4px);
opacity: 0.8;

/* NOT accelerated */
margin-top: -4px;
filter: blur(10px); /* Expensive! */
```

---

## Troubleshooting

### Grid Not Showing

**Problem**: Grid background invisible

**Solution**: Verify `.gv-grid-bg` has `z-index: -2`:

```css
.gv-grid-bg {
  z-index: -2; /* Must be lower than glow-a/b */
}
```

### Glows Too Bright/Dim

**Problem**: Glows look wrong

**Solution**: Adjust opacity in `academy-atmosphere-v2.css`:

```css
.gv-glow-a {
  /* Current: 0.18 opacity in gradient, adjust: */
  background: radial-gradient(
    circle,
    rgba(167, 139, 250, 0.12) 0%,
    /* Reduce for dimmer */ transparent 70%
  );
}
```

### Cards Without Gradient Border

**Problem**: Cards show solid border

**Solution**: Ensure `background-clip: padding-box` is set:

```css
.gv-card-v2 {
  background: var(--gv-glass);
  border: 1px solid transparent; /* Important! */
  background-clip: padding-box; /* Required! */
}
```

### Font Loading Slowly

**Problem**: Text invisible during load

**Solution**: Add `font-display: swap` (already included), or self-host fonts:

```css
@font-face {
  font-family: 'Space Grotesk';
  src: url('/fonts/space-grotesk.woff2') format('woff2');
  font-display: swap;
}
```

---

## Comparison: Before & After

### Hero Section

**v1:**

- Static hero
- Basic gradient text
- Standard cards
- No atmosphere

**v2:**

- Animated underline on "G"
- Grid with fade mask
- Breathing glows
- Shine-effect cards
- Noise texture

### Button

**v1:**

```css
background: linear-gradient(...);
transition: transform 0.12s;
```

**v2:**

```css
background: linear-gradient(...);
/* + Specular highlight (top) */
/* + Shine sweep on hover */
/* + Glow on hover */
/* + Press on active */
```

---

## Next Steps

### Immediate

1. ✅ Implement in Academy
2. ✅ Test all interactive states
3. ✅ Check responsive breakpoints
4. ✅ Verify all animations work

### Short Term

1. 🔲 Update other apps (dashboard, analytics)
2. 🔲 Create social media assets
3. 🔲 Design presentation template

### Long Term

1. 🔲 Tailwind plugin for tokens
2. 🔲 React component library
3. 🔲 Figma design system
4. 🔲 Motion library (Rive/Lottie exports)

---

## Resources

- **Brand Guidelines**: `docs/brand/BRAND-GUIDELINES-v2.md`
- **Tokens JSON**: `docs/brand/TOKENS-v2.json`
- **Logo Files**: `docs/brand/assets/`
- **Current Academy**: `apps/academy-web/`

---

## Credits

- **Design Direction**: Based on `ui-taste` and `frontend-design` skills
- **Typography**: Space Grotesk (display), Inter (body), JetBrains Mono (code)
- **Concept**: "Connected Vanguard" — network + forward motion
- **Philosophy**: Premium, human-crafted, anti-AI-slop

---

## Support

For issues or questions:

1. Check this guide's Troubleshooting section
2. Review brand guidelines for detailed specs
3. Reference tokens file for exact values
4. Check browser console for CSS errors

---

_"Good design is as little design as possible."_ — Dieter Rams

**Version**: 2.0.0  
**Last Updated**: 2026-09-01  
**Status**: Ready for implementation
