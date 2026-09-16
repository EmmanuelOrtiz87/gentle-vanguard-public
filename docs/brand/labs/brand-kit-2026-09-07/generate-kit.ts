/**
 * generate-kit.ts — Gentle Vanguard brand kit (reference-definition build)
 * Fiel al board de referencia: ligadura GV azul (#1E40AF→#06B6D4), paleta
 * #0B1020 #1E40AF #06B6D4 #885CF6 #F8FAFC, tagline APRENDER·EXPERIMENTAR·
 * CONSTRUIR·TRANSFORMAR. Cada entregable = 1 imagen individual.
 * Run: node --import tsx generate-kit.ts  →  html/*.html + manifest.txt
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dirname, 'html');
const SVGD = join(__dirname, 'svg');
mkdirSync(HTML, { recursive: true });
mkdirSync(SVGD, { recursive: true });

// ---------- palette ----------
const NAVY = '#0B1020',
  BLUE = '#1E40AF',
  CYAN = '#06B6D4',
  PURPLE = '#885CF6',
  SNOW = '#F8FAFC';
const INK = '#0B1020',
  MIST = '#8CA3C7';

// ---------- deterministic rnd ----------
let _s = 7;
const rnd = () => (_s = (_s * 1103515245 + 12345) % 2147483648) / 2147483648;

// ============================================================
// GV LOGO — ligadura geométrica fiel a la referencia
// viewBox 0 0 560 430 · G center(185,215) RO150 RI82 mouth±35° · V polygon
// ============================================================
type LogoVariant = 'light' | 'dark' | 'white' | 'purple';
function gvMark(variant: LogoVariant, size = 280): string {
  const CX = 185,
    CY = 215,
    RO = 150,
    RI = 82,
    A = (35 * Math.PI) / 180;
  const ox = (r: number, a: number) => (CX + r * Math.cos(a)).toFixed(1);
  const oy = (r: number, a: number) => (CY - r * Math.sin(a)).toFixed(1);
  // annular sector: mouth open toward 0° (right), from +35° CCW to -35°
  const gPath =
    `M ${ox(RO, A)} ${oy(RO, A)} A ${RO} ${RO} 0 1 0 ${ox(RO, A)} ${oy(RO, -A)} ` +
    `L ${ox(RI, -A)} ${oy(RI, -A)} A ${RI} ${RI} 0 1 1 ${ox(RI, A)} ${oy(RI, A)} Z`;
  // crossbar: center → mouth outer edge at mid height
  const barX2 = (CX + RO * Math.cos(A)).toFixed(1);
  const bar = `M 185 181 L ${barX2} 181 L ${barX2} 249 L 185 249 Z`;
  // V polygon
  const vPath = `M 286 70 L 358 70 L 410 278 L 462 70 L 534 70 L 447 362 L 373 362 Z`;

  let defs = '',
    gFill = '',
    vFill = '';
  if (variant === 'light') {
    defs = `<linearGradient id="gvV" gradientUnits="userSpaceOnUse" x1="286" y1="70" x2="534" y2="362"><stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${CYAN}"/></linearGradient>`;
    gFill = BLUE;
    vFill = 'url(#gvV)';
  } else if (variant === 'dark' || variant === 'purple') {
    defs = `<linearGradient id="gvD" gradientUnits="userSpaceOnUse" x1="150" y1="360" x2="540" y2="60"><stop offset="0" stop-color="${BLUE}"/><stop offset="0.55" stop-color="${PURPLE}"/><stop offset="1" stop-color="${CYAN}"/></linearGradient>`;
    gFill = 'url(#gvD)';
    vFill = 'url(#gvD)';
  } else {
    gFill = SNOW;
    vFill = SNOW;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 430" width="${size}" height="${Math.round((size * 430) / 560)}"><defs>${defs}</defs><path d="${gPath}" fill="${gFill}"/><path d="${bar}" fill="${gFill}"/><path d="${vPath}" fill="${vFill}"/></svg>`;
}
const gvInner = (variant: LogoVariant) =>
  gvMark(variant)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/width="\d+" height="\d+" /, '');

// standalone svg files
writeFileSync(join(SVGD, 'gv-logo-light.svg'), gvMark('light', 560));
writeFileSync(join(SVGD, 'gv-logo-dark.svg'), gvMark('dark', 560));
writeFileSync(join(SVGD, 'gv-logo-white.svg'), gvMark('white', 560));
writeFileSync(join(SVGD, 'gv-logo-purple.svg'), gvMark('purple', 560));

// ---------- wordmark / tagline ----------
const wordmark = (color: string, fs: number, align: 'left' | 'center' = 'left') =>
  `<div style="font-family:Montserrat,sans-serif;font-weight:800;font-size:${fs}px;line-height:0.98;letter-spacing:0.5px;color:${color};text-align:${align};">GENTLE<br>VANGUARD</div>`;
const tagline = (color: string, fs: number, ls = '0.42em') =>
  `<div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:${fs}px;letter-spacing:${ls};color:${color};white-space:nowrap;">APRENDER&nbsp;&nbsp;·&nbsp;&nbsp;EXPERIMENTAR&nbsp;&nbsp;·&nbsp;&nbsp;CONSTRUIR&nbsp;&nbsp;·&nbsp;&nbsp;TRANSFORMAR</div>`;
const strip = (color: string, fs: number) =>
  `<div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:${fs}px;letter-spacing:0.38em;color:${color};white-space:nowrap;">GENTLE&nbsp;&nbsp;VANGUARD</div>`;

// ---------- panel shell ----------
const manifests: string[] = [];
function panel(name: string, w: number, h: number, bg: string, body: string): void {
  writeFileSync(
    join(HTML, name + '.html'),
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<link rel="stylesheet" href="../fonts/montserrat.css"><link rel="stylesheet" href="../fonts/space-grotesk.css">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden}
body{background:${bg};font-family:Montserrat,sans-serif}img,svg{display:block}</style></head>
<body>${body}</body></html>`,
  );
  manifests.push(`${name} ${w} ${h}`);
}

// ============================================================
// ART (SVG cinemático, sin fotos)
// ============================================================
function stars(n: number, w: number, h: number, op = 0.5): string {
  let s = '';
  for (let i = 0; i < n; i++)
    s += `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h * 0.7).toFixed(0)}" r="${(rnd() * 1.6 + 0.4).toFixed(1)}" fill="${SNOW}" opacity="${(rnd() * op).toFixed(2)}"/>`;
  return s;
}
function mountains(w: number, h: number, base: number, layers: string[]): string {
  const peaks = [
    [
      [0, base],
      [w * 0.09, base - h * 0.3],
      [w * 0.16, base - h * 0.12],
      [w * 0.27, base - h * 0.42],
      [w * 0.38, base - h * 0.1],
      [w * 0.5, base - h * 0.3],
      [w * 0.62, base - h * 0.08],
      [w * 0.74, base - h * 0.36],
      [w * 0.85, base - h * 0.14],
      [w, base - h * 0.28],
      [w, base],
      [0, base],
    ],
    [
      [0, base + h * 0.24],
      [w * 0.2, base + h * 0.02],
      [w * 0.42, base + h * 0.18],
      [w * 0.6, base - h * 0.04],
      [w * 0.78, base + h * 0.14],
      [w, base],
      [w, base + h * 0.3],
      [0, base + h * 0.3],
    ],
    [
      [0, base + h * 0.34],
      [w * 0.24, base + h * 0.14],
      [w * 0.5, base + h * 0.3],
      [w * 0.72, base + h * 0.1],
      [w, base + h * 0.26],
      [w, base + h * 0.42],
      [0, base + h * 0.42],
    ],
  ];
  return layers
    .map((c, i) => `<path d="M ${peaks[i].map((p) => p.join(' ')).join(' L ')} Z" fill="${c}"/>`)
    .join('');
}
function globe(size: number): string {
  const c = size / 2,
    r = size * 0.42;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 26; i++) {
    const th = rnd() * Math.PI * 2,
      ph = Math.acos(2 * rnd() - 1);
    const x = c + r * 0.96 * Math.sin(ph) * Math.cos(th),
      y = c + r * 0.96 * Math.cos(ph) * 0.92;
    if (Math.hypot(x - c, y - c) < r * 0.98) pts.push([x, y]);
  }
  let links = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const j = i + 1 + Math.floor(rnd() * 2);
    if (pts[j])
      links += `<line x1="${pts[i][0].toFixed(0)}" y1="${pts[i][1].toFixed(0)}" x2="${pts[j][0].toFixed(0)}" y2="${pts[j][1].toFixed(0)}" stroke="${CYAN}" stroke-width="1.4" opacity="0.4"/>`;
  }
  let nodes = '';
  for (const [x, y] of pts)
    nodes += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(rnd() * 3 + 2).toFixed(1)}" fill="${SNOW}" opacity="${(rnd() * 0.6 + 0.35).toFixed(2)}"/>`;
  const ell = (rx: number, ry: number, rot: number, op: number) =>
    `<ellipse cx="${c}" cy="${c}" rx="${rx}" ry="${ry}" fill="none" stroke="#7FB4FF" stroke-width="1.6" opacity="${op}" transform="rotate(${rot} ${c} ${c})"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="sph" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#16294F"/><stop offset="0.7" stop-color="#0C1631"/><stop offset="1" stop-color="#070D1D"/></radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0.72" stop-color="${CYAN}" stop-opacity="0"/><stop offset="0.94" stop-color="${CYAN}" stop-opacity="0.18"/><stop offset="1" stop-color="${CYAN}" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="${c}" cy="${c}" r="${r * 1.28}" fill="url(#glow)"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="url(#sph)" stroke="#3B5BA0" stroke-width="1.4"/>
  ${ell(r, r * 0.32, 8, 0.4)}${ell(r, r * 0.62, 8, 0.28)}${ell(r * 0.32, r, -8, 0.34)}${ell(r * 0.66, r, -8, 0.24)}
  ${links}${nodes}
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${CYAN}" stroke-width="1.6" opacity="0.5"/>
  <path d="M ${c - r * 1.12} ${c + r * 0.55} A ${r * 1.3} ${r * 1.3} 0 0 0 ${c + r * 1.05} ${c + r * 0.28}" fill="none" stroke="${PURPLE}" stroke-width="2.2" opacity="0.65"/>
</svg>`;
}
function person(x: number, y: number, s: number, color: string): string {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}">
  <circle cx="0" cy="0" r="26"/><path d="M -34 96 C -34 44 34 44 34 96 L 34 120 L -34 120 Z"/></g>`;
}
function chip(icon: string, label: string, color = SNOW, fs = 26): string {
  return `<div style="display:flex;align-items:center;gap:14px;"><span style="color:${CYAN};display:flex;">${icon}</span><span style="font-weight:600;font-size:${fs}px;color:${color};letter-spacing:0.04em;">${label}</span></div>`;
}
// minimal line icons (24 viewBox, stroke currentColor)
const I = (d: string) =>
  `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS: Record<string, string> = {
  cap: I('<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  users: I(
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16.5 14.6c2.9.4 5 2.5 5 5.4"/>',
  ),
  bulb: I(
    '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.9.7 1.6 1.3 1.6 2.2h4c0-.9.7-1.5 1.6-2.2A6 6 0 0 0 12 3z"/>',
  ),
  doc: I('<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5M9 13h7M9 17h7"/>'),
  gear: I(
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  ),
  chat: I(
    '<path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  ),
  q: I(
    '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.5A2.8 2.8 0 1 1 12 13v1.6"/><path d="M12 17.5h.01"/>',
  ),
  play: I('<circle cx="12" cy="12" r="9.5"/><path d="M10 8.5l6 3.5-6 3.5z"/>'),
  video: I(
    '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
  ),
  arrow: I('<path d="M4 12h15M13 6l6 6-6 6"/>'),
  wa: I(
    '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z"/><path d="M8.8 9.2c.3 2.6 3.4 5.7 6 6l1.4-1.4-2-1.3-1 .7c-.8-.4-1.9-1.5-2.4-2.4l.7-1-1.3-2z"/>',
  ),
  check: I('<path d="M4 12.5l5 5L20 6.5"/>'),
};

// ============================================================
// 1 · LOGO PRINCIPAL (2400×1200)
// ============================================================
panel(
  'logo-principal',
  2400,
  1200,
  SNOW,
  `
  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:110px;">
    ${gvMark('light', 760)}
    <div>
      ${wordmark(INK, 218)}
      <div style="height:34px"></div>
      ${tagline('#31415E', 30)}
    </div>
  </div>`,
);

// ============================================================
// 2 · VARIACIONES (900×900 c/u)
// ============================================================
const variations: Array<[string, string, (inner: string) => string]> = [
  [
    'variacion-obsidiana',
    NAVY,
    () => `
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;">
      ${gvMark('dark', 340)}${wordmark(SNOW, 84, 'center')}
    </div>`,
  ],
  [
    'variacion-perla',
    SNOW,
    () => `
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;">
      ${gvMark('light', 340)}${wordmark(INK, 84, 'center')}
    </div>`,
  ],
  [
    'variacion-gradiente',
    NAVY,
    () => `
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${gvMark('purple', 470)}</div>`,
  ],
];
for (const [n, bg, body] of variations) panel(n, 900, 900, bg, body());

// ============================================================
// 3 · ICONOS DE PERFIL RRSS (1080×1080 c/u)
// ============================================================
panel(
  'perfil-01-oscuro',
  1080,
  1080,
  NAVY,
  `
  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${gvMark('white', 620)}</div>`,
);
panel(
  'perfil-02-claro',
  1080,
  1080,
  SNOW,
  `
  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${gvMark('light', 620)}</div>`,
);
panel(
  'perfil-03-app',
  1080,
  1080,
  SNOW,
  `
  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
    <div style="width:880px;height:880px;border-radius:198px;background:${NAVY};display:flex;align-items:center;justify-content:center;box-shadow:0 40px 90px rgba(11,16,32,0.35);">
      ${gvMark('purple', 520)}
    </div>
  </div>`,
);

// ============================================================
// 4 · PALETA DE COLORES (2400×600)
// ============================================================
{
  const cols: Array<[string, string]> = [
    [NAVY, '#0B1020'],
    [BLUE, '#1E40AF'],
    [CYAN, '#06B6D4'],
    [PURPLE, '#885CF6'],
    [SNOW, '#F8FAFC'],
  ];
  panel(
    'paleta-colores',
    2400,
    600,
    SNOW,
    `
  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:120px;">
    ${cols
      .map(
        ([hex, label]) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:34px;">
      <div style="width:250px;height:250px;border-radius:50%;background:${hex};${hex === SNOW ? 'border:2px solid #D7DEEA;' : ''}"></div>
      <div style="font-weight:600;font-size:30px;letter-spacing:0.14em;color:#31415E;">${label}</div>
    </div>`,
      )
      .join('')}
  </div>`,
  );
}

// ============================================================
// 5 · BANNER WEB / LINKEDIN (2560×880)
// ============================================================
{
  _s = 11;
  const list = ['IA', 'SOFTWARE', 'AUTOMATIZACIÓN', 'TRANSFORMACIÓN DIGITAL', 'PARA UN FUTURO REAL']
    .map(
      (t) =>
        `<div style="font-weight:600;font-size:25px;letter-spacing:0.16em;color:${MIST};padding:13px 0;">${t}</div>`,
    )
    .join('');
  panel(
    'banner-web-linkedin',
    2560,
    880,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(115deg,${NAVY} 46%,#0D1B3E 78%,#10254F 100%);"></div>
    <div style="position:absolute;right:-130px;top:50%;transform:translateY(-50%);">${globe(880)}</div>
    ${/* stars */ ''}
    <div style="position:relative;height:100%;display:flex;flex-direction:column;padding:64px 90px;">
      <div style="display:flex;align-items:center;gap:26px;">${gvMark('white', 120)}
        <div style="font-weight:800;font-size:44px;line-height:1.02;color:${SNOW};">GENTLE<br>VANGUARD</div>
      </div>
      <div style="margin-top:52px;max-width:1180px;font-weight:700;font-size:56px;line-height:1.22;color:${SNOW};">
        Tecnología que las personas y organizaciones pueden entender,<br>aplicar y transformar en resultados.
      </div>
      <div style="margin-top:auto;display:flex;gap:64px;">
        ${chip(ICONS.cap, 'Capacitaciones')}${chip(ICONS.users, 'Consultoría')}${chip(ICONS.gear, 'Desarrollo')}${chip(ICONS.chat, 'Comunidad')}
      </div>
    </div>
    <div style="position:absolute;right:70px;top:0;height:100%;display:flex;flex-direction:column;justify-content:center;border-left:1px solid rgba(140,163,199,0.35);padding-left:44px;">${list}</div>
  </div>`,
  );
}

// ============================================================
// 6 · BANNER YOUTUBE (2560×1440 · contenido en zona segura central)
// ============================================================
{
  _s = 23;
  const cats = [
    ['video', 'IA'],
    ['gear', 'SOFTWARE'],
    ['cap', 'EDUCACIÓN'],
    ['users', 'CONSULTORÍA'],
    ['chat', 'COMUNIDAD'],
  ]
    .map(([ic, lb]) => chip(ICONS[ic], lb, SNOW, 24))
    .join('');
  panel(
    'banner-youtube',
    2560,
    1440,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,#0A1226 0%,#101E44 46%,#1B2F63 74%,#2A4180 100%);"></div>
    ${stars(90, 2560, 1000, 0.6)}
    <div style="position:absolute;left:0;right:0;bottom:0;">
      ${mountains(2560, 560, 1440, ['#152449', '#0E1834', '#0A1122'])}
    </div>
    <div style="position:absolute;right:430px;bottom:436px;opacity:0.92;">${person(0, 0, 1.15, '#070C1A')}</div>
    <div style="position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <div style="width:1546px;height:423px;display:flex;align-items:center;gap:70px;">
        ${gvMark('white', 300)}
        <div>
          ${wordmark(SNOW, 96)}
          <div style="height:22px"></div>
          ${tagline('#9DB4DE', 19)}
          <div style="height:34px"></div>
          <div style="display:flex;gap:44px;">${cats}</div>
        </div>
        <div style="margin-left:auto;text-align:right;font-weight:800;font-size:52px;line-height:1.28;color:${SNOW};">UN<br>FUTURO<br>MÁS HUMANO<br><span style="color:${CYAN};">CON TECNOLOGÍA</span></div>
      </div>
    </div>
  </div>`,
  );
}

