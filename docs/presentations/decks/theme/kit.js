/**
 * GentleVanguard Deck Canon — layout kit.
 *
 * Primitives shared by every slide layout. All geometry is derived from GEO so
 * the whole toolkit moves as one system.
 *
 * Rules baked in here:
 *  - canvas is 10 x 5.625in (LAYOUT_16x9); nothing may exceed it
 *  - body text never uses the raw accent on a light surface (accentText variant)
 *  - cards use RECTANGLE (never ROUNDED_RECTANGLE + overlay bar)
 *  - every non-cover slide carries a page-number badge near x 9.3 / y 5.1
 *  - no accent rule under titles (that is the AI-slide hallmark)
 */

import { GEO, FONTS, TYPE, CANON, CANON_LIGHT } from './tokens.js';
import { iconPng } from './icons.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ASSET_GEN = path.resolve(__dirname, '..', 'assets', 'generated');
export const ASSET_DIAGRAMS = path.resolve(__dirname, '..', 'assets', 'diagrams');
export const REPO = path.resolve(__dirname, '..', '..', '..', '..');

export const BRAND_ICON = path.join(REPO, 'assets', 'brand', 'gentle-vanguard', 'v2', 'raster', 'official', 'gv-icon-official.png');
export const BRAND_WORDMARK = path.join(REPO, 'assets', 'brand', 'gentle-vanguard', 'v2', 'raster', 'official', 'gv-wordmark-official.png');
/**
 * The official bitmaps carry a dark plate. BRAND-KIT says to use the transparent
 * canonical SVG when the bitmap shows that plate, and to use the derived
 * transparent wordmark on final surfaces so the mark reads as one with the slide.
 */
export const BRAND_ICON_TRANSPARENT = path.join(ASSET_GEN, 'gv-icon-transparent.png');
export const BRAND_WORDMARK_TRANSPARENT = path.join(
  REPO,
  'assets',
  'brand',
  'gentle-vanguard',
  'v2',
  'raster',
  'official',
  'derived',
  'gv-wordmark-official-transparent.png'
);

/** Fresh option objects every call: PptxGenJS mutates option objects in place. */
export const shadow = (o = {}) => ({
  type: 'outer',
  color: '000000',
  blur: o.blur ?? 10,
  offset: o.offset ?? 2,
  angle: o.angle ?? 90,
  opacity: o.opacity ?? 0.35,
});

export const softShadow = () => shadow({ blur: 14, offset: 3, opacity: 0.28 });

/* ------------------------------------------------------------------ *
 * Slide chrome
 * ------------------------------------------------------------------ */

/**
 * Base slide: background, top brand bar, optional logo, footer and page number.
 */
