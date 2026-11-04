/**
 * GentleVanguard Deck Canon — layout library.
 *
 * Every slide in every deck is one of these layouts. Content files describe
 * WHAT to say; this module owns HOW it looks. That separation is what makes
 * the template reusable company-wide.
 *
 * Geometry contract: LAYOUT_16x9 = 10 x 5.625in. Content band is
 * y = 1.36 .. 4.95. Nothing may exceed the canvas.
 */

import { GEO, FONTS, TYPE, CANON, CANON_LIGHT } from './tokens.js';
import {
  baseSlide,
  eyebrow,
  title,
  lead,
  header,
  titleHeight,
  card,
  cardBlock,
  iconBubble,
  iconPngSync,
  chip,
  numberBadge,
  metricTile,
  bulletRow,
  connector,
  softShadow,
  inkOn,
  textAccent,
  BRAND_ICON,
  BRAND_WORDMARK_TRANSPARENT,
  ASSET_DIAGRAMS,
  ASSET_GEN,
} from './kit.js';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const CONTENT_TOP = 1.36;
export const CONTENT_BOTTOM = 4.95;
export const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;

/**
 * True pixel ratio of a rasterized diagram, read from the manifest written by
 * build/assets.js. PPTX stretches images, so guessing the ratio distorts them.
 */
let DIAGRAM_MANIFEST = null;
function diagramAspect(imageName) {
  if (!DIAGRAM_MANIFEST) {
    const manifestPath = path.join(ASSET_DIAGRAMS, 'manifest.json');
    try {
      DIAGRAM_MANIFEST = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      DIAGRAM_MANIFEST = {};
    }
  }
  const entry = DIAGRAM_MANIFEST[path.basename(imageName)];
  return entry && entry.w && entry.h ? entry.w / entry.h : null;
}

/* ------------------------------------------------------------------ *
 * 1. Cover
 * ------------------------------------------------------------------ */