// ============================================================
// 7 · PORTADA FACEBOOK (1704×630)
// ============================================================
{
  _s = 5;
  const right = ['PERSONAS', 'IDEAS', 'TECNOLOGÍA', 'OPORTUNIDADES', 'JUNTAS']
    .map(
      (t) =>
        `<div style="font-weight:600;font-size:22px;letter-spacing:0.18em;color:${MIST};padding:10px 0;">${t}</div>`,
    )
    .join('');
  const silhouettes =
    person(60, 330, 1.0, '#0E1B3C') +
    person(190, 345, 0.92, '#12244E') +
    person(320, 335, 1.05, '#0B1734');
  panel(
    'portada-facebook',
    1704,
    630,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(100deg,${NAVY} 42%,#0F1E44 100%);"></div>
    <div style="position:absolute;right:0;top:0;bottom:0;width:620px;background:linear-gradient(160deg,#182B5C,#0D1B3E);"></div>
    <div style="position:absolute;right:190px;bottom:-30px;opacity:0.9;">${silhouettes}</div>
    ${stars(40, 900, 400, 0.4).replace(/cx="(\d+)"/g, (m, x) => `cx="${Number(x) + 780}"`)}
    <div style="position:relative;height:100%;display:flex;flex-direction:column;padding:52px 74px;">
      <div style="display:flex;align-items:center;gap:20px;">${gvMark('white', 92)}
        <div style="font-weight:800;font-size:34px;line-height:1.02;color:${SNOW};">GENTLE<br>VANGUARD</div>
      </div>
      <div style="margin-top:36px;max-width:880px;font-weight:700;font-size:40px;line-height:1.25;color:${SNOW};">
        Una comunidad de tecnología<br>para aprender, compartir y construir el futuro.
      </div>
      <div style="margin-top:auto;">
        <span style="display:inline-block;background:${SNOW};color:${INK};font-weight:800;font-size:23px;letter-spacing:0.12em;padding:18px 42px;border-radius:40px;">SUMATE A LA COMUNIDAD</span>
      </div>
    </div>
    <div style="position:absolute;right:64px;top:0;height:100%;display:flex;flex-direction:column;justify-content:center;border-left:1px solid rgba(140,163,199,0.35);padding-left:36px;">${right}</div>
  </div>`,
  );
}

// ============================================================
// 8 · PORTADA X / TWITTER (1500×500)
// ============================================================
{
  _s = 31;
  const right = ['IA', 'Software', 'Comunidad', 'Capacitación', 'Consultoría']
    .map(
      (t) => `<div style="font-weight:600;font-size:24px;color:#C9D6EE;padding:9px 0;">${t}</div>`,
    )
    .join('');
  panel(
    'portada-x',
    1500,
    500,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,#0A1226 0%,#13224A 70%,#1A2C5E 100%);"></div>
    ${stars(50, 1500, 320, 0.55)}
    <div style="position:absolute;left:0;right:0;bottom:0;">${mountains(1500, 240, 500, ['#14234A', '#0C1631', '#080E20'])}</div>
    <div style="position:relative;height:100%;display:flex;align-items:center;padding:0 70px;gap:60px;">
      <div style="font-weight:700;font-size:44px;line-height:1.24;color:${SNOW};max-width:430px;">Tecnología<br>que impulsa<br>personas.</div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:34px;">
        <div style="text-align:right;">${right}</div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:14px;">${gvMark('white', 210)}
          <div style="font-weight:800;font-size:26px;line-height:1.05;color:${SNOW};text-align:center;">GENTLE<br>VANGUARD</div>
        </div>
      </div>
    </div>
  </div>`,
  );
}

// ============================================================
// 9 · PORTADA TIKTOK / INSTAGRAM (1704×630)
// ============================================================
{
  // particle face profile (abstract)
  _s = 17;
  const cubic = (p0: number[], p1: number[], p2: number[], p3: number[], t: number) => {
    const u = 1 - t;
    return [
      u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
    ];
  };
  const segs: number[][][] = [
    [
      [1210, 60],
      [1140, 150],
      [1160, 240],
      [1128, 318],
    ],
    [
      [1128, 318],
      [1108, 362],
      [1148, 384],
      [1136, 412],
    ],
    [
      [1136, 412],
      [1124, 442],
      [1170, 470],
      [1166, 520],
    ],
    [
      [1166, 520],
      [1162, 574],
      [1240, 588],
      [1268, 640],
    ],
  ];
  let dots = '';
  for (const s of segs)
    for (let i = 0; i <= 26; i++) {
      const [x, y] = cubic(s[0], s[1], s[2], s[3], i / 26);
      const col = y < 300 ? SNOW : y < 440 ? CYAN : PURPLE;
      dots += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(rnd() * 3.4 + 1.4).toFixed(1)}" fill="${col}" opacity="${(rnd() * 0.55 + 0.35).toFixed(2)}"/>`;
    }
  for (let i = 0; i < 130; i++) {
    const x = 1050 + rnd() * 420,
      y = rnd() * 630;
    if (rnd() < 0.6)
      dots += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(rnd() * 2.2 + 0.5).toFixed(1)}" fill="${rnd() < 0.5 ? CYAN : SNOW}" opacity="${(rnd() * 0.3).toFixed(2)}"/>`;
  }
  panel(
    'portada-tiktok-instagram',
    1704,
    630,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(75deg,${NAVY} 40%,#101F48 76%,#182C63 100%);"></div>
    <svg width="1704" height="630" viewBox="0 0 1704 630" style="position:absolute;inset:0;">${dots}</svg>
    <div style="position:relative;height:100%;display:flex;align-items:center;padding:0 84px;">
      <div style="font-weight:800;font-size:78px;line-height:1.12;color:${SNOW};">IDEAS<br>HOY<br>UN MEJOR<br><span style="color:${CYAN};">MAÑANA</span></div>
      <div style="margin-left:auto;display:flex;flex-direction:column;align-items:center;gap:16px;background:rgba(11,16,32,0.55);border:1px solid rgba(140,163,199,0.28);border-radius:28px;padding:40px 48px;backdrop-filter:blur(6px);">
        ${gvMark('white', 190)}
        <div style="font-weight:800;font-size:25px;line-height:1.05;color:${SNOW};text-align:center;">GENTLE<br>VANGUARD</div>
      </div>
    </div>
  </div>`,
  );
}

// ============================================================
// 10 · PLANTILLAS DE POSTS (1080×1080 ×7)
// ============================================================
const brandFoot = (dark = true) => `
  <div style="position:absolute;left:64px;bottom:48px;display:flex;align-items:center;gap:16px;">
    ${gvMark(dark ? 'white' : 'light', 74)}
    <div style="font-weight:800;font-size:24px;line-height:1.05;color:${dark ? SNOW : INK};">GENTLE<br>VANGUARD</div>
  </div>`;

// post 01 — 5 herramientas
{
  _s = 3;
  const codeLines = Array.from(
    { length: 7 },
    (_, i) =>
      `<rect x="0" y="${i * 26}" width="${60 + rnd() * 150}" height="9" rx="4.5" fill="${[CYAN, PURPLE, '#3B5BA0', SNOW][i % 4]}" opacity="0.75"/>`,
  ).join('');
  panel(
    'post-01-5-herramientas',
    1080,
    1080,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:radial-gradient(120% 90% at 85% 100%,#15254E 0%,${NAVY} 60%);"></div>
    ${stars(30, 1080, 500, 0.4)}
    <div style="position:relative;padding:96px 90px 0;">
      <div style="font-weight:800;font-size:200px;line-height:1;color:${SNOW};">5</div>
      <div style="margin-top:18px;font-weight:700;font-size:64px;line-height:1.22;color:${SNOW};">herramientas<br>de IA que deberías<br>probar hoy.</div>
    </div>
    <svg width="470" height="330" viewBox="0 0 470 330" style="position:absolute;right:64px;bottom:150px;">
      <rect x="60" y="20" width="350" height="220" rx="16" fill="#0E1B3C" stroke="#3B5BA0" stroke-width="3"/>
      <rect x="82" y="44" width="306" height="150" rx="8" fill="#0A1329"/>
      <g transform="translate(100 58)">${codeLines}</g>
      <path d="M 20 250 L 450 250 L 470 300 Q 470 312 450 312 L 20 312 Q 0 312 0 300 Z" fill="#16294F" stroke="#3B5BA0" stroke-width="3"/>
      <rect x="185" y="264" width="100" height="14" rx="7" fill="#0A1329"/>
    </svg>
    <div style="position:absolute;left:90px;bottom:170px;width:88px;height:88px;border-radius:50%;border:3px solid ${CYAN};display:flex;align-items:center;justify-content:center;color:${CYAN};">${ICONS.arrow}</div>
    ${brandFoot(true)}
  </div>`,
  );
}