export function baseSlide(pres, theme, pal, opts = {}) {
  const slide = pres.addSlide();
  const { cover = false, footer = '', section = '' } = opts;

  if (cover) {
    const bg = path.join(ASSET_GEN, pal.isDark ? 'cover-bg.png' : 'cover-bg-light.png');
    if (existsSync(bg)) slide.background = { path: bg };
    else slide.background = { color: pal.bg };
  } else {
    const bg = path.join(ASSET_GEN, pal.isDark ? 'content-bg.png' : 'light-bg.png');
    if (existsSync(bg)) slide.background = { path: bg };
    else slide.background = { color: pal.bg };
  }

  // Full-bleed brand bar at the very top edge (a deliberate brand device, not a title underline).
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: GEO.W,
    h: GEO.topEdge,
    fill: { color: pal.isDark ? CANON.purple : CANON.purpleSoft },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: GEO.W * 0.42,
    y: 0,
    w: GEO.W * 0.58,
    h: GEO.topEdge,
    fill: { color: pal.isDark ? CANON.cyan : CANON_LIGHT.accentText },
  });

  if (!cover) {
    // Official icon, top right (brand rule: 32px).
    const iconPath = existsSync(BRAND_ICON_TRANSPARENT) ? BRAND_ICON_TRANSPARENT : BRAND_ICON;
    if (existsSync(iconPath)) {
      slide.addImage({ path: iconPath, x: GEO.W - GEO.M - 0.34, y: GEO.eyebrowY - 0.03, w: 0.34, h: 0.34, altText: 'GentleVanguard' });
    }
    if (footer) {
      slide.addText(
        [
          { text: 'Gentle', options: { color: pal.isDark ? CANON.text : CANON_LIGHT.text } },
          { text: 'Vanguard', options: { color: pal.accent } },
        ],
        { x: GEO.M, y: GEO.footerY, w: 5.6, h: 0.22, fontFace: FONTS.display, fontSize: 8.5, bold: true, margin: 0, valign: 'middle', charSpacing: 0.2 }
      );
      slide.addText(footer, {
        x: GEO.M + 1.25,
        y: GEO.footerY,
        w: 4.4,
        h: 0.22,
        fontFace: FONTS.body,
        fontSize: 8,
        color: pal.faint,
        margin: 0,
        valign: 'middle',
      });
    }
    if (section) {
      slide.addText(section.toUpperCase(), {
        x: GEO.W - GEO.M - 2.6,
        y: GEO.footerY,
        w: 2.2,
        h: 0.22,
        fontFace: FONTS.body,
        fontSize: 7.5,
        color: pal.faint,
        align: 'right',
        margin: 0,
        valign: 'middle',
        charSpacing: 1.2,
      });
    }
    // Page number badge (skill contract: near x 9.3, y 5.1).
    slide.addText(String(opts.page ?? ''), {
      x: GEO.pageNumX,
      y: GEO.pageNumY,
      w: 0.5,
      h: 0.26,
      fontFace: FONTS.mono,
      fontSize: 9,
      color: pal.isDark ? CANON.purpleSoft : CANON_LIGHT.accentAltText,
      align: 'right',
      margin: 0,
      valign: 'middle',
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * Text primitives
 * ------------------------------------------------------------------ */

export function eyebrow(slide, text, pal, opts = {}) {
  slide.addText(String(text).toUpperCase(), {
    x: opts.x ?? GEO.M,
    y: opts.y ?? GEO.eyebrowY,
    w: opts.w ?? 7.2,
    h: 0.2,
    fontFace: FONTS.body,
    fontSize: TYPE.eyebrow,
    color: pal.accent,
    bold: true,
    charSpacing: 1.8,
    margin: 0,
    valign: 'middle',
  });
}

export function title(slide, text, pal, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? GEO.M,
    y: opts.y ?? GEO.titleY,
    w: opts.w ?? 8.0,
    h: opts.h ?? 0.52,
    fontFace: FONTS.display,
    fontSize: opts.fontSize ?? TYPE.h1,
    bold: true,
    color: pal.text,
    margin: 0,
    valign: 'middle',
    fit: 'shrink',
    charSpacing: -0.4,
  });
}

export function lead(slide, text, pal, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? GEO.M,
    y: opts.y ?? 1.08,
    w: opts.w ?? 7.9,
    h: opts.h ?? 0.3,
    fontFace: FONTS.body,
    fontSize: opts.fontSize ?? 11.5,
    color: pal.muted,
    margin: 0,
    valign: 'top',
    lineSpacingMultiple: 1.18,
  });
}

/**
 * Approximate advance width of a string in em units.
 *
 * A character count is a poor proxy for wrapping: "Cómo se ejecuta una tarea
 * de punta a punta" (41 chars) wraps earlier than "El costo de la IA, medido
 * y acotado" (35 chars). Titles are measured by width so the vertical rhythm
 * never collides with the lead.
 */