export function cover(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { cover: true, page: '' });

  /**
   * Hero artwork. The composed hero (build/hero-assets.js) carries the navy
   * scrim on its left half, so the text column stays flat dark while the
   * artwork keeps the right side. When a hero is present the text column
   * narrows: a wide title would run over the bright part of the artwork.
   */
  const heroKey = s.hero ?? ctx.hero;
  let hero = false;
  if (heroKey) {
    const heroPath = path.join(ASSET_GEN, `cover-hero-${heroKey}.png`);
    if (existsSync(heroPath)) {
      slide.background = { path: heroPath };
      hero = true;
    }
  }
  const titleW = hero ? 6.15 : 8.5;
  const subW = hero ? 5.5 : 7.4;

  if (existsSync(BRAND_WORDMARK_TRANSPARENT)) {
    slide.addImage({ path: BRAND_WORDMARK_TRANSPARENT, x: GEO.M, y: 0.52, w: 2.05, h: 0.42, altText: 'GentleVanguard' });
  }

  slide.addText(String(s.eyebrow ?? '').toUpperCase(), {
    x: GEO.M,
    y: 1.42,
    w: hero ? 5.9 : 7.6,
    h: 0.22,
    fontFace: FONTS.body,
    fontSize: 10,
    bold: true,
    color: pal.accent,
    charSpacing: 2.2,
    margin: 0,
    valign: 'middle',
  });

  slide.addText(s.title, {
    x: GEO.M,
    y: 1.72,
    w: titleW,
    h: s.titleH ?? 1.25,
    fontFace: FONTS.display,
    fontSize: s.titleSize ?? 40,
    bold: true,
    color: pal.text,
    margin: 0,
    valign: 'top',
    lineSpacingMultiple: 0.98,
    fit: 'shrink',
    charSpacing: -1,
  });

  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: GEO.M,
      y: (s.titleH ?? 1.25) + 1.78,
      w: subW,
      h: hero ? 0.95 : 0.62,
      fontFace: FONTS.body,
      fontSize: 13.5,
      color: pal.muted,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.22,
    });
  }

  // Meta strip: audience / version / date.
  const meta = (s.meta ?? []).filter(Boolean);
  const metaY = hero ? 4.34 : 4.58;
  let mx = GEO.M;
  meta.forEach((m, i) => {
    const w = 0.3 + String(m).length * 0.062;
    if (i > 0) {
      slide.addShape(pres.shapes.RECTANGLE, { x: mx - 0.16, y: metaY + 0.04, w: 0.03, h: 0.14, fill: { color: pal.line } });
    }
    slide.addText(m, {
      x: mx,
      y: metaY,
      w,
      h: 0.22,
      fontFace: FONTS.body,
      fontSize: 8.6,
      color: pal.faint,
      margin: 0,
      valign: 'middle',
    });
    mx += w;
  });

  // The version stamp accepts the English key and the Spanish one: content
  // files are written in both languages and a missing stamp reads as an empty
  // slot on the cover.
  const versionText = s.version ?? s['versión'] ?? s.versionLabel;
  if (versionText) {
    slide.addText(String(versionText), {
      x: hero ? GEO.M : GEO.W - GEO.M - 2.4,
      y: hero ? 4.62 : 4.58,
      w: hero ? 5.9 : 2.4,
      h: 0.22,
      fontFace: FONTS.mono,
      fontSize: 8.6,
      color: pal.faint,
      align: hero ? 'left' : 'right',
      margin: 0,
      valign: 'middle',
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * 2. Section divider
 * ------------------------------------------------------------------ */
export function section(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { cover: true, page: ctx.page, footer: ctx.footer, section: ctx.section });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.14,
    h: GEO.H,
    fill: { color: pal.accent },
  });

  slide.addText(String(s.number ?? ''), {
    x: GEO.M,
    y: 1.62,
    w: 1.5,
    h: 0.9,
    fontFace: FONTS.display,
    fontSize: 54,
    bold: true,
    color: pal.accent,
    margin: 0,
    valign: 'middle',
  });

  slide.addText(s.title, {
    x: GEO.M,
    y: 2.56,
    w: 8.3,
    h: 0.8,
    fontFace: FONTS.display,
    fontSize: 30,
    bold: true,
    color: pal.text,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    charSpacing: -0.6,
  });

  if (s.lead) {
    slide.addText(s.lead, {
      x: GEO.M,
      y: 3.42,
      w: 7.3,
      h: 0.72,
      fontFace: FONTS.body,
      fontSize: 12.5,
      color: pal.muted,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.22,
    });
  }

  if (s.points?.length) {
    let px = GEO.M;
    s.points.forEach((p) => {
      const w = 0.34 + String(p).length * 0.062;
      slide.addShape(pres.shapes.RECTANGLE, { x: px, y: 4.5, w, h: 0.26, fill: { color: '1a1f2a' }, line: { color: pal.line, width: 0.75 } });
      slide.addText(p, {
        x: px,
        y: 4.5,
        w,
        h: 0.26,
        fontFace: FONTS.body,
        fontSize: 8.4,
        color: pal.muted,
        align: 'center',
        valign: 'middle',
        margin: 0,
      });
      px += w + 0.16;
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * 3. Statement (one big idea)
 * ------------------------------------------------------------------ */
export function statement(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const th = titleHeight(s.title ?? '', 8.6, s.titleSize ?? 30);
  eyebrow(slide, s.eyebrow ?? '', pal);
  title(slide, s.title, pal, { w: 8.6, fontSize: s.titleSize ?? 30, h: th, y: GEO.titleY });

  const bodyY = GEO.titleY + th + 0.16;
  slide.addText(s.body, {
    x: GEO.M,
    y: bodyY,
    w: s.bodyW ?? 7.9,
    h: s.bodyH ?? 0.9,
    fontFace: FONTS.body,
    fontSize: s.bodySize ?? 13,
    color: pal.muted,
    margin: 0,
    valign: 'top',
    lineSpacingMultiple: 1.3,
  });

  if (s.stats?.length) {
    const n = s.stats.length;
    const gap = GEO.gutter;
    const w = (GEO.CW - gap * (n - 1)) / n;
    const statsY = Math.max(bodyY + 1.0, CONTENT_BOTTOM - 1.42);
    s.stats.forEach((st, i) => {
      metricTile(slide, pres, pal, {
        x: GEO.M + i * (w + gap),
        y: statsY,
        w,
        h: CONTENT_BOTTOM - statsY,
        value: st.value,
        label: st.label,
        sub: st.sub,
        accent: st.accent ?? [pal.accent, pal.purple, pal.gold][i % 3],
        compact: true,
      });
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * 4. Cards (2 / 3 / 4 up)
 * ------------------------------------------------------------------ */
export function cards(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const n = items.length;
  const gap = GEO.gutter;
  const cols = s.cols ?? n;
  const w = (GEO.CW - gap * (cols - 1)) / cols;
  const h = s.cardH ?? Math.min(CONTENT_BOTTOM - top, 2.5);

  items.slice(0, cols).forEach((it, i) => {
    const x = GEO.M + i * (w + gap);
    cardBlock(slide, pres, pal, {
      x,
      y: top,
      w,
      h,
      icon: it.icon,
      heading: it.heading,
      body: it.body,
      accent: it.accent ?? [pal.accent, pal.purple, pal.gold, pal.info][i % 4],
    });
  });

  // Extra items render as a second row of compact cards.
  if (items.length > cols) {
    const row2 = items.slice(cols);
    const h2 = (CONTENT_BOTTOM - top - gap) / 2;
    row2.forEach((it, i) => {
      const x = GEO.M + i * (w + gap);
      cardBlock(slide, pres, pal, {
        x,
        y: top + h + gap,
        w,
        h: h2,
        icon: it.icon,
        heading: it.heading,
        body: it.body,
        accent: it.accent ?? pal.accent,
        headingSize: 12,
        bodySize: 9.2,
      });
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * 5. Metrics
 * ------------------------------------------------------------------ */
export function metrics(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const n = items.length;
  const cols = s.cols ?? Math.min(n, n <= 4 ? n : 3);
  const rows = Math.ceil(n / cols);
  const gap = GEO.gutter;
  const w = (GEO.CW - gap * (cols - 1)) / cols;
  const rawH = (CONTENT_BOTTOM - top - gap * (rows - 1)) / rows;
  // A single row fills the band: short tiles left the bottom third of the
  // slide empty, which read as an unfinished slide.
  const h = Math.min(rawH, s.maxH ?? (rows === 1 ? 2.4 : 2.0));
  const gridH = rows * h + gap * (rows - 1);
  const y0 = top + Math.max(0, (CONTENT_BOTTOM - top - gridH) / 2);

  items.forEach((it, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    metricTile(slide, pres, pal, {
      x: GEO.M + c * (w + gap),
      y: y0 + r * (h + gap),
      w,
      h,
      value: it.value,
      label: it.label,
      sub: it.sub,
      accent: it.accent ?? [pal.accent, pal.purple, pal.gold, pal.info][i % 4],
      compact: h < 1.5,
    });
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 6. Two-column comparison
 * ------------------------------------------------------------------ */
export function compare(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const gap = 0.34;
  const w = (GEO.CW - gap) / 2;
  const cols = [
    { head: s.left?.head, sub: s.left?.sub, items: s.left?.items ?? [], accent: s.left?.accent ?? pal.accent, icon: s.left?.icon },
    { head: s.right?.head, sub: s.right?.sub, items: s.right?.items ?? [], accent: s.right?.accent ?? pal.purple, icon: s.right?.icon },
  ];
  cols.forEach((c, i) => {
    const x = GEO.M + i * (w + gap);
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: top,
      w,
      h: 0.62,
      fill: { color: pal.surface },
      line: { color: c.accent, width: 1 },
    });
    slide.addShape(pres.shapes.RECTANGLE, { x, y: top, w: 0.05, h: 0.62, fill: { color: c.accent } });
    if (c.icon) {
      const png = iconPngSync(c.icon, c.accent);
      if (png) slide.addImage({ path: png, x: x + 0.18, y: top + 0.15, w: 0.32, h: 0.32, altText: c.icon });
    }
    slide.addText(c.head ?? '', {
      x: x + (c.icon ? 0.6 : 0.2),
      y: top + 0.08,
      w: w - (c.icon ? 0.78 : 0.36),
      h: 0.26,
      fontFace: FONTS.display,
      fontSize: 14,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
    });
    if (c.sub) {
      slide.addText(c.sub, {
        x: x + (c.icon ? 0.6 : 0.2),
        y: top + 0.33,
        w: w - (c.icon ? 0.78 : 0.36),
        h: 0.22,
        fontFace: FONTS.body,
        fontSize: 9,
        color: pal.faint,
        margin: 0,
        valign: 'middle',
        fit: 'shrink',
      });
    }

    const listTop = top + 0.78;
    const rowH = (CONTENT_BOTTOM - listTop) / Math.max(c.items.length, 1);
    c.items.forEach((it, j) => {
      const yy = listTop + j * rowH;
      const mark = it.mark ?? 'check';
      const color = mark === 'cross' ? pal.error : mark === 'warn' ? pal.warning : c.accent;
      const png = iconPngSync(mark === 'cross' ? 'cross' : mark === 'warn' ? 'bolt' : 'check', `#${color}`);
      if (png) slide.addImage({ path: png, x: x + 0.02, y: yy + 0.04, w: 0.19, h: 0.19, altText: mark });
      slide.addText(it.text, {
        x: x + 0.28,
        y: yy,
        w: w - 0.42,
        h: rowH - 0.04,
        fontFace: FONTS.body,
        fontSize: it.size ?? 9.6,
        color: pal.muted,
        bold: it.bold ?? false,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.14,
      });
    });
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 7. Comparison table
 * ------------------------------------------------------------------ */
export function table(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);
  const headers = s.headers ?? [];
  const rows = s.rows ?? [];
  const colW = s.colW ?? headers.map((_, i) => (i === 0 ? 2.3 : (GEO.CW - 2.3) / (headers.length - 1)));

  const headH = 0.36;
  let x = GEO.M;
  headers.forEach((hd, i) => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: top,
      w: colW[i],
      h: headH,
      fill: { color: i === 0 ? pal.bgElevated : pal.bgDeep },
      line: { color: pal.line, width: 0.75 },
    });
    slide.addText(hd, {
      x: x + 0.12,
      y: top,
      w: colW[i] - 0.24,
      h: headH,
      fontFace: FONTS.body,
      fontSize: 9,
      bold: true,
      color: i === 0 ? pal.faint : pal.accent,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
      charSpacing: 0.3,
    });
    x += colW[i];
  });

  const bodyH = Math.min((CONTENT_BOTTOM - top - headH) / Math.max(rows.length, 1), 0.44);
  rows.forEach((row, r) => {
    const y = top + headH + r * bodyH;
    let cx = GEO.M;
    row.forEach((cell, i) => {
      const isFirst = i === 0;
      const text = typeof cell === 'object' ? cell.text : cell;
      const cellColor = typeof cell === 'object' ? cell.color : undefined;
      const cellBold = typeof cell === 'object' ? cell.bold : isFirst;
      slide.addShape(pres.shapes.RECTANGLE, {
        x: cx,
        y,
        w: colW[i],
        h: bodyH,
        fill: { color: r % 2 === 0 ? pal.surface : pal.bgElevated },
        line: { color: pal.line, width: 0.5 },
      });
      slide.addText(String(text), {
        x: cx + 0.12,
        y,
        w: colW[i] - 0.24,
        h: bodyH,
        fontFace: FONTS.body,
        fontSize: 8.8,
        bold: cellBold,
        color: cellColor ?? (isFirst ? pal.text : pal.muted),
        margin: 0,
        valign: 'middle',
        fit: 'shrink',
      });
      cx += colW[i];
    });
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 8. Timeline / phased process
 * ------------------------------------------------------------------ */
export function timeline(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const n = items.length;
  const gap = 0.2;
  const w = (GEO.CW - gap * (n - 1)) / n;
  const lineY = top + 0.19;

  connector(slide, pres, pal, GEO.M + w / 2, lineY, GEO.CW - w, pal.line);

  // The step cards fill the band below the connector, so the slide does not
  // end with an empty lower third.
  const cardY = lineY + 0.5;
  const cardH = CONTENT_BOTTOM - cardY;

  items.forEach((it, i) => {
    const x = GEO.M + i * (w + gap);
    const accent = it.accent ?? [pal.accent, pal.purple, pal.gold, pal.info][i % 4];
    slide.addShape(pres.shapes.RECTANGLE, {
      x: x + w / 2 - 0.19,
      y: lineY - 0.19,
      w: 0.38,
      h: 0.38,
      fill: { color: pal.bg },
      line: { color: accent, width: 1.25 },
    });
    slide.addText(it.step ?? String(i + 1), {
      x: x + w / 2 - 0.19,
      y: lineY - 0.19,
      w: 0.38,
      h: 0.38,
      fontFace: FONTS.mono,
      fontSize: 10,
      bold: true,
      color: textAccent(accent, pal),
      align: 'center',
      valign: 'middle',
      margin: 0,
    });

    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: cardY,
      w,
      h: cardH,
      fill: { color: pal.surface },
      line: { color: pal.line, width: 0.75 },
    });
    slide.addShape(pres.shapes.RECTANGLE, { x, y: cardY, w, h: 0.05, fill: { color: accent } });

    // Heading and note are centred as a group inside the card.
    const groupH = 1.55;
    const gy = cardY + Math.max(0.18, (cardH - groupH) / 2);

    slide.addText(it.heading, {
      x: x + 0.18,
      y: gy,
      w: w - 0.36,
      h: 0.34,
      fontFace: FONTS.display,
      fontSize: 12.5,
      bold: true,
      color: pal.text,
      align: 'center',
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    });
    if (it.body) {
      slide.addText(it.body, {
        x: x + 0.18,
        y: gy + 0.44,
        w: w - 0.36,
        h: groupH - 0.44,
        fontFace: FONTS.body,
        fontSize: 9.6,
        color: pal.muted,
        align: 'center',
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.2,
      });
    }
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 9. Layered architecture
 * ------------------------------------------------------------------ */
export function layers(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const gap = 0.1;
  const h = (CONTENT_BOTTOM - top - gap * (items.length - 1)) / items.length;
  const labelW = s.labelW ?? 1.55;
  const accent = s.accent ?? pal.accent;

  items.forEach((it, i) => {
    const y = top + i * (h + gap);
    const c = it.accent ?? [accent, pal.purple, pal.gold, pal.info, pal.success, pal.accent][i % 6];
    slide.addShape(pres.shapes.RECTANGLE, {
      x: GEO.M,
      y,
      w: labelW,
      h,
      fill: { color: c },
    });
    slide.addText(it.label, {
      x: GEO.M + 0.12,
      y,
      w: labelW - 0.24,
      h,
      fontFace: FONTS.display,
      fontSize: 10,
      bold: true,
      color: inkOn(c, pal.accentInk),
      align: 'left',
      valign: 'middle',
      margin: 0,
      fit: 'shrink',
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: GEO.M + labelW + 0.08,
      y,
      w: GEO.CW - labelW - 0.08,
      h,
      fill: { color: pal.surface },
      line: { color: pal.line, width: 0.5 },
    });
    slide.addText(it.body, {
      x: GEO.M + labelW + 0.24,
      y,
      w: GEO.CW - labelW - 0.42,
      h,
      fontFace: FONTS.body,
      fontSize: 9.6,
      color: pal.muted,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
      lineSpacingMultiple: 1.12,
    });
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 10. Process flow (chain of steps)
 * ------------------------------------------------------------------ */
export function flow(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const n = items.length;
  const gap = 0.26;
  const w = (GEO.CW - gap * (n - 1)) / n;
  const h = s.boxH ?? Math.min(CONTENT_BOTTOM - top, 3.1);

  items.forEach((it, i) => {
    const x = GEO.M + i * (w + gap);
    const accent = it.accent ?? [pal.accent, pal.purple, pal.gold, pal.info][i % 4];
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: top,
      w,
      h,
      fill: { color: pal.surface },
      line: { color: pal.line, width: 0.75 },
      shadow: softShadow(),
    });
    slide.addShape(pres.shapes.RECTANGLE, { x, y: top, w, h: 0.045, fill: { color: accent } });
    if (it.icon) {
      const png = iconPngSync(it.icon, accent);
      if (png) slide.addImage({ path: png, x: x + 0.2, y: top + 0.22, w: 0.3, h: 0.3, altText: it.icon });
    }
    slide.addText(it.heading, {
      x: x + 0.2,
      y: top + (it.icon ? 0.58 : 0.2),
      w: w - 0.4,
      h: 0.5,
      fontFace: FONTS.display,
      fontSize: 11,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    });
    if (it.body) {
      slide.addText(it.body, {
        x: x + 0.2,
        y: top + (it.icon ? 1.16 : 0.76),
        w: w - 0.4,
        h: h - (it.icon ? 1.3 : 0.9),
        fontFace: FONTS.body,
        fontSize: 8.8,
        color: pal.muted,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.16,
      });
    }
    if (i < n - 1) {
      slide.addText('>', {
        x: x + w - 0.02,
        y: top + h / 2 - 0.14,
        w: gap + 0.04,
        h: 0.28,
        fontFace: FONTS.mono,
        fontSize: 13,
        bold: true,
        color: pal.faint,
        align: 'center',
        valign: 'middle',
        margin: 0,
      });
    }
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 11. Icon bullet list (1 or 2 columns)
 * ------------------------------------------------------------------ */
export function bullets(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const cols = s.cols ?? 2;
  const perCol = Math.ceil(items.length / cols);
  const colW = (GEO.CW - GEO.gutter * (cols - 1)) / cols;
  const rowH = (CONTENT_BOTTOM - top) / perCol;

  items.forEach((it, i) => {
    const c = Math.floor(i / perCol);
    const r = i % perCol;
    bulletRow(slide, pres, pal, {
      x: GEO.M + c * (colW + GEO.gutter),
      y: top + r * rowH,
      w: colW,
      icon: it.icon,
      heading: it.heading,
      body: it.body,
      accent: it.accent ?? pal.accent,
      bodyH: rowH - 0.3,
    });
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 12. Image + text (two column with a real diagram)
 * ------------------------------------------------------------------ */
export function figure(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s, { leadH: 0.3 });
  const textW = s.textW ?? 3.9;
  const imgX = GEO.M + textW + 0.36;
  const imgW = GEO.W - GEO.M - imgX;

  const bullets = s.items ?? [];
  const rowH = Math.min((CONTENT_BOTTOM - top) / Math.max(bullets.length, 1), 0.72);
  bullets.forEach((it, i) => {
    bulletRow(slide, pres, pal, {
      x: GEO.M,
      y: top + i * rowH,
      w: textW,
      icon: it.icon,
      heading: it.heading,
      body: it.body,
      accent: it.accent ?? pal.accent,
      bodyH: rowH - 0.28,
    });
  });

  if (s.image) {
    const imgPath = path.isAbsolute(s.image) ? s.image : path.join(ASSET_DIAGRAMS, s.image);
    if (existsSync(imgPath)) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: imgX - 0.06,
        y: top - 0.06,
        w: imgW + 0.12,
        h: CONTENT_BOTTOM - top + 0.12,
        fill: { color: pal.bgElevated },
        line: { color: pal.line, width: 0.75 },
      });
      // PPTX addImage stretches, so the true pixel ratio comes from the manifest.
      const aspect = s.imageAspect ?? diagramAspect(s.image) ?? 1.5;
      const maxW = imgW - 0.24;
      const maxH = CONTENT_BOTTOM - top - 0.16;
      let w = maxW;
      let h = w / aspect;
      if (h > maxH) {
        h = maxH;
        w = h * aspect;
      }
      slide.addImage({
        path: imgPath,
        x: imgX + (imgW - w) / 2,
        y: top + (CONTENT_BOTTOM - top - h) / 2,
        w,
        h,
        altText: s.imageAlt ?? 'Diagrama',
      });
      if (s.caption) {
        slide.addText(s.caption, {
          x: imgX,
          y: CONTENT_BOTTOM - 0.02,
          w: imgW,
          h: 0.2,
          fontFace: FONTS.body,
          fontSize: 8,
          color: pal.faint,
          align: 'center',
          margin: 0,
          valign: 'middle',
        });
      }
    }
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * 13. Principles panel (no testimonials - these are our own principles)
 * ------------------------------------------------------------------ */
export function principle(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s) + 0.06;
  const h = 1.62;
  const n = s.items?.length ?? 1;
  const gap = GEO.gutter;
  const w = (GEO.CW - gap * (n - 1)) / n;

  (s.items ?? []).forEach((it, i) => {
    const x = GEO.M + i * (w + gap);
    const accent = it.accent ?? [pal.accent, pal.purple, pal.gold][i % 3];
    slide.addShape(pres.shapes.RECTANGLE, {
      x,
      y: top,
      w,
      h,
      fill: { color: pal.surface },
      line: { color: pal.line, width: 0.75 },
    });
    slide.addShape(pres.shapes.RECTANGLE, { x, y: top, w, h: 0.05, fill: { color: accent } });
    slide.addText(it.heading, {
      x: x + 0.22,
      y: top + 0.24,
      w: w - 0.44,
      h: 0.36,
      fontFace: FONTS.display,
      fontSize: 13,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    });
    slide.addText(it.body, {
      x: x + 0.22,
      y: top + 0.66,
      w: w - 0.44,
      h: h - 0.88,
      fontFace: FONTS.body,
      fontSize: 9.6,
      color: pal.muted,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.2,
    });
  });

  if (s.closing) {
    const closingY = top + h + 0.26;
    const closingH = CONTENT_BOTTOM - closingY;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: GEO.M,
      y: closingY,
      w: GEO.CW,
      h: closingH,
      fill: { color: pal.bgElevated },
      line: { color: pal.line, width: 0.75 },
    });
    slide.addShape(pres.shapes.RECTANGLE, { x: GEO.M, y: closingY, w: 0.06, h: closingH, fill: { color: pal.accent } });
    slide.addText(s.closing, {
      x: GEO.M + 0.34,
      y: closingY + 0.2,
      w: GEO.CW - 0.68,
      h: closingH - 0.4,
      fontFace: FONTS.display,
      fontSize: 15,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'middle',
      lineSpacingMultiple: 1.22,
      fit: 'shrink',
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * 13b. Bullets + native layer stack (replaces a rasterized diagram)
 * ------------------------------------------------------------------ *
 * A raster diagram shrinks to ~5px text on a 960px slide and cannot be
 * edited in PowerPoint. This layout draws the same architecture natively:
 * message bullets on the left, the layer stack on the right.
 */
export function figureLayers(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const textW = s.textW ?? 3.3;
  const rightX = GEO.M + textW + 0.34;
  const rightW = GEO.W - GEO.M - rightX;

  const bullets = s.items ?? [];
  const rowH = Math.min((CONTENT_BOTTOM - top) / Math.max(bullets.length, 1), 0.86);
  bullets.forEach((it, i) => {
    bulletRow(slide, pres, pal, {
      x: GEO.M,
      y: top + i * rowH,
      w: textW,
      icon: it.icon,
      heading: it.heading,
      body: it.body,
      accent: it.accent ?? pal.accent,
      bodyH: rowH - 0.28,
    });
  });

  const layers = s.layers ?? [];
  const gap = 0.08;
  const h = (CONTENT_BOTTOM - top - gap * (layers.length - 1)) / Math.max(layers.length, 1);
  const labelW = s.labelW ?? 1.3;

  layers.forEach((it, i) => {
    const y = top + i * (h + gap);
    const c = it.accent ?? [pal.accent, pal.purple, pal.gold, pal.info, pal.success, pal.accent][i % 6];

    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX,
      y,
      w: labelW,
      h,
      fill: { color: c },
    });
    slide.addText(it.label, {
      x: rightX + 0.1,
      y,
      w: labelW - 0.2,
      h,
      fontFace: FONTS.display,
      fontSize: 9.5,
      bold: true,
      color: inkOn(c, pal.accentInk),
      align: 'left',
      valign: 'middle',
      margin: 0,
      fit: 'shrink',
    });

    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX + labelW + 0.08,
      y,
      w: rightW - labelW - 0.08,
      h,
      fill: { color: pal.surface },
      line: { color: pal.line, width: 0.5 },
    });
    slide.addText(it.body, {
      x: rightX + labelW + 0.2,
      y,
      w: rightW - labelW - 0.32,
      h,
      fontFace: FONTS.body,
      fontSize: 8.8,
      color: pal.muted,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
      lineSpacingMultiple: 1.1,
    });
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 14. Agenda
 * ------------------------------------------------------------------ */
export function agenda(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { page: ctx.page, footer: ctx.footer, section: ctx.section });
  const top = header(slide, pal, s);

  const items = s.items ?? [];
  const cols = 2;
  const perCol = Math.ceil(items.length / cols);
  const colW = (GEO.CW - 0.5) / cols;
  const rowH = (CONTENT_BOTTOM - top) / perCol;

  items.forEach((it, i) => {
    const c = Math.floor(i / perCol);
    const r = i % perCol;
    const x = GEO.M + c * (colW + 0.5);
    const y = top + r * rowH;
    slide.addText(String(i + 1).padStart(2, '0'), {
      x,
      y: y + 0.02,
      w: 0.44,
      h: 0.3,
      fontFace: FONTS.mono,
      fontSize: 13,
      bold: true,
      color: pal.accent,
      margin: 0,
      valign: 'middle',
    });
    slide.addText(it.heading, {
      x: x + 0.5,
      y,
      w: colW - 0.5,
      h: 0.26,
      fontFace: FONTS.display,
      fontSize: 11.5,
      bold: true,
      color: pal.text,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
    });
    if (it.body) {
      slide.addText(it.body, {
        x: x + 0.5,
        y: y + 0.27,
        w: colW - 0.5,
        h: rowH - 0.32,
        fontFace: FONTS.body,
        fontSize: 9.2,
        color: pal.muted,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.16,
      });
    }
  });
  return slide;
}

/* ------------------------------------------------------------------ *
 * 15. Closing / call to action
 * ------------------------------------------------------------------ */
export function closing(pres, theme, pal, s, ctx) {
  const slide = baseSlide(pres, theme, pal, { cover: true, page: '' });

  if (existsSync(BRAND_WORDMARK_TRANSPARENT)) {
    slide.addImage({ path: BRAND_WORDMARK_TRANSPARENT, x: GEO.M, y: 0.55, w: 2.05, h: 0.42, altText: 'GentleVanguard' });
  }

  // The title may run to two lines, so body, CTAs and contacts are placed from
  // the measured title height instead of from fixed coordinates.
  const titleW = s.titleW ?? 7.6;
  const titleSize = s.titleSize ?? 34;
  const th = Math.max(0.62, titleHeight(s.title ?? '', titleW, titleSize));
  const titleY = 1.4;

  slide.addText(s.title, {
    x: GEO.M,
    y: titleY,
    w: titleW,
    h: th,
    fontFace: FONTS.display,
    fontSize: titleSize,
    bold: true,
    color: pal.text,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    charSpacing: -0.7,
  });

  const bodyY = titleY + th + 0.14;
  const bodyH = 0.68;

  if (s.body) {
    slide.addText(s.body, {
      x: GEO.M,
      y: bodyY,
      w: s.bodyW ?? 6.6,
      h: bodyH,
      fontFace: FONTS.body,
      fontSize: 12.5,
      color: pal.muted,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.24,
    });
  }

  const ctaY = Math.max(3.34, bodyY + bodyH + 0.18);
  const ctas = s.ctas ?? [];
  let cx = GEO.M;
  ctas.forEach((c, i) => {
    const w = 0.5 + String(c.label).length * 0.085;
    const accent = i === 0 ? pal.accent : pal.purple;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx,
      y: ctaY,
      w,
      h: 0.42,
      fill: { color: i === 0 ? accent : '1a1f2a' },
      line: { color: accent, width: 1 },
    });
    slide.addText(c.label, {
      x: cx,
      y: ctaY,
      w,
      h: 0.42,
      fontFace: FONTS.body,
      fontSize: 10.5,
      bold: true,
      color: i === 0 ? pal.accentInk : accent,
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    cx += w + 0.18;
  });

  if (s.contacts?.length) {
    let y = Math.max(4.06, ctaY + 0.42 + 0.28);
    s.contacts.forEach((c) => {
      slide.addText(c, {
        x: GEO.M,
        y,
        w: 6.2,
        h: 0.24,
        fontFace: FONTS.body,
        fontSize: 10,
        color: pal.muted,
        margin: 0,
        valign: 'middle',
      });
      y += 0.28;
    });
  }

  if (s.note) {
    slide.addText(s.note, {
      x: GEO.W - GEO.M - 3.4,
      y: 4.3,
      w: 3.4,
      h: 0.5,
      fontFace: FONTS.body,
      fontSize: 8.2,
      color: pal.faint,
      align: 'right',
      margin: 0,
      valign: 'middle',
      lineSpacingMultiple: 1.2,
    });
  }
  return slide;
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */
export const LAYOUTS = {
  cover,
  section,
  statement,
  cards,
  metrics,
  compare,
  table,
  timeline,
  layers,
  flow,
  bullets,
  figure,
  figureLayers,
  principle,
  agenda,
  closing,
};