// post 02 — automatiza
panel(
  'post-02-automatiza',
  1080,
  1080,
  SNOW,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#FFFFFF 55%,#E8F4FB 100%);"></div>
    <div style="position:relative;padding:96px 90px 0;">
      <div style="font-weight:800;font-size:76px;line-height:1.14;color:${INK};">Automatiza<br>tareas, libera<br>tu tiempo.</div>
      <div style="margin-top:30px;font-weight:600;font-size:27px;line-height:1.5;color:#48597B;">La tecnología trabaja mejor<br>cuando la entiendes.</div>
    </div>
    <svg width="430" height="430" viewBox="0 0 430 430" style="position:absolute;right:70px;bottom:120px;">
      <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CYAN}"/><stop offset="1" stop-color="${PURPLE}"/></linearGradient></defs>
      <circle cx="215" cy="215" r="200" fill="#EAF7FD"/>
      <rect x="115" y="120" width="200" height="160" rx="46" fill="url(#rg)"/>
      <circle cx="175" cy="195" r="26" fill="${SNOW}"/><circle cx="255" cy="195" r="26" fill="${SNOW}"/>
      <circle cx="175" cy="195" r="10" fill="${INK}"/><circle cx="255" cy="195" r="10" fill="${INK}"/>
      <rect x="190" y="238" width="50" height="12" rx="6" fill="${SNOW}"/>
      <line x1="215" y1="120" x2="215" y2="84" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
      <circle cx="215" cy="70" r="14" fill="${CYAN}"/>
      <rect x="150" y="292" width="130" height="26" rx="13" fill="${INK}"/>
    </svg>
    ${brandFoot(false)}
  </div>`,
);

// post 03 — sabías que + checklist
panel(
  'post-03-sabias',
  1080,
  1080,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:radial-gradient(110% 80% at 20% 0%,#15254E 0%,${NAVY} 62%);"></div>
    <div style="position:relative;padding:88px 90px 0;">
      <div style="font-weight:800;font-size:58px;color:${SNOW};">¿Sabías que...?</div>
      <div style="margin-top:12px;font-weight:600;font-size:30px;color:#9DB4DE;">La IA puede hacer esto por vos.</div>
      <div style="margin-top:44px;background:${SNOW};border-radius:26px;padding:46px 54px;display:flex;flex-direction:column;gap:26px;max-width:640px;">
        ${['Resumir documentos', 'Analizar datos', 'Generar reportes', 'Responder consultas']
          .map(
            (t) => `
        <div style="display:flex;align-items:center;gap:20px;font-weight:700;font-size:31px;color:${INK};">
          <span style="color:${CYAN};">${ICONS.check}</span>${t}</div>`,
          )
          .join('')}
        <div style="font-weight:700;font-size:29px;color:#68789B;">Y mucho más...</div>
      </div>
    </div>
    ${brandFoot(true)}
  </div>`,
);