function textWidthEm(text) {
  const narrow = "ijltfrI.,:;'\"!|()[]{}-";
  const wide = 'mwMW@%';
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.28;
    else if (narrow.includes(ch)) em += 0.33;
    else if (wide.includes(ch)) em += 0.95;
    else if (/[A-ZÁÉÍÓÚÑ]/.test(ch)) em += 0.68;
    else if (/[0-9]/.test(ch)) em += 0.58;
    else if (/[áéíóúñü]/.test(ch)) em += 0.58;
    else em += 0.56;
  }
  return em * 1.08;
}

/**
 * Estimated height of a wrapped title, in inches.
 * Poppins Bold measures roughly 0.0079in per character per pt of font size.
 * The estimate drives the vertical rhythm: a two-line title pushes the lead
 * and the content band down instead of overlapping them.
 */
export function titleHeight(text, w = 8.0, fontSize = TYPE.h1) {
  const t = String(text ?? '');
  if (!t.trim()) return 0.42;
  const widthIn = (textWidthEm(t) * fontSize) / 72;
  const lines = Math.max(1, Math.ceil(widthIn / w));
  return Math.max(0.42, (lines * fontSize * 1.16) / 72);
}

/**
 * Slide header: eyebrow, title and optional lead.
 * Returns the y where the content band starts, so no layout has to guess.
 */
export function header(slide, pal, s, opts = {}) {
  const w = opts.w ?? 8.0;
  const fontSize = opts.fontSize ?? TYPE.h1;
  const h = titleHeight(s.title ?? '', w, fontSize);
  eyebrow(slide, s.eyebrow ?? '', pal);
  title(slide, s.title ?? '', pal, { w, fontSize, h });
  let y = GEO.titleY + h + 0.05;
  if (s.lead) {
    const leadH = opts.leadH ?? 0.32;
    lead(slide, s.lead, pal, { y, h: leadH, w: opts.leadW ?? 8.3 });
    y += leadH + 0.1;
  }
  return Math.max(y, GEO.titleY + h + 0.42);
}

/**
 * Relative luminance of a hex color (WCAG 2.x).
 */
function luminance(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const ch = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  if (ch.some((c) => Number.isNaN(c))) return 0;
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Contrast ratio between two hex colors. */
export function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ink for text that sits on top of a colored surface.
 *
 * The canon defines accentInk as the ink for accent surfaces, but a content
 * file can pick any accent (light purple C4B5FD, cyan 22D3EE...). White on
 * those fills measures ~1.9:1 and fails WCAG. So the preferred canon ink is
 * kept when it passes 4.5:1, and otherwise the best available ink is chosen.
 */
export function inkOn(bg, preferred = CANON.accentInk) {
  if (contrastRatio(bg, preferred) >= 4.5) return preferred;
  const l = luminance(bg);
  const dark = CANON.bgDeep;
  const light = 'FFFFFF';
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

/**
 * Accent used as TEXT on a light surface.
 *
 * The canon separates the accent SURFACE (borders, tints, bars) from the accent
 * as TEXT. On the light theme the raw cyan measures 2.26:1 on #f5f7fb, so the
 * canon defines lighter-theme text variants. Those are used when they exist;
 * for the remaining accents the same hue is darkened until it passes, instead
 * of inventing a new brand color.
 */
export function textAccent(hex, pal, min = 4.5) {
  const raw = String(hex).replace('#', '').toLowerCase();
  const bg = pal.surface ?? pal.bg;
  if (!pal.isDark) {
    if (raw === String(CANON.cyan).toLowerCase()) return CANON_LIGHT.accentText;
    if (raw === String(CANON.purple).toLowerCase() || raw === String(CANON.purpleSoft).toLowerCase()) {
      return CANON_LIGHT.accentAltText;
    }
  }
  if (contrastRatio(hex, bg) >= min) return hex;
  const r0 = parseInt(raw.slice(0, 2), 16);
  const g0 = parseInt(raw.slice(2, 4), 16);
  const b0 = parseInt(raw.slice(4, 6), 16);
  for (let f = 0.95; f >= 0.05; f -= 0.05) {
    const c = [r0, g0, b0]
      .map((v) => Math.round(v * f).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    if (contrastRatio(c, bg) >= min) return c;
  }
  return CANON_LIGHT.accentText;
}

/* ------------------------------------------------------------------ *
 * Containers
 * ------------------------------------------------------------------ */

export function card(slide, pres, pal, opts) {
  const { x, y, w, h, accent = pal.accent } = opts;
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: pal.surface },
    line: { color: pal.line, width: 0.75 },
    shadow: softShadow(),
  });
  // Small square marker (not a title underline) to carry the accent.
  slide.addShape(pres.shapes.RECTANGLE, {
    x: x + 0.22,
    y: y + 0.24,
    w: 0.1,
    h: 0.1,
    fill: { color: accent },
  });
  return { x, y, w, h };
}

