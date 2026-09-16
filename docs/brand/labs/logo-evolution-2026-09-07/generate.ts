/**
 * generate.ts — "Vanguard Cut" identity system (v3, pass 3 — full deck)
 * Deterministic geometry + presentation panels styled after a human-studio
 * identity deck (hero / seal / symbolism / construction / elements / color /
 * typography / applications), one HTML panel per image.
 *
 * Run: node --import tsx docs/brand/labs/logo-evolution-2026-09-07/generate.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'out');
mkdirSync(OUT, { recursive: true });

const D = Math.PI / 180;
type Pt = [number, number];
interface Geo {
  RO: number;
  RI: number;
  AXIS: number;
  GAP_HALF: number;
  TIP_DIST: number;
  ARM_HALF: number;
  ARM_LEN: number;
  ARM_W: number;
  TIP_FLAT: number;
}
interface Built {
  ringPath: string;
  chevronPath: string;
  geo: Geo;
  T: Pt;
  a1: number;
  a2: number;
}

const CX = 256,
  CY = 256;

function build(g: Geo): Built {
  const pt = (r: number, deg: number): Pt => [
    CX + r * Math.cos(deg * D),
    CY - r * Math.sin(deg * D),
  ];
  const dir = (deg: number): Pt => [Math.cos(deg * D), -Math.sin(deg * D)];
  const a1 = g.AXIS + g.GAP_HALF;
  const a2 = g.AXIS - g.GAP_HALF + 360;
  const o1 = pt(g.RO, a1),
    o2 = pt(g.RO, a2),
    i2 = pt(g.RI, a2),
    i1 = pt(g.RI, a1);
  const ringPath = `M ${F(o1)} A ${g.RO} ${g.RO} 0 1 0 ${F(o2)} L ${F(i2)} A ${g.RI} ${g.RI} 0 1 1 ${F(i1)} Z`;

  const u1 = dir(g.AXIS + 180 - g.ARM_HALF);
  const u2 = dir(g.AXIS + 180 + g.ARM_HALF);
  const bis = dir(g.AXIS + 180);
  const bisPerp: Pt = [-bis[1], bis[0]];
  const T = pt(g.TIP_DIST, g.AXIS);
  const T1: Pt = [T[0] + bisPerp[0] * (g.TIP_FLAT / 2), T[1] + bisPerp[1] * (g.TIP_FLAT / 2)];
  const T2: Pt = [T[0] - bisPerp[0] * (g.TIP_FLAT / 2), T[1] - bisPerp[1] * (g.TIP_FLAT / 2)];
  const dInner = g.ARM_W / (2 * Math.sin(g.ARM_HALF * D));
  const I: Pt = [T[0] + bis[0] * dInner, T[1] + bis[1] * dInner];
  const signTo = (v: Pt, target: Pt): Pt => {
    const c: Pt[] = [
      [-v[1], v[0]],
      [v[1], -v[0]],
    ];
    const dx = target[0] - T[0],
      dy = target[1] - T[1];
    return c[0][0] * dx + c[0][1] * dy > 0 ? c[0] : c[1];
  };
  const m1 = signTo(u1, I),
    m2 = signTo(u2, I);
  const A1o: Pt = [T1[0] + u1[0] * g.ARM_LEN, T1[1] + u1[1] * g.ARM_LEN];
  const A1i: Pt = [A1o[0] + m1[0] * g.ARM_W, A1o[1] + m1[1] * g.ARM_W];
  const A2o: Pt = [T2[0] + u2[0] * g.ARM_LEN, T2[1] + u2[1] * g.ARM_LEN];
  const A2i: Pt = [A2o[0] + m2[0] * g.ARM_W, A2o[1] + m2[1] * g.ARM_W];
  const chevronPath = `M ${F(T1)} L ${F(A1o)} L ${F(A1i)} L ${F(I)} L ${F(A2i)} L ${F(A2o)} L ${F(T2)} Z`;
  return { ringPath, chevronPath, geo: g, T, a1, a2 };
}
function F(p: Pt): string {
  return `${(Math.round(p[0] * 10) / 10).toFixed(1)} ${(Math.round(p[1] * 10) / 10).toFixed(1)}`;
}
const f = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function clearance(b: Built): number {
  const { geo } = b;
  const u1: Pt = [
    Math.cos((geo.AXIS + 180 - geo.ARM_HALF) * D),
    -Math.sin((geo.AXIS + 180 - geo.ARM_HALF) * D),
  ];
  const u2: Pt = [
    Math.cos((geo.AXIS + 180 + geo.ARM_HALF) * D),
    -Math.sin((geo.AXIS + 180 + geo.ARM_HALF) * D),
  ];
  const rays = [geo.AXIS + geo.GAP_HALF, geo.AXIS - geo.GAP_HALF].map(
    (a) => [Math.cos(a * D), -Math.sin(a * D)] as Pt,
  );
  let min = Infinity;
  for (const u of [u1, u2]) {
    for (let t = 0.25 * geo.ARM_LEN; t <= geo.ARM_LEN; t += 6) {
      const p: Pt = [b.T[0] + u[0] * t, b.T[1] + u[1] * t];
      for (const r of rays) {
        const d = Math.abs((p[0] - CX) * r[1] - (p[1] - CY) * r[0]);
        min = Math.min(min, d);
      }
    }
  }
  return min;
}
function tuneGap(base: Omit<Geo, 'GAP_HALF'>, targetEdge: number): Geo {
  for (let gh = 46; gh <= 66; gh++) {
    const g: Geo = { ...base, GAP_HALF: gh };
    if (clearance(build(g)) - g.ARM_W / 2 >= targetEdge) return g;
  }
  throw new Error('no gap satisfies target clearance');
}

const BASE: Omit<Geo, 'GAP_HALF'> = {
  RO: 196,
  RI: 124,
  AXIS: 45,
  TIP_DIST: 228,
  ARM_HALF: 32,
  ARM_LEN: 136,
  ARM_W: 72,
  TIP_FLAT: 10,
};
const SMALL: Geo = {
  RO: 196,
  RI: 112,
  AXIS: 45,
  GAP_HALF: 56,
  TIP_DIST: 216,
  ARM_HALF: 29,
  ARM_LEN: 118,
  ARM_W: 84,
  TIP_FLAT: 0,
};

const main = build(tuneGap(BASE, 22));
const small = build(SMALL);
console.log(
  `main gap: ${main.geo.GAP_HALF}° half · edge clearance: ${(clearance(main) - main.geo.ARM_W / 2).toFixed(1)}u`,
);

// ---------- palette ----------
const BG = '#0F1115';
const DEEP = '#0B0D11';
const BONE = '#E9ECF4';
const PURPLE = '#A78BFA';
const CYAN = '#22D3EE';
const STEEL = '#8B93A7';
const GUIDE = '#7BA8C9';

const gradDef = (x1: number, y1: number, x2: number, y2: number) =>
  `  <linearGradient id="vg" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
    <stop offset="0" stop-color="${PURPLE}"/>
    <stop offset="1" stop-color="${CYAN}"/>
  </linearGradient>`;

const VB = '-70 -70 652 652';
const svgWrap = (inner: string, w = 512, h = 512, bg?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="${w}" height="${h}">${bg ? `\n  <rect x="-70" y="-70" width="652" height="652" fill="${bg}"/>` : ''}\n${inner}\n</svg>`;
const ring = (b: Built, fill: string) => `  <path d="${b.ringPath}" fill="${fill}"/>`;
const chev = (b: Built, fill: string) => `  <path d="${b.chevronPath}" fill="${fill}"/>`;

// ============================================================
// SVG ASSETS
// ============================================================
writeFileSync(
  join(OUT, 'mark-mono-light.svg'),
  svgWrap(ring(main, BONE) + '\n' + chev(main, BONE)),
);
writeFileSync(
  join(OUT, 'mark-mono-dark.svg'),
  svgWrap(ring(main, '#0F1115') + '\n' + chev(main, '#0F1115')),
);
writeFileSync(
  join(OUT, 'mark-gradient.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="512" height="512">\n<defs>\n${gradDef(300, 230, 432, 96)}\n</defs>\n${ring(main, BONE)}\n${chev(main, 'url(#vg)')}\n</svg>`,
);
writeFileSync(join(OUT, 'mark-small.svg'), svgWrap(ring(small, BONE) + '\n' + chev(small, BONE)));
writeFileSync(
  join(OUT, 'mark-small-gradient.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="512" height="512">\n<defs>\n${gradDef(310, 220, 430, 100)}\n</defs>\n${ring(small, BONE)}\n${chev(small, 'url(#vg)')}\n</svg>`,
);

// construction sheet
{
  const g = main.geo;
  const pt = (r: number, deg: number): Pt => [
    CX + r * Math.cos(deg * D),
    CY - r * Math.sin(deg * D),
  ];
  const ray = (deg: number, r0: number, r1: number) => `M ${F(pt(r0, deg))} L ${F(pt(r1, deg))}`;
  const circ = (r: number) =>
    `M ${f(CX + r)} ${f(CY)} A ${r} ${r} 0 1 1 ${f(CX - r)} ${f(CY)} A ${r} ${r} 0 1 1 ${f(CX + r)} ${f(CY)}`;
  const guide = (d: string, extra = '') => {
    const base: Record<string, string> = {
      fill: 'none',
      stroke: CYAN,
      'stroke-opacity': '0.65',
      'stroke-width': '1.6',
    };
    for (const m of extra.matchAll(/([\w-]+)="([^"]*)"/g)) base[m[1]] = m[2];
    const attrs = Object.entries(base)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    return `  <path d="${d}" ${attrs}/>`;
  };
  const label = (x: number, y: number, t: string, anchor = 'middle', col = '#A9C9E2') =>
    `  <text x="${f(x)}" y="${f(y)}" font-family="ui-monospace, 'Cascadia Mono', monospace" font-size="19" fill="${col}" fill-opacity="0.92" text-anchor="${anchor}">${t}</text>`;
  const axisFar = pt(296, g.AXIS);
  writeFileSync(
    join(OUT, 'mark-construction.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="512" height="512">
<defs>${gradDef(300, 230, 432, 96)}</defs>
${ring(main, BONE).replace(/fill="[^"]*"/, `fill="${BONE}" fill-opacity="0.20"`)}
${chev(main, CYAN).replace(/fill="[^"]*"/, `fill="${CYAN}" fill-opacity="0.26"`)}
${guide(circ(g.RO), 'stroke-dasharray="6 6"')}
${guide(circ(g.RI), 'stroke-dasharray="6 6"')}
${guide(circ(g.TIP_DIST), 'stroke-dasharray="2 7" stroke-opacity="0.35"')}
${guide(`M ${f(CX - 300)} ${f(CY)} L ${f(CX + 320)} ${f(CY)}`, 'stroke-opacity="0.22"')}
${guide(`M ${f(CX)} ${f(CY - 320)} L ${f(CX)} ${f(CY + 300)}`, 'stroke-opacity="0.22"')}
${guide(`M ${F(pt(30, g.AXIS + 180))} L ${F(axisFar)}`, 'stroke-width="1.8"')}
${guide(ray(main.a1, g.RI - 34, g.RO + 34))}
${guide(ray(main.a2, g.RI - 34, g.RO + 34))}
${guide(`M ${f(CX - 12)} ${f(CY)} L ${f(CX + 12)} ${f(CY)}`, 'stroke-width="1"')}
${guide(`M ${f(CX)} ${f(CY - 12)} L ${f(CX)} ${f(CY + 12)}`, 'stroke-width="1"')}
${guide(ray(180, g.RI, g.RO), 'stroke="#A78BFA"')}
${label(CX - 128, CY - 14, '72u', 'end', '#A78BFA')}
${label(axisFar[0] + 10, axisFar[1] + 30, '45°', 'start')}
${label(CX + 204, CY - 70, 'R 196', 'start')}
${label(pt(g.RO, main.a1)[0] - 30, pt(g.RO, main.a1)[1] + 6, 'corte radial', 'start')}
${label(main.T[0] - 4, main.T[1] - 34, 'micro-plano 10u', 'start')}
</svg>`,
  );
}

writeFileSync(join(OUT, 'anatomy-ring.svg'), svgWrap(ring(main, BONE)));
writeFileSync(join(OUT, 'anatomy-chevron.svg'), svgWrap(chev(main, BONE)));

// app icon tiles
const tile = (size: number, useSmall = false) => {
  const b = useSmall ? small : main;
  const s = size * 0.00155;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>${gradDef(size * 0.56, size * 0.52, size * 0.9, size * 0.12)}</defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.225)}" fill="${BG}"/>
  <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${Math.round(size * 0.225)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="${Math.max(1, size / 340)}"/>
  <g transform="translate(${f(size / 2 - 6 * s)} ${f(size / 2 + 8 * s)}) scale(${s.toFixed(4)}) translate(-256 -256)">
    ${ring(b, BONE)}
    ${chev(b, 'url(#vg)')}
  </g>
</svg>`;
};
writeFileSync(join(OUT, 'icon-tile.svg'), tile(512));
writeFileSync(join(OUT, 'icon-tile-64.svg'), tile(64, true));

// emblem / profile seal (1080 master)
function emblemSVG(): string {
  const E = 1080,
    EC = E / 2;
  const TR_TOP = 400,
    TR_BOT = 436;
  const p2 = (r: number, deg: number): Pt => [
    EC + r * Math.cos(deg * D),
    EC - r * Math.sin(deg * D),
  ];
  const topArc = `M ${f(EC - TR_TOP)} ${f(EC)} A ${TR_TOP} ${TR_TOP} 0 0 1 ${f(EC + TR_TOP)} ${f(EC)}`;
  const botArc = `M ${f(EC - TR_BOT)} ${f(EC)} A ${TR_BOT} ${TR_BOT} 0 0 0 ${f(EC + TR_BOT)} ${f(EC)}`;
  const tick = (deg: number) => {
    const p0 = p2(470, deg),
      p1 = p2(deg === 45 ? 438 : 455, deg);
    return `  <line x1="${f(p0[0])}" y1="${f(p0[1])}" x2="${f(p1[0])}" y2="${f(p1[1])}" stroke="${deg === 45 ? CYAN : '#E9ECF4'}" stroke-opacity="${deg === 45 ? 0.95 : 0.28}" stroke-width="${deg === 45 ? 4 : 2.5}" stroke-linecap="round"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${E}" height="${E}" viewBox="0 0 ${E} ${E}">
  <defs>${gradDef(600, 610, 858, 352)}
    <radialGradient id="washP" cx="0.22" cy="0.16" r="0.75">
      <stop offset="0" stop-color="${PURPLE}" stop-opacity="0.055"/>
      <stop offset="0.6" stop-color="${PURPLE}" stop-opacity="0.012"/>
      <stop offset="1" stop-color="${PURPLE}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="washC" cx="0.82" cy="0.88" r="0.8">
      <stop offset="0" stop-color="${CYAN}" stop-opacity="0.045"/>
      <stop offset="0.6" stop-color="${CYAN}" stop-opacity="0.01"/>
      <stop offset="1" stop-color="${CYAN}" stop-opacity="0"/>
    </radialGradient>
    <path id="arcTop" d="${topArc}"/>
    <path id="arcBot" d="${botArc}"/>
  </defs>
  <rect width="${E}" height="${E}" fill="${BG}"/>
  <rect width="${E}" height="${E}" fill="url(#washP)"/>
  <rect width="${E}" height="${E}" fill="url(#washC)"/>
  <circle cx="${EC}" cy="${EC}" r="480" fill="none" stroke="${BONE}" stroke-opacity="0.15" stroke-width="2"/>
${[0, 45, 90, 135, 180, 225, 270, 315].map(tick).join('\n')}
  <text font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-weight="500" font-size="42" letter-spacing="16" fill="${BONE}" fill-opacity="0.92"><textPath href="#arcTop" startOffset="50%" text-anchor="middle">GENTLE VANGUARD</textPath></text>
  <text font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-weight="400" font-size="26" letter-spacing="10" fill="${BONE}" fill-opacity="0.52"><textPath href="#arcBot" startOffset="50%" text-anchor="middle">SOFTWARE · SYSTEMS · INTELLIGENCE</textPath></text>
  <g transform="translate(${EC - 4} ${EC + 5}) scale(1.2) translate(-256 -256)">
    ${ring(main, BONE)}
    ${chev(main, 'url(#vg)')}
  </g>
</svg>`;
}
writeFileSync(join(OUT, 'emblem-profile.svg'), emblemSVG());

// horizontal lockup
writeFileSync(
  join(OUT, 'lockup-horizontal.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="280" viewBox="0 0 1200 280">
  <defs>${gradDef(170, 150, 300, 40)}</defs>
  <g transform="translate(26 20) scale(0.45)">
    ${ring(main, BONE)}
    ${chev(main, 'url(#vg)')}
  </g>
  <text x="318" y="162" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="94" fill="${BONE}" letter-spacing="-1"><tspan font-weight="400">Gentle</tspan><tspan font-weight="700">Vanguard</tspan></text>
  <text x="322" y="202" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-weight="400" font-size="20" letter-spacing="9" fill="${BONE}" fill-opacity="0.5">SOFTWARE · SYSTEMS · INTELLIGENCE</text>
</svg>`,
);

// ============================================================
// PRESENTATION PANELS (individual images, 1440x1800)
// ============================================================
const PW = 1440,
  PH = 1800;
const esc = (s: string) => s;

function panelShell(num: string, title: string, subtitle: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<link rel="stylesheet" href="fonts/space-grotesk.css">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${PW}px; height:${PH}px; overflow:hidden; }
  body { background:${DEEP}; font-family:'Space Grotesk','Segoe UI',sans-serif; color:${BONE}; padding:84px 96px; display:flex; flex-direction:column; }
  .topbar { display:flex; justify-content:space-between; align-items:baseline; padding-bottom:22px; border-bottom:1px solid rgba(233,236,244,0.12); }
  .topbar .brand { font-weight:700; font-size:19px; letter-spacing:0.5px; }
  .topbar .meta { font-size:13px; letter-spacing:4px; color:${STEEL}; text-transform:uppercase; }
  h1 { font-weight:500; font-size:58px; letter-spacing:10px; text-transform:uppercase; margin:54px 0 8px; }
  .sub { font-size:17px; letter-spacing:3px; color:${STEEL}; text-transform:uppercase; margin-bottom:46px; }
  .content { flex:1; display:flex; flex-direction:column; }
  .footer { display:flex; justify-content:space-between; border-top:1px solid rgba(233,236,244,0.12); padding-top:22px; font-size:13px; letter-spacing:3.5px; color:${STEEL}; text-transform:uppercase; }
  .accent { color:${CYAN}; }
</style></head>
<body>
  <div class="topbar"><div class="brand">Gentle<span style="font-weight:300">Vanguard</span></div><div class="meta">Sistema de identidad · 2026</div></div>
  <h1>${title}</h1>
  <div class="sub">${subtitle}</div>
  <div class="content">${body}</div>
  <div class="footer"><div>${num} / 08</div><div>The Vanguard Cut — <span class="accent">identidad v3</span></div></div>
</body></html>`;
}

// ---- panel 01 · hero ----
writeFileSync(
  join(OUT, 'panel-01-hero.html'),
  panelShell(
    '01',
    'La Marca',
    'El anillo abierto y el avance — una sola geometría',
    `
  <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:64px;">
    <img src="mark-gradient.svg" width="620">
    <div style="font-size:104px; letter-spacing:-2px;"><span style="font-weight:400;">Gentle</span><span style="font-weight:700;">Vanguard</span></div>
    <div style="font-size:19px; letter-spacing:12px; color:${STEEL}; text-transform:uppercase;">Software · Systems · Intelligence</div>
  </div>`,
  ),
);

// ---- panel 02 · seal ----
writeFileSync(
  join(OUT, 'panel-02-emblem.html'),
  panelShell(
    '02',
    'El Emblema',
    'Sello corporativo — versión de perfil y usos ceremoniales',
    `
  <div style="flex:1; display:flex; align-items:center; justify-content:center;">
    <img src="emblem-profile.svg" width="1150" style="border-radius:50%;">
  </div>`,
  ),
);

// ---- panel 03 · symbolism (inline SVG with callouts) ----
{
  const s = 1.5,
    OX = 720,
    OY = 640; // mark placement inside 1440-wide content
  const A = (p: Pt) => [OX + (p[0] - 256) * s, OY + (p[1] - 256) * s] as Pt;
  const anchors = {
    tip: A(main.T),
    tipEdge: A([CX + 246 * Math.cos(33 * D), CY - 246 * Math.sin(33 * D)]),
    chevBody: A([CX + (main.T[0] - CX) * 0.55, CY + (main.T[1] - CY) * 0.55]),
    termHi: A([CX + 160 * Math.cos(main.a1 * D), CY - 160 * Math.sin(main.a1 * D)]),
    termLo: A([CX + 160 * Math.cos(main.a2 * D), CY - 160 * Math.sin(main.a2 * D)]),
    ring: A([CX - 160, CY]),
    center: A([256, 256]),
  };
  const callout = (from: Pt, elbow: [number, number], to: [number, number]) =>
    `  <polyline points="${f(from[0])},${f(from[1])} ${elbow[0]},${elbow[1]} ${to[0]},${to[1]}" fill="none" stroke="${GUIDE}" stroke-width="1.6" stroke-opacity="0.85"/>
  <circle cx="${f(from[0])}" cy="${f(from[1])}" r="5" fill="${CYAN}"/>`;
  const box = (x: number, y: number, w: number, title: string, desc: string, anchor = 'start') =>
    `  <foreignObject x="${x}" y="${y}" width="${w}" height="120"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'Space Grotesk','Segoe UI',sans-serif;color:${BONE};text-anchor:${anchor}">
      <div style="font-size:17px;letter-spacing:4px;color:${CYAN};text-transform:uppercase;font-weight:500;margin-bottom:7px;">${title}</div>
      <div style="font-size:15.5px;line-height:1.5;color:rgba(233,236,244,0.72)">${desc}</div></div></foreignObject>`;
  writeFileSync(
    join(OUT, 'panel-03-symbolism.html'),
    panelShell(
      '03',
      'El Simbolismo',
      'Cada decisión formal tiene una razón',
      `
  <svg viewBox="0 0 ${PW - 192} 1180" style="width:100%; flex:1;">
    <defs>${gradDef(OX + 60, OY + 40, OX + 280, OY - 200)}</defs>
    <g transform="translate(${OX} ${OY}) scale(${s}) translate(-256 -256)">${ring(main, BONE)}${chev(main, 'url(#vg)')}</g>
    ${callout(anchors.chevBody, [1100, 260], [1120, 260])}
    ${box(940, 120, 290, 'El avance — V', 'El chevrón rompe el perímetro en el eje de 45°. La vanguardia va primero.')}
    ${callout(anchors.tip, [800, 150], [790, 150])}
    ${box(450, 60, 340, 'Micro-plano 10u', 'Hasta la punta de la hoja está suavemente terminada. Gentle.')}
    ${callout(anchors.termHi, [500, 150], [460, 150])}
    ${box(150, 90, 260, 'Corte radial', 'Terminales mecanizados al eje del sistema. Nada es decorativo.')}
    ${callout(anchors.ring, [180, 660], [160, 660])}
    ${box(60, 610, 300, 'El abrazo — G', 'El anillo abierto: lo gentil. El sistema que sostiene sin encerrar.')}
    ${callout(anchors.termLo, [700, 1060], [740, 1060])}
    ${box(560, 1090, 330, 'Contrapeso', 'El aire entre brazo y terminal: 22 unidades exactas.')}
  </svg>`,
    ),
  );
}

// ---- panel 04 · construction ----
writeFileSync(
  join(OUT, 'panel-04-construction.html'),
  panelShell(
    '04',
    'La Construcción',
    'Grilla, círculos y ejes — geometría verificable, no decoración',
    `
  <div style="flex:1; display:flex; align-items:center; justify-content:center; position:relative;">
    <img src="mark-construction.svg" width="980" style="opacity:0.96;">
  </div>
  <div style="display:flex; justify-content:space-between; padding: 0 40px 20px; font-size:14.5px; letter-spacing:2.5px; color:${STEEL}; text-transform:uppercase;">
    <span>Eje 45°</span><span>Peso uniforme 72u</span><span>Cortes radiales</span><span>Sobrepaso w/2</span>
  </div>`,
  ),
);

// ---- panel 05 · elements ----
writeFileSync(
  join(OUT, 'panel-05-elements.html'),
  panelShell(
    '05',
    'Los Elementos',
    'Dos gestos: la curva que sostiene, la recta que avanza',
    `
  <div style="flex:1; display:flex; align-items:center; justify-content:center; gap:110px;">
    <div style="display:flex; flex-direction:column; align-items:center; gap:44px;">
      <img src="anatomy-ring.svg" width="430">
      <div style="text-align:center"><div style="font-size:16px; letter-spacing:5px; color:${CYAN}; text-transform:uppercase; margin-bottom:10px;">01 · El abrazo</div>
      <div style="font-size:15.5px; color:rgba(233,236,244,0.66); line-height:1.55; max-width:330px;">El anillo abierto.<br>Lo gentil, el sistema,<br>la G de la marca.</div></div>
    </div>
    <div style="width:1px; height:560px; background:rgba(233,236,244,0.12);"></div>
    <div style="display:flex; flex-direction:column; align-items:center; gap:44px;">
      <img src="anatomy-chevron.svg" width="430">
      <div style="text-align:center"><div style="font-size:16px; letter-spacing:5px; color:${CYAN}; text-transform:uppercase; margin-bottom:10px;">02 · El avance</div>
      <div style="font-size:15.5px; color:rgba(233,236,244,0.66); line-height:1.55; max-width:330px;">El chevrón que rompe<br>el perímetro. La vanguardia,<br>la V de la marca.</div></div>
    </div>
  </div>`,
  ),
);

// ---- panel 06 · color ----
{
  const sw = (hex: string, name: string, note: string, border = '') =>
    `<div style="display:flex; flex-direction:column; align-items:center; gap:26px; flex:1;">
      <div style="width:190px; height:190px; border-radius:50%; background:${hex}; ${border}"></div>
      <div style="text-align:center"><div style="font-size:16px; letter-spacing:3px; text-transform:uppercase; margin-bottom:8px;">${name}</div>
      <div style="font-size:14.5px; color:${STEEL};">${hex}<br>${note}</div></div>
    </div>`;
  writeFileSync(
    join(OUT, 'panel-06-color.html'),
    panelShell(
      '06',
      'El Color',
      'Un fondo, un hueso, dos acentos — y la energía solo donde avanza',
      `
  <div style="flex:1; display:flex; align-items:center; justify-content:center; gap:56px; padding:0 10px;">
    ${sw(BG, 'Grafito nocturno', 'el lienzo')}
    ${sw(BONE, 'Hueso', 'la voz primaria', `border:1px solid rgba(233,236,244,0.25);`)}
    ${sw('#A78BFA', 'Violeta vanguardia', 'acento 1')}
    ${sw('#22D3EE', 'Cian avance', 'acento 2 · ejes')}
    ${sw('#8B93A7', 'Acero', 'texto secundario')}
  </div>
  <div style="display:flex; align-items:center; gap:30px; padding:0 24px 34px;">
    <div style="height:54px; flex:1; border-radius:27px; background:linear-gradient(94deg, #A78BFA, #22D3EE);"></div>
    <div style="font-size:14.5px; color:${STEEL}; letter-spacing:1px; max-width:330px;">El gradiente de marca existe en un solo lugar: sobre el chevrón que avanza.</div>
  </div>`,
    ),
  );
}

// ---- panel 07 · typography ----
writeFileSync(
  join(OUT, 'panel-07-typography.html'),
  panelShell(
    '07',
    'La Tipografía',
    'Space Grotesk — geométrica con carácter, técnica sin frialdad',
    `
  <div style="flex:1; display:flex; flex-direction:column; justify-content:center; gap:54px;">
    <div style="display:flex; align-items:baseline; gap:56px;">
      <div style="font-size:300px; font-weight:700; line-height:0.9; letter-spacing:-8px;">Aa</div>
      <div>
        <div style="font-size:26px; font-weight:500; letter-spacing:1px; margin-bottom:14px;">Space Grotesk</div>
        <div style="font-size:15.5px; color:${STEEL}; line-height:1.6;">Display de la marca · 2026<br>Regular 400 / Medium 500 / Bold 700</div>
      </div>
    </div>
    <div style="border-top:1px solid rgba(233,236,244,0.12); padding-top:44px; font-size:29px; line-height:1.75; letter-spacing:5.5px; word-break:break-all;">ABCDEFGHIJKLM<br>NOPQRSTUVWXYZ</div>
    <div style="font-size:29px; line-height:1.75; letter-spacing:5.5px; word-break:break-all; color:rgba(233,236,244,0.62);">abcdefghijklm<br>nopqrstuvwxyz</div>
    <div style="font-size:29px; letter-spacing:5.5px; color:rgba(233,236,244,0.62);">0123456789&nbsp;&nbsp;·&nbsp;&nbsp;¿?¡!—</div>
  </div>`,
  ),
);

// ---- panel 08 · applications ----
writeFileSync(
  join(OUT, 'panel-08-applications.html'),
  panelShell(
    '08',
    'Aplicaciones',
    'El sistema en superficie: icono, navegador, terminal, tarjeta',
    `
  <style>
    .win { background:#12151B; border:1px solid rgba(233,236,244,0.09); border-radius:14px; overflow:hidden; }
    .win .bar { display:flex; align-items:center; gap:8px; padding:12px 16px; background:rgba(233,236,244,0.04); border-bottom:1px solid rgba(233,236,244,0.08); }
    .dot { width:10px; height:10px; border-radius:50%; background:rgba(233,236,244,0.18); }
    .lbl2 { font-size:12.5px; letter-spacing:3px; color:${STEEL}; text-transform:uppercase; margin:26px 0 14px; }
  </style>
  <div style="flex:1; display:grid; grid-template-columns:1fr 1fr; gap:56px 64px; align-content:center;">
    <div>
      <div class="lbl2">Icono de aplicación</div>
      <div style="display:flex; align-items:flex-end; gap:28px;">
        <img src="icon-tile.svg" width="200">
        <img src="icon-tile-64.svg" width="64">
        <img src="icon-tile-64.svg" width="32" style="border-radius:7px;">
      </div>
    </div>
    <div>
      <div class="lbl2">Navegador</div>
      <div class="win">
        <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <div style="flex:1; margin-left:12px; background:rgba(233,236,244,0.06); border-radius:8px; padding:8px 14px; font-size:13.5px; color:rgba(233,236,244,0.55); display:flex; align-items:center; gap:10px;"><img src="mark-small.svg" width="15"> gentle.vanguard/studio</div>
        </div>
        <div style="height:170px; display:flex; align-items:center; justify-content:center; background:#0F1115;"><img src="mark-gradient.svg" width="120" style="opacity:0.9;"></div>
      </div>
    </div>
    <div>
      <div class="lbl2">Terminal</div>
      <div class="win" style="background:#05070A;">
        <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <div style="padding:22px 26px; font-family:ui-monospace,'Cascadia Mono',monospace; font-size:15px; line-height:1.9;">
          <div><span style="color:${CYAN};">$</span> gv session start</div>
          <div style="color:rgba(233,236,244,0.55);">[vanguard] pipeline · <span style="color:${CYAN};">96/96 PASS</span></div>
          <div style="color:rgba(233,236,244,0.55);">[vanguard] watchtower · <span style="color:#22C55E;">healthy</span></div>
        </div>
      </div>
    </div>
    <div>
      <div class="lbl2">Tarjeta</div>
      <div style="width:100%; aspect-ratio:1.75; background:${BG}; border:1px solid rgba(233,236,244,0.12); border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;">
        <img src="lockup-horizontal.svg" width="330">
        <div style="font-size:11px; letter-spacing:6px; color:${STEEL};">MMXXVI</div>
      </div>
    </div>
  </div>`,
  ),
);

console.log('✓ assets + 8 panels generated');