// post 04 — workshop
panel(
  'post-04-workshop',
  1080,
  1080,
  SNOW,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,#FFFFFF 60%,#EDF3FC 100%);"></div>
    <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;">
      <div style="font-weight:800;font-size:88px;color:${BLUE};">Workshop</div>
      <div style="font-weight:800;font-size:88px;color:${CYAN};margin-top:-8px;">Gratuito</div>
      <div style="margin-top:26px;font-weight:700;font-size:36px;color:${INK};">Introducción práctica<br>a la Inteligencia Artificial</div>
      <div style="margin-top:44px;display:flex;flex-direction:column;gap:20px;font-weight:600;font-size:30px;color:#33436A;">
        <div style="display:flex;align-items:center;gap:18px;justify-content:center;"><span style="color:${BLUE};">${ICONS.cal}</span>19 de Mayo (ARG)</div>
        <div style="display:flex;align-items:center;gap:18px;justify-content:center;"><span style="color:${BLUE};">${ICONS.play}</span>19:00 hs (ARG)</div>
        <div style="display:flex;align-items:center;gap:18px;justify-content:center;"><span style="color:${BLUE};">${ICONS.video}</span>Online · Zoom</div>
      </div>
      <div style="margin-top:52px;background:${INK};color:${SNOW};font-weight:800;font-size:29px;letter-spacing:0.06em;padding:24px 66px;border-radius:46px;">¡Reservá tu lugar!</div>
    </div>
    ${brandFoot(false)}
  </div>`,
);

// post 05 — quote
panel(
  'post-05-quote',
  1080,
  1080,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:radial-gradient(120% 100% at 80% 20%,#142449 0%,${NAVY} 60%);"></div>
    ${stars(26, 1080, 400, 0.35)}
    <div style="position:relative;padding:110px 100px 0;">
      <div style="font-family:Georgia,serif;font-size:230px;line-height:0.6;color:${CYAN};">“</div>
      <div style="margin-top:30px;font-weight:700;font-size:62px;line-height:1.32;color:${SNOW};">La tecnología<br>no reemplaza personas,<br>potencia <span style="color:${CYAN};">su mejor versión.</span></div>
    </div>
    ${brandFoot(true)}
  </div>`,
);