export function iconBubble(slide, pres, pal, opts) {
  const { x, y, size = 0.42, icon, color = pal.accent, tint = true } = opts;
  if (tint) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: size,
      h: size,
      fill: { color: pal.isDark ? pal.bgElevated : CANON_LIGHT.surfaceRaised },
      line: { color: pal.line, width: 0.75 },
    });
  }
  const png = iconPngSync(icon, color);
  if (png) {
    const pad = size * 0.24;
    slide.addImage({ path: png, x: x + pad, y: y + pad, w: size - pad * 2, h: size - pad * 2, altText: icon });
  }
}

/**
 * react-icons rasterization is async, so the layout kit resolves icon PNGs
 * synchronously from the cache generated by build/icons.js. Icons missing from
 * the cache are skipped rather than blocking the build.
 */
export function iconPngSync(icon, color = '#06B6D4') {
  const safeColor = String(color).replace('#', '').toLowerCase();
  const p = path.resolve(__dirname, '..', 'assets', 'icons', `${icon}-${safeColor}.png`);
  return existsSync(p) ? p : null;
}

export function chip(slide, pres, pal, opts) {
  const { x, y, text, color = pal.accent, w = 0.16 + String(text).length * 0.058, h = 0.24 } = opts;
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: pal.isDark ? pal.bgElevated : CANON_LIGHT.surfaceRaised },
    line: { color, width: 0.75 },
  });
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: FONTS.body,
    fontSize: 8,
    color,
    align: 'center',
    valign: 'middle',
    margin: 0,
    bold: true,
    charSpacing: 0.4,
  });
  return w;
}

export function numberBadge(slide, pres, pal, opts) {
  const { x, y, n, size = 0.34, color = pal.accent } = opts;
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w: size,
    h: size,
    fill: { color },
  });
  slide.addText(String(n), {
    x,
    y,
    w: size,
    h: size,
    fontFace: FONTS.mono,
    fontSize: 10.5,
    bold: true,
    color: pal.accentInk,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
}

/* ------------------------------------------------------------------ *
 * Composite blocks
 * ------------------------------------------------------------------ */

/** Icon + heading + body inside a card. */
export function cardBlock(slide, pres, pal, opts) {
  const { x, y, w, h, icon, heading, body, accent = pal.accent, headingSize = TYPE.h3, bodySize = 9.8 } = opts;
  card(slide, pres, pal, { x, y, w, h, accent });
  const px = x + 0.22;
  const pw = w - 0.44;
  let cy = y + 0.2;

  if (icon) {
    iconBubble(slide, pres, pal, { x: px, y: cy, size: 0.4, icon, color: accent });
    cy += 0.54;
  }
  if (heading) {
    slide.addText(heading, {
      x: px,
      y: cy,
      w: pw,
      h: 0.26,
      fontFace: FONTS.display,
      fontSize: headingSize,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    });
    cy += 0.3;
  }
  if (body) {
    slide.addText(body, {
      x: px,
      y: cy,
      w: pw,
      h: y + h - cy - 0.18,
      fontFace: FONTS.body,
      fontSize: bodySize,
      color: pal.muted,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.2,
      fit: 'shrink',
    });
  }
}

/** Big-number metric tile. */
export function metricTile(slide, pres, pal, opts) {
  const { x, y, w, h, value, label, sub, accent = pal.accent, compact = false } = opts;
  // Tall tiles (a single metric row filling the band) get a bigger figure and
  // more generous internal spacing so the card does not read as half empty.
  const tall = !compact && h >= 2.0;
  // A tall tile keeps its group (figure, label, note) vertically centred, so a
  // full-height card reads as a deliberate composition, not an empty box.
  const groupH = 1.52;
  const top0 = tall ? y + Math.max(0.16, (h - groupH) / 2) : y;
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: pal.surface },
    line: { color: pal.line, width: 0.75 },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w: 0.045,
    h,
    fill: { color: accent },
  });
  /**
   * The figure can wrap ("Superficie por layout" in a narrow tile), and the
   * COM render ignores `fit: 'shrink'`: a two-line value overflowed its box and
   * landed on top of the label. The height is therefore MEASURED from the
   * width, and the label and note move down with it. A one-line value keeps
   * exactly the geometry it had.
   */
  const valueFont = tall ? 40 : compact ? TYPE.metricSm : TYPE.metric;
  const valueW = w - 0.34;
  const valueY = top0 + (tall ? 0 : 0.12);
  const valueH = tall
    ? 0.66
    : Math.max(compact ? 0.42 : 0.52, titleHeight(String(value), valueW, valueFont));
  const labelY = tall ? top0 + 0.78 : valueY + valueH;
  const subY = tall ? top0 + 1.08 : labelY + 0.22;

  slide.addText(String(value), {
    x: x + 0.2,
    y: valueY,
    w: valueW,
    h: valueH,
    fontFace: FONTS.display,
    fontSize: valueFont,
    bold: true,
    color: textAccent(accent, pal),
    margin: 0,
    valign: 'middle',
    fit: 'shrink',
  });
  slide.addText(label, {
    x: x + 0.2,
    y: labelY,
    w: w - 0.34,
    h: 0.24,
    fontFace: FONTS.body,
    fontSize: 9.2,
    bold: true,
    color: pal.text,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
  });
  if (sub) {
    slide.addText(sub, {
      x: x + 0.2,
      y: subY,
      w: w - 0.34,
      h: h - (subY - y) - (tall ? 0.12 : 0.1),
      fontFace: FONTS.body,
      fontSize: 8.2,
      color: pal.faint,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.16,
    });
  }
}

/** Icon bullet row with an optional bold lead-in. */
export function bulletRow(slide, pres, pal, opts) {
  const { x, y, w, icon, heading, body, accent = pal.accent, iconSize = 0.3 } = opts;
  const png = iconPngSync(icon, accent);
  if (png) slide.addImage({ path: png, x, y: y + 0.03, w: iconSize, h: iconSize, altText: icon });
  const tx = x + (png ? iconSize + 0.16 : 0);
  const tw = w - (png ? iconSize + 0.16 : 0);
  if (heading) {
    slide.addText(heading, {
      x: tx,
      y,
      w: tw,
      h: 0.22,
      fontFace: FONTS.display,
      fontSize: 10.5,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
    });
  }
  if (body) {
    slide.addText(body, {
      x: tx,
      y: y + (heading ? 0.23 : 0),
      w: tw,
      h: opts.bodyH ?? 0.34,
      fontFace: FONTS.body,
      fontSize: 9.4,
      color: pal.muted,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.16,
      fit: 'shrink',
    });
  }
}

/** Horizontal connector line used by timelines and flows. */
export function connector(slide, pres, pal, x, y, w, color) {
  slide.addShape(pres.shapes.LINE, {
    x,
    y,
    w,
    h: 0,
    line: { color: color ?? pal.line, width: 1 },
  });
}