// post 06 — aprender experimentar
{
  _s = 41;
  const code = Array.from(
    { length: 9 },
    (_, i) =>
      `<rect x="0" y="${i * 30}" width="${50 + rnd() * 190}" height="10" rx="5" fill="${[CYAN, PURPLE, '#5F7AC2', SNOW][i % 4]}" opacity="0.8"/>`,
  ).join('');
  panel(
    'post-06-aprender',
    1080,
    1080,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(115deg,${NAVY} 48%,#101F48 100%);"></div>
    <svg width="500" height="560" viewBox="0 0 500 560" style="position:absolute;right:0;top:110px;opacity:0.95;">
      <rect x="20" y="10" width="460" height="540" rx="20" fill="#0A1329" stroke="#2C4A8C" stroke-width="3"/>
      <rect x="20" y="10" width="460" height="56" rx="20" fill="#101E44"/>
      <circle cx="56" cy="38" r="8" fill="#3B5BA0"/><circle cx="84" cy="38" r="8" fill="#3B5BA0"/><circle cx="112" cy="38" r="8" fill="#3B5BA0"/>
      <g transform="translate(56 100)">${code}</g>
    </svg>
    <div style="position:relative;padding:120px 0 0 90px;max-width:560px;">
      <div style="font-weight:800;font-size:74px;line-height:1.3;color:${SNOW};">Aprender.<br>Experimentar.<br>Construir.<br><span style="color:${CYAN};">Transformar.</span></div>
    </div>
    ${brandFoot(true)}
  </div>`,
  );
}

// post 07 — próximo nivel
panel(
  'post-07-proximo-nivel',
  1080,
  1080,
  SNOW,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(170deg,#FFFFFF 52%,#E9F1FA 100%);"></div>
    <svg width="480" height="440" viewBox="0 0 480 440" style="position:absolute;left:60px;bottom:130px;">
      <circle cx="120" cy="90" r="46" fill="#F5C86E"/>
      <path d="M 0 440 L 150 200 L 240 340 L 330 160 L 480 440 Z" fill="#2B3F6E"/>
      <path d="M 150 200 L 195 262 L 165 258 L 190 232 Z" fill="${SNOW}" opacity="0.85"/>
      <line x1="330" y1="160" x2="330" y2="86" stroke="${INK}" stroke-width="9"/>
      <path d="M 330 86 L 402 104 L 330 126 Z" fill="${PURPLE}"/>
    </svg>
    <div style="position:relative;padding:110px 90px 0;">
      <div style="font-weight:800;font-size:84px;line-height:1.16;color:${INK};">Tu próximo<br>nivel comienza<br><span style="color:${BLUE};">aquí.</span></div>
    </div>
    <div style="position:absolute;right:90px;bottom:170px;display:flex;flex-direction:column;gap:20px;font-weight:700;font-size:31px;color:#33436A;">
      ${['Cursos', 'Consultoría', 'Comunidad', 'Soporte'].map((t) => `<div style="display:flex;align-items:center;gap:16px;"><span style="color:${CYAN};">${ICONS.check}</span>${t}</div>`).join('')}
    </div>
    <div style="position:absolute;right:90px;bottom:64px;width:76px;height:76px;border-radius:50%;background:${INK};color:${SNOW};display:flex;align-items:center;justify-content:center;">${ICONS.arrow}</div>
    ${brandFoot(false)}
  </div>`,
);

// ============================================================
// 11 · STORIES (1080×1920 ×5)
// ============================================================
panel(
  'story-01-nuevo-video',
  1080,
  1920,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 30%,#15254E 0%,${NAVY} 70%);"></div>
    ${stars(46, 1080, 900, 0.5)}
    <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;text-align:center;padding:0 90px;">
      <div style="width:190px;height:190px;border-radius:50%;background:${CYAN};display:flex;align-items:center;justify-content:center;color:${NAVY};">
        <svg width="86" height="86" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>
      </div>
      <div style="font-weight:800;font-size:96px;color:${SNOW};">Nuevo<br>Video</div>
      <div style="font-weight:600;font-size:38px;color:#9DB4DE;">¡No te lo pierdas!<br>Entrá ahora</div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:90px;display:flex;justify-content:center;gap:18px;align-items:center;">
      ${gvMark('white', 64)}<span style="color:#9DB4DE;font-weight:700;font-size:24px;letter-spacing:0.3em;">GENTLE VANGUARD</span>
    </div>
  </div>`,
);

panel(
  'story-02-disciplina',
  1080,
  1920,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,#0D1834 0%,${NAVY} 60%);"></div>
    ${stars(36, 1080, 700, 0.4)}
    <div style="position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 100px;">
      <div style="font-family:Georgia,serif;font-size:260px;line-height:0.55;color:${PURPLE};">“</div>
      <div style="margin-top:26px;font-weight:800;font-size:92px;line-height:1.22;color:${SNOW};">Disciplina<br>hoy.<br>Resultados<br>mañana.</div>
    </div>
    <div style="position:absolute;left:100px;bottom:100px;display:flex;align-items:center;gap:18px;">
      ${gvMark('white', 64)}<span style="color:#9DB4DE;font-weight:700;font-size:24px;letter-spacing:0.3em;">GENTLE VANGUARD</span>
    </div>
  </div>`,
);

panel(
  'story-03-encuesta',
  1080,
  1920,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:radial-gradient(130% 70% at 50% 20%,#13234C 0%,${NAVY} 68%);"></div>
    <div style="position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 96px;gap:60px;">
      <div style="font-weight:800;font-size:84px;line-height:1.2;color:${SNOW};">¿Qué tema<br>te interesa?</div>
      ${['IA', 'Programación', 'Automatización', 'Otros...']
        .map(
          (t, i) => `
      <div style="border:2.5px solid ${i === 0 ? CYAN : 'rgba(157,180,222,0.5)'};color:${i === 0 ? CYAN : SNOW};border-radius:60px;padding:34px 54px;font-weight:700;font-size:44px;text-align:center;">${t}</div>`,
        )
        .join('')}
    </div>
    <div style="position:absolute;left:0;right:0;bottom:90px;display:flex;justify-content:center;gap:18px;align-items:center;">
      ${gvMark('white', 64)}<span style="color:#9DB4DE;font-weight:700;font-size:24px;letter-spacing:0.3em;">GENTLE VANGUARD</span>
    </div>
  </div>`,
);

panel(
  'story-04-envivo',
  1080,
  1920,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(200deg,#16295A 0%,${NAVY} 65%);"></div>
    ${stars(40, 1080, 800, 0.5)}
    <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;text-align:center;padding:0 90px;">
      <div style="display:flex;align-items:center;gap:16px;background:#E11D48;border-radius:40px;padding:16px 40px;">
        <span style="width:20px;height:20px;border-radius:50%;background:${SNOW};display:inline-block;"></span>
        <span style="color:${SNOW};font-weight:800;font-size:32px;letter-spacing:0.2em;">EN VIVO</span>
      </div>
      <div style="font-weight:800;font-size:130px;color:${SNOW};">HOY</div>
      <div style="font-weight:700;font-size:52px;color:#9DB4DE;">19:00 hs (ARG)</div>
      <div style="font-weight:700;font-size:40px;color:${CYAN};">¡Te esperamos!</div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:90px;display:flex;justify-content:center;gap:18px;align-items:center;">
      ${gvMark('white', 64)}<span style="color:#9DB4DE;font-weight:700;font-size:24px;letter-spacing:0.3em;">GENTLE VANGUARD</span>
    </div>
  </div>`,
);

panel(
  'story-05-comunidad',
  1080,
  1920,
  NAVY,
  `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 35%,#122250 0%,${NAVY} 70%);"></div>
    ${stars(34, 1080, 760, 0.4)}
    <div style="position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:60px;text-align:center;padding:0 90px;">
      <div style="font-weight:800;font-size:88px;line-height:1.18;color:${SNOW};">Únete a<br>nuestra<br>comunidad</div>
      <div style="background:#0E1B3C;border:2px solid #25D366;border-radius:32px;padding:44px 60px;display:flex;flex-direction:column;align-items:center;gap:22px;">
        <span style="color:#25D366;">${ICONS.wa.replace('width="30" height="30"', 'width="92" height="92"')}</span>
        <div style="font-weight:700;font-size:36px;color:${SNOW};">WhatsApp<br>Gentle Vanguard</div>
      </div>
      <div style="background:#25D366;color:#06281A;font-weight:800;font-size:38px;padding:26px 90px;border-radius:54px;">Sumate</div>
    </div>
  </div>`,
);

// ============================================================
// 12 · ICONOS DESTACADOS (480×480 c/u + sheet)
// ============================================================
{
  const items: Array<[string, string]> = [
    ['cursos', 'cap'],
    ['eventos', 'cal'],
    ['comunidad', 'users'],
    ['tips', 'bulb'],
    ['recursos', 'doc'],
    ['servicios', 'gear'],
    ['testimonios', 'chat'],
    ['faq', 'q'],
  ];
  for (const [name, ic] of items) {
    panel(
      'destacado-' + name,
      480,
      480,
      SNOW,
      `
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <div style="width:400px;height:400px;border-radius:50%;background:${NAVY};border:6px solid #1C2C55;display:flex;align-items:center;justify-content:center;color:${SNOW};">
        ${ICONS[ic].replace('width="30" height="30"', 'width="150" height="150"').replace('stroke-width="1.8"', 'stroke-width="1.4"')}
      </div>
    </div>`,
    );
  }
  panel(
    'destacados-sheet',
    2048,
    560,
    SNOW,
    `
  <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:56px;">
    ${items
      .map(
        ([name, ic]) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:22px;">
      <div style="width:280px;height:280px;border-radius:50%;background:${NAVY};display:flex;align-items:center;justify-content:center;color:${SNOW};">
        ${ICONS[ic].replace('width="30" height="30"', 'width="104" height="104"').replace('stroke-width="1.8"', 'stroke-width="1.4"')}
      </div>
      <div style="font-weight:700;font-size:30px;color:${INK};">${name[0].toUpperCase() + name.slice(1)}</div>
    </div>`,
      )
      .join('')}
  </div>`,
  );
}

// ============================================================
// 13 · PLANTILLA CTA (1600×900)
// ============================================================
{
  _s = 55;
  panel(
    'plantilla-cta',
    1600,
    900,
    NAVY,
    `
  <div style="position:relative;width:100%;height:100%;overflow:hidden;">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,#0A1226 0%,#122250 58%,#1C3070 100%);"></div>
    ${stars(60, 1600, 560, 0.55)}
    <div style="position:absolute;left:0;right:0;bottom:0;">${mountains(1600, 330, 900, ['#152449', '#0D1733', '#080E20'])}</div>
    <div style="position:absolute;right:56px;top:44px;">${gvMark('white', 120)}</div>
    <div style="position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 100px;gap:52px;">
      <div style="font-weight:800;font-size:88px;line-height:1.18;color:${SNOW};">MÁS<br>CONOCIMIENTO.<br>MÁS <span style="color:${CYAN};">POSIBILIDADES.</span></div>
      <div><span style="display:inline-flex;align-items:center;gap:20px;background:${SNOW};color:${INK};font-weight:800;font-size:30px;letter-spacing:0.1em;padding:26px 58px;border-radius:54px;">SUMATE A GENTLE VANGUARD <span style="color:${BLUE};">${ICONS.arrow}</span></span></div>
    </div>
  </div>`,
  );
}

// ============================================================
writeFileSync(join(__dirname, 'manifest.txt'), manifests.join('\n') + '\n');
console.log(`✓ ${manifests.length} panels + 4 logo svgs`);
