import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PageLite, ReportBundle, WindowCounts } from './types.js';
import { summarizeSpace } from './analyze.js';

export function renderReportHtml(data: ReportBundle): string {
const {
  pages,
  dgo,
  field,
  kw,
  totals,
  extra,
  census,
  tree,
  others = [],
  analytics,
  stamp = '2026-11-24',
  now = '2026-11-24T18:00:00Z',
} = data;
const ROOT = process.cwd();
const STAMP = stamp;
const coverDate = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${STAMP}T12:00:00Z`));

const nf = new Intl.NumberFormat('es-AR');
const fmt = (n: number | null | undefined) => (n === -1 || n === null || n === undefined ? 's/d' : nf.format(n));
const pct = (a: number, b: number, d = 1) => (b ? `${((a / b) * 100).toFixed(d).replace('.', ',')}%` : '—');
const DAY = 86400000;
const NOW = Date.parse(now);
const age = (p: PageLite) => (p.lastModified ? (NOW - Date.parse(p.lastModified)) / DAY : Infinity);
const isTest = (p: PageLite) => /prueba narrativa|TEST - MCP/i.test(p.title);
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const FAM = {
  'Kuiper': /\bkuiper\b/i,
  'Buyflow / Buyflow 2.0': /\b(buy\s?flow|buyflow)\b/i,
  'Selfcare / Selfcare 2.0': /\b(self[\s-]?care)\b/i,
  'Pagos y billing': /\b(payment|pagos|vindicia|cybersource|payu|webill|billing|checkout|magento|facturaci)\b/i,
  'Package & Entitlement': /\b(entitlement|derechos|direitos|rights|package)/i,
  'Auth / SSO ForgeRock': /\b(auth|login|log[\s-]?in|sso|forgerock|oauth)\b/i,
  'Playback / DRM / Player': /\b(playback|streaming|drm|player|manifest|encoding)/i,
  'CDN (Akamai)': /\b(cdn|akamai)\b/i,
  'CMS / Liferay / ACTool': /\b(cms|actool|liferay)\b/i,
  'HUB de contenido': /\bhub\b/i,
  'VMS / VLS': /\b(vms|vls)\b/i,
  'Catálogo / EPG / Metadata': /\b(catalog|catalogo|catálogo|epg|metadata|metadatos)\b/i,
  'Ingesta / Transcoding': /\b(ingest|transcod|encoding)\b/i,
  'DRM / Content Protection': /\b(drm|widevine|fairplay|playready|antipiracy|protecci)/i,
  'Monitoreo / Observabilidad': /\b(datadog|bigpanda|appdynamics|npaw|youbora|conviva|pingdom|monitoring|monitoreo)\b/i,
  'Analytics / Tagueamento': /\b(analytics|tagueamento|ga4|tracking)\b/i,
  'Notificaciones / Email / Push': /\b(notification|email|e-mail|push|sms)\b/i,
  'Search / Recomendaciones': /\b(search|busca|búsqueda|recommend|recomenda|spideo|thinkanalytics)/i,
  'Data Platform / Datalake': /\b(datalake|data\s?platform|delta\s?sync|data\s?services|dw_|dl_|dataset)\b/i,
  'Chatbot / Overchat': /\b(chatbot|overchat|watson)\b/i,
  'Plataforma Roku': /\broku\b/i,
  'Plataforma Android': /\bandroid/i,
  'Plataforma iOS': /\b(ios|iphone|ipad)\b/i,
  'Plataforma HTML5 / Web': /\b(html5|web\s?public|pwa|dtvweb)\b/i,
  'Plataforma FireTV': /\bfire\s?tv/i,
  'Plataforma AppleTV': /\bapple\s?tv/i,
  'Plataforma STB / SmartTV': /\b(stb|set\s?top|smart\s?tv|samsung|lg\b)/i,
  'Producto DTV GO': /\bdtv\s?go\b/i,
  'Producto SKY+': /sky\+|\bsky\s?plus\b/i,
  'Producto DGO': /\bdgo\b/i,
  'Producto Streamco': /\bstreamco\b/i,
  'Integraciones / Partners': /\b(disney|hbo|paramount|atresplayer|ufc|fight\s?pass|mega\s?go|prime\s?video|star\+)/i,
  'Proyecto Alcatraz': /\balcatraz\b/i,
  'Proyecto Kraken (deeplinks)': /\bkraken\b/i,
  'Orbis (legacy)': /\borbis\b/i,
};

const famStats = Object.entries(FAM).map(([name, re]) => {
  const m = pages.filter((p) => re.test(p.title) && !isTest(p));
  const a = m.map(age);
  const newest = m.slice().sort((x, y) => (y.lastModified || '').localeCompare(x.lastModified || ''))[0];
  const dgom = dgo.filter((p) => re.test(p.title));
  return {
    name,
    pages: m.length,
    dgo: dgom.length,
    d30: a.filter((x) => x <= 30).length,
    d90: a.filter((x) => x <= 90).length,
    y1: a.filter((x) => x <= 365).length,
    stale: a.filter((x) => x > 365).length,
    newest: newest?.lastModified?.slice(0, 10) || '—',
    anchorId: newest?.id || null,
    anchorTitle: newest?.title || '',
  };
});
type FamStat = (typeof famStats)[number];
const EMPTY_FAM = {
  name: '',
  pages: 0,
  dgo: 0,
  d30: 0,
  d90: 0,
  y1: 0,
  stale: 0,
  newest: '—',
  anchorId: null as string | null,
  anchorTitle: '',
};
const fam = (n: string): FamStat => famStats.find((f) => f.name === n) ?? { ...EMPTY_FAM, name: n };

const otherSpaces = others.map((space) => {
  const inSpace = space.pages.filter((p) => !isTest(p));
  const summary = summarizeSpace(inSpace, NOW);
  const topFams = Object.entries(FAM)
    .map(([name, re]) => [name, inSpace.filter((p) => re.test(p.title)).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return {
    key: space.key,
    name: space.name,
    total: summary.total,
    d30: summary.d30,
    stale: summary.staleOverYear,
    read: summary.read,
    top: topFams,
  };
});
const othersTotal = otherSpaces.reduce((a, s) => a + s.total, 0);
const otherNames = otherSpaces.map((s) => s.key).join(' y ');

const total = pages.length;
const upd30 = pages.filter((p) => age(p) <= 30).length;
const upd90 = pages.filter((p) => age(p) <= 90).length;
const upd1y = pages.filter((p) => age(p) <= 365).length;
const stale = total - upd1y;
const dgoStale = dgo.filter((p) => age(p) > 365).length;

const byClass = census.inventory.byClass as Record<string, number>;
const compTotal = Object.values(byClass).reduce((a, b) => a + b, 0);

const fieldRows = Object.entries(field.counts).sort((a, b) => b[1].all - a[1].all);

const kwRows = [
  ['activaciones (activación/ativacao/provisioning)', 'activations', 'Tema transversal: activación de cuentas y extras'],
  ['DGO', 'dgo', 'Producto'],
  ['pagos (payment/pago/pagamento)', 'payments', 'Tema: pagos y checkout'],
  ['SKY+', 'sky', 'Producto'],
  ['auth (login/authentication/forgerock)', 'auth', 'Sistema: acceso'],
  ['playback / streaming / player', 'playback', 'Sistema: reproducción'],
  ['notificaciones / email / push / sms', 'notifications', 'Sistema: mensajería'],
  ['entitlements / derechos / rights', 'entitlements', 'Sistema: derechos'],
  ['CMS', 'cms', 'Sistema: gestión de contenidos'],
  ['catálogo / metadata', 'catalog', 'Sistema: catálogo'],
  ['CDN', 'cdn', 'Sistema: entrega'],
  ['Roku', 'roku', 'Plataforma'],
  ['Android', 'android', 'Plataforma'],
  ['iOS', 'ios', 'Plataforma'],
  ['HTML5', 'html5', 'Plataforma'],
  ['FireTV', 'firetv', 'Plataforma'],
  ['AppleTV', 'appletv', 'Plataforma'],
  ['Buyflow', 'buyflow', 'Sistema: comercio'],
  ['Selfcare', 'selfcare', 'Sistema: autogestión'],
  ['Kuiper', 'kuiper', 'Plataforma: e-commerce'],
  ['Orbis', 'orbis', 'Sistema legacy'],
  ['Kraken', 'kraken', 'SDK deeplinks'],
];

const topViewedMap = (title: string) => {
  const t = title.toLowerCase();
  if (/buy flow|buyflow|checkout/.test(t)) return 'Buyflow';
  if (/kraken/.test(t)) return 'Kraken';
  if (/alcatraz/.test(t)) return 'Alcatraz';
  if (/roku/.test(t)) return 'Roku';
  if (/self[\s-]?care/.test(t)) return 'Selfcare';
  if (/forgerock|sso|login/.test(t)) return 'Auth';
  if (/estream|playback|player/.test(t)) return 'Playback';
  if (/email/.test(t)) return 'Notificaciones';
  if (/design|ux/.test(t)) return 'UX / Design';
  if (/dgo|dtvgo|dtv go/.test(t)) return 'DGO / DTV GO';
  if (/kuiper/.test(t)) return 'Kuiper';
  if (/dl_|dw_|data/.test(t)) return 'Data Platform';
  if (/content hub|hub/.test(t)) return 'HUB';
  if (/vindicia|payment/.test(t)) return 'Pagos';
  if (/disney|hbo|atresmedia|amc|turner|viacom/.test(t)) return 'Partners';
  if (/catalog/.test(t)) return 'Catálogo';
  if (/recommend/.test(t)) return 'Search / Recs';
  return 'Otros / general';
};

const trend = extra.weeks.map((w) => ({ ...w, max: Math.max(...w.series, 1) }));
const wkLabels = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);

const b64 = (p: string) => readFileSync(p).toString('base64');
const FONT_DIRS = [
  resolve(ROOT, 'apps/academy-landing/fonts'),
  resolve(ROOT, '.runtime/academy-transparencia-publicacion-20261017/fonts'),
];
const FONT_DIR = FONT_DIRS.find((dir) => {
  try {
    readFileSync(resolve(dir, 'Inter-400.woff2'));
    return true;
  } catch {
    return false;
  }
});
const readFont = (file: string) => (FONT_DIR ? b64(resolve(FONT_DIR, file)) : '');
const fonts = {
  r: readFont('Inter-400.woff2'),
  m: readFont('Poppins-600.woff2'),
  b: readFont('Poppins-700.woff2'),
};
if (!FONT_DIR) console.warn('[report] fuentes self-hosted no encontradas: se usa fallback del sistema');
const dupe = {
  clusters: Number(census?.duplicates?.totalClusters ?? 323),
  pages: Number(census?.duplicates?.clusteredPages ?? 2407),
};
const attachCats = (census.attachmentFormats?.byCategory ?? []) as Array<{ categoria: string; cantidad: number }>;
const MSSVC = 'ms&#8209;buy&#8209;flow&#8209;mw&#8209;global';

const bar = (v: number, max: number, color = '#0891B2') =>
  `<span class="bar"><span style="width:${Math.max(2, Math.round((v / max) * 100))}%;background:${color}"></span></span>`;

const fieldTable = (rows: Array<[string, WindowCounts]>, label: string) => `
<table class="data">
  <thead><tr><th class="w-num">${label}</th><th class="num">30 días</th><th class="num">90 días</th><th class="num">1 año</th><th class="num">Histórico</th><th class="num">Abiertos</th><th>Lectura</th></tr></thead>
  <tbody>
  ${rows
    .map(
      ([k, v]) => `<tr>
      <td class="sys">${esc(k)}</td>
      <td class="num">${fmt(v.d30)}</td>
      <td class="num">${fmt(v.d90)}</td>
      <td class="num">${fmt(v.y1)}</td>
      <td class="num b">${fmt(v.all)}</td>
      <td class="num">${fmt(v.open)}</td>
      <td class="muted">${
        k === 'Other'
          ? 'Sin clasificar — deuda de atribución'
          : /DataDog|BigPanda|AppDynamics/.test(k)
            ? 'Herramienta de monitoreo (ruido operativo)'
            : /ForgeRock/.test(k)
              ? 'Sin actividad hace >12 meses'
              : /Entitlement/.test(k)
                ? 'Primer sistema de negocio'
                : /Self Care/.test(k)
                  ? 'Segundo sistema de negocio'
                  : ''
      }</td>
    </tr>`,
    )
    .join('')}
  </tbody>
</table>`;

const catalog = [
  ['Comercio', 'Kuiper', 'Plataforma de e-commerce; 5 microservicios backend (BSS Buyflow Global, Merlin Geolocation, BSS Identity Validation, Kuiper Leads, Kuiper Keywords)', 'Kuiper'],
  ['Comercio', 'Buyflow / Buyflow 2.0', 'Jornada de compra: productos, carrito, pedidos; integra Magento (≈90% GraphQL según KT)', 'Buyflow / Buyflow 2.0'],
  ['Comercio', 'Selfcare / Selfcare 2.0', 'Autogestión del cliente: planes, datos, equipos, cancelaciones, DirectvLink', 'Selfcare / Selfcare 2.0'],
  ['Cobro', 'Package & Entitlement', 'Paquetes, productos, billing, regiones y derechos; base del acceso a contenido', 'Package & Entitlement'],
  ['Cobro', 'Pagos externos y billing', 'Vindicia, CyberSource, PayU, WeBill, Magento, Web Commerce', 'Pagos y billing'],
  ['Acceso', 'Auth / SSO ForgeRock', 'Identidad y sesión unificada; login en todas las apps', 'Auth / SSO ForgeRock'],
  ['Experiencia', 'Playback / DRM / Player', 'Reproducción, DRM, manifiestos y player 2.0', 'Playback / DRM / Player'],
  ['Entrega', 'CDN (Akamai)', 'Distribución de contenido, tokens y DR de CDN', 'CDN (Akamai)'],
  ['Contenido', 'CMS / Liferay / ACTool', 'Publicación y herramientas internas de contenido', 'CMS / Liferay / ACTool'],
  ['Contenido', 'HUB de contenido', 'Ingesta y enriquecimiento de catálogo (bff-ms-hub-*)', 'HUB de contenido'],
  ['Contenido', 'VMS / VLS', 'Gestión y validación de señales y programas', 'VMS / VLS'],
  ['Contenido', 'Catálogo / EPG / Metadata', 'Metadatos, ratings, guía de programación', 'Catálogo / EPG / Metadata'],
  ['Contenido', 'Ingesta / Transcoding', 'Ingesta linear/VOD y transcodificación', 'Ingesta / Transcoding'],
  ['Contenido', 'DRM / Content Protection', 'Widevine/FairPlay/PlayReady y antipiratería', 'DRM / Content Protection'],
  ['Plataformas', 'Roku', 'App nativa Roku y Roku Pay', 'Plataforma Roku'],
  ['Plataformas', 'Android / AndroidTV / GoogleTV', 'Apps nativas Android', 'Plataforma Android'],
  ['Plataformas', 'iOS / iPadOS / tvOS', 'Apps nativas Apple', 'Plataforma iOS'],
  ['Plataformas', 'HTML5 / Web', 'Web pública y PWA', 'Plataforma HTML5 / Web'],
  ['Plataformas', 'FireTV', 'App nativa Amazon Fire TV', 'Plataforma FireTV'],
  ['Plataformas', 'AppleTV', 'App nativa Apple TV', 'Plataforma AppleTV'],
  ['Plataformas', 'STB / SmartTV', 'Set-top boxes y Smart TVs (Samsung/LG)', 'Plataforma STB / SmartTV'],
  ['Productos', 'DTV GO', 'Producto/marca OTT', 'Producto DTV GO'],
  ['Productos', 'SKY+', 'Producto/marca OTT (BR)', 'Producto SKY+'],
  ['Productos', 'DGO', 'Producto/marca OTT (LATAM)', 'Producto DGO'],
  ['Productos', 'Streamco', 'Operación/producto Australia (contenedor de Product OPS)', 'Producto Streamco'],
  ['Datos', 'Data Platform / Datalake', 'Delta Sync, data services, tablas dw_/dl_', 'Data Platform / Datalake'],
  ['Datos', 'Analytics / Tagueamento', 'GA4, GTG, tagueamento de compra y playback', 'Analytics / Tagueamento'],
  ['Discovery', 'Search / Recomendaciones', 'Spideo, ThinkAnalytics, recomendador de player', 'Search / Recomendaciones'],
  ['Mensajería', 'Notificaciones / Email / Push', 'Emails transaccionales, push, SMS, Salesforce MC', 'Notificaciones / Email / Push'],
  ['Soporte', 'Monitoreo / Observabilidad', 'DataDog, BigPanda, AppDynamics, NPAW/Youbora, Pingdom', 'Monitoreo / Observabilidad'],
  ['Soporte', 'Chatbot / Overchat', 'Atención automatizada y bots de CSAT', 'Chatbot / Overchat'],
  ['Partners', 'Integraciones / Partners', 'Disney+, HBO Max, Paramount+, UFC Fight Pass, Atresplayer, Mega GO', 'Integraciones / Partners'],
  ['Proyectos', 'Alcatraz', 'Hardening de apps (anti-reverse-engineering) para SKY+ y DGO', 'Proyecto Alcatraz'],
  ['Proyectos', 'Kraken (deeplinks)', 'Deeplinks propios, reemplazo de Firebase Dynamic Links; AdminJS para DGO/SKY+/SKY/MiDIRECTV', 'Proyecto Kraken (deeplinks)'],
  ['Legacy', 'Orbis', 'Plataforma legacy de playback; documentación marcada OBSOLETE/DEPRECATED', 'Orbis (legacy)'],
];

const catalogRows = catalog
  .map(([group, name, desc, key]) => {
    const f = fam(key);
    const link = f.anchorId
      ? `<a href="https://dtvott.atlassian.net/wiki/spaces/OTT/pages/${f.anchorId}">Abrir</a>`
      : '<span class="muted">—</span>';
    return `<tr>
      <td class="grp">${esc(group)}</td>
      <td class="sys">${esc(name)}</td>
      <td class="desc">${esc(desc)}</td>
      <td class="num">${fmt(f.pages)}</td>
      <td class="num">${f.dgo ? fmt(f.dgo) : '—'}</td>
      <td class="num">${f.d30}</td>
      <td class="num">${f.stale}</td>
      <td class="muted small">${f.newest}</td>
      <td class="muted small">${link}</td>
    </tr>`;
  })
  .join('');

const freqRows = famStats
  .filter((f) => f.pages >= 15)
  .sort((a, b) => b.d30 - a.d30 || b.d90 - a.d90 || b.pages - a.pages)
  .slice(0, 20)
  .map(
    (f) => `<tr>
      <td class="sys">${esc(f.name)}</td>
      <td class="num">${fmt(f.pages)}</td>
      <td class="num b">${f.d30}</td>
      <td class="num">${f.d90}</td>
      <td class="num">${f.y1}</td>
      <td class="num">${pct(f.stale, f.pages, 0)}</td>
      <td class="muted small">${f.newest}</td>
      <td>${bar(f.d30, 18)}</td>
    </tr>`,
  )
  .join('');

const topViewedList = (census.topViewed?.top ?? []) as Array<{ title: string; score: number }>;
const topPages = topViewedList
  .filter((p) => p.title !== 'Vrio Space')
  .slice(0, 25)
  .map(
    (p, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${esc(p.title)}</td>
      <td class="sys">${esc(topViewedMap(p.title))}</td>
      <td class="num b">${p.score}</td>
    </tr>`,
  )
  .join('');

const priorityRows = [
  ['1', 'Package & Entitlement', 'Alta', 'Global', 'Alta (220)', 'Baja (3 act.)', 'CRÍTICO', 'v-crit'],
  ['2', 'Buyflow + Kuiper', 'Alta', 'Global', 'Media (18+14)', 'Media-alta (13+15)', 'CRÍTICO', 'v-crit'],
  ['3', 'Pagos externos (Vindicia, CyberSource, PayU, WeBill, Magento)', 'Alta', 'Global', 'Media (64)', 'Media (10)', 'CRÍTICO', 'v-crit'],
  ['4', 'Auth / SSO (ForgeRock)', 'Alta (acceso)', 'Global', 'Baja (0 campo / 41 texto)', 'Muy baja (1)', 'ALTO', 'v-alto'],
  ['5', 'Playback / DRM / CDN', 'Media-alta', 'Global', 'Media (55)', 'Media (11)', 'ALTO', 'v-alto'],
  ['6', 'Selfcare / Selfcare 2.0', 'Media', 'Global', 'Alta en campo (29/30d; 287/90d)', 'Baja (3)', 'ALTO', 'v-alto'],
  ['7', 'CMS / HUB / VMS / Catálogo', 'Media', 'Global', 'Baja-media', 'Baja (1-3)', 'MEDIO-ALTO', 'v-med'],
  ['8', 'Apps (Roku, Android, iOS, HTML5, FireTV, AppleTV)', 'Media', 'Por plataforma', 'Media', 'Media (7 HTML5 · 6 Roku)', 'MEDIO', 'v-med'],
  ['9', 'Search / Recomendaciones', 'Media', 'Global', 'Baja', 'Media (5)', 'MEDIO', 'v-med'],
  ['10', 'Analytics / Tagueamento', 'Media', 'Global', 'Baja', 'Baja (3)', 'MEDIO', 'v-med'],
  ['11', 'Notificaciones / Email / Push', 'Baja-media', 'Global', 'Baja (25)', 'Baja (2)', 'MEDIO-BAJO', 'v-med'],
  ['12', 'Monitoreo (DataDog, BigPanda, NPAW)', 'Soporte', 'Global', 'Alta, pero es señal (187)', 'Baja (0)', 'BAJO (soporte)', 'v-bajo'],
  ['13', 'Integraciones / Partners', 'Media', 'Segmentado', 'Baja', 'Muy baja (2)', 'BAJO', 'v-bajo'],
  ['14', 'Alcatraz / Kraken', 'Media (seguridad)', 'Apps', 'Nula', 'Baja (Alcatraz 1 en 90d)', 'BAJO-MEDIO', 'v-bajo'],
  ['15', 'Orbis (legacy)', 'Nula', 'Residual', 'Nula', 'Nula (53 págs, 0 act.)', 'IRRELEVANTE', 'v-none'],
]
  .map(
    (r) => `<tr>
      <td class="num b">${r[0]}</td>
      <td class="sys">${esc(r[1])}</td>
      <td>${esc(r[2])}</td>
      <td>${esc(r[3])}</td>
      <td>${esc(r[4])}</td>
      <td>${esc(r[5])}</td>
      <td class="verdict ${r[7]}">${esc(r[6])}</td>
    </tr>`,
  )
  .join('');

const totalAll = fieldRows.reduce((a, [, v]) => a + v.all, 0);
const totalD30 = fieldRows.reduce((a, [, v]) => a + v.d30, 0);
const accel = fieldRows
  .filter(([, v]) => v.all >= 100 && v.d30 > 0)
  .map(([k, v]) => ({ k, v, lift: v.d30 / totalD30 / (v.all / totalAll) }))
  .sort((a, b) => b.lift - a.lift);
const accelRows = accel
  .slice(0, 11)
  .map(
    ({ k, v, lift }) => `<tr>
      <td class="sys">${esc(k)}</td>
      <td class="num">${fmt(v.d30)}</td>
      <td class="num">${fmt(v.all)}</td>
      <td class="num">${pct(v.d30, totalD30)}</td>
      <td class="num">${pct(v.all, totalAll)}</td>
      <td class="num b">${lift.toFixed(1).replace('.', ',')}×</td>
      <td class="muted">${
        k === 'Other'
          ? 'La deuda de clasificación crece más rápido que el total'
          : /DataDog|BigPanda|AppDynamics/.test(k)
            ? 'Crecimiento del ruido de monitoreo'
            : lift >= 2
              ? 'En rampa: hoy pesa más que su historia'
              : 'En línea con su historia'
      }</td>
    </tr>`,
  )
  .join('');

const topField = fieldRows.slice(0, 18);
const restField = fieldRows.slice(18);
const fieldRest = {
  d30: restField.reduce((a, [, v]) => a + v.d30, 0),
  d90: restField.reduce((a, [, v]) => a + v.d90, 0),
  y1: restField.reduce((a, [, v]) => a + v.y1, 0),
  all: restField.reduce((a, [, v]) => a + v.all, 0),
  open: restField.reduce((a, [, v]) => a + v.open, 0),
};

const trendRows = trend
  .map(
    (t) => `<tr>
      <td class="sys">${esc(t.system)}</td>
      ${t.series.map((v) => `<td class="num">${v}</td>`).join('')}
      <td>${bar(t.series.at(-1) ?? 0, t.max)}</td>
    </tr>`,
  )
  .join('');

const sampleRows = Object.entries(extra.samples)
  .map(
    ([system, list]) => `<tr class="sample-head"><td colspan="4">${esc(system)}</td></tr>` +
      list
        .slice(0, 4)
        .map(
          (i) => `<tr>
        <td class="mono small">${esc(i.key)}</td>
        <td class="small">${esc(i.created?.slice(0, 10))}</td>
        <td class="small">${esc(i.priority || '—')}</td>
        <td class="small">${esc(i.summary.length > 130 ? `${i.summary.slice(0, 127)}…` : i.summary)}</td>
      </tr>`,
        )
        .join(''),
  )
  .join('');

const kwTable = kwRows
  .map(([label, key, note]) => {
    const v = kw[key];
    return `<tr>
      <td class="sys">${esc(label)}</td>
      <td class="num">${fmt(v.d30)}</td>
      <td class="num">${fmt(v.d90)}</td>
      <td class="num">${fmt(v.y1)}</td>
      <td class="num b">${fmt(v.all)}</td>
      <td class="muted small">${esc(note)}</td>
    </tr>`;
  })
  .join('');

const topNodes = tree.filter((n) => !/TEST - MCP|prueba narrativa/i.test(n.title));
const containers = {
  count: topNodes.length,
  html: topNodes
    .map(
      (n) =>
        `<li><span class="chip${n.childTotal ? '' : ' chip-empty'}">${n.childTotal || '·'}</span> ${esc(n.title)}${
          n.children.length
            ? `<div class="muted small">${n.children.slice(0, 5).map((c) => esc(c.title)).join(' · ')}${n.children.length > 5 ? ' …' : ''}</div>`
            : ''
        }</li>`,
    )
    .join(''),
};


const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Confluence OTT — Análisis de sistemas, consulta, prioridad e incidencias</title>
<style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fonts.r}) format('woff2');font-weight:400;font-style:normal}
@font-face{font-family:Poppins;src:url(data:font/woff2;base64,${fonts.m}) format('woff2');font-weight:600;font-style:normal}
@font-face{font-family:Poppins;src:url(data:font/woff2;base64,${fonts.b}) format('woff2');font-weight:700;font-style:normal}
:root{
  --ink:#111827; --muted:#5B6472; --line:#E2E8F0; --soft:#F6F8FB;
  --cyan:#06B6D4; --cyan-d:#0891B2; --violet:#7C3AED; --ok:#15803D; --warn:#B45309; --bad:#B91C1C;
  --dark:#0B1020; --dark-2:#151921;
}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:Inter,'Segoe UI',sans-serif;color:var(--ink);font-size:10pt;line-height:1.45}
h1,h2,h3,h4,strong,b,.b,.kpi .v{font-family:Poppins,Inter,sans-serif}
h1,h2,h3{font-weight:700;line-height:1.15;margin:0}
h2{font-size:17pt;color:var(--cyan-d);border-bottom:2px solid var(--line);padding-bottom:5px;margin:14px 0 8px}
.page-break + h2{margin-top:0}
h3{font-size:12pt;margin:14px 0 6px;color:#0F172A}
p{margin:0 0 7px}
a{color:var(--cyan-d);text-decoration:none}
ul,ol{margin:4px 0 8px 16px;padding:0 0 0 6px}
li{margin:2px 0}
.small{font-size:8.6pt}
.muted{color:var(--muted)}
.mono{font-family:'Cascadia Code',Consolas,monospace}
.cover{background:var(--dark);color:#E8EEF4;border-radius:10px;padding:38px 36px;margin-bottom:18px;page-break-after:always;height:272mm;display:flex;flex-direction:column;justify-content:space-between}
.cover .kicker{letter-spacing:.22em;font-size:8pt;text-transform:uppercase;color:var(--cyan)}
.cover h1{font-size:30pt;margin:16px 0 10px;color:#fff}
.cover h1 span{color:var(--cyan)}
.cover .sub{font-size:13pt;color:#B7C1D1;max-width:150mm}
.cover .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:26px;font-size:9pt;color:#AEB9C9}
.cover .meta b{color:#fff;font-weight:600;display:block}
.cover .meta div{overflow-wrap:anywhere}
.cover-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:auto;border-top:1px solid #232B3A;padding-top:20px}
.cover-stats b{display:block;font-size:25pt;color:#67E8F9;line-height:1.05}
.cover-stats span{font-size:8.5pt;color:#8B95A8}
.badge{display:inline-block;border:1px solid #2B3648;border-radius:999px;padding:4px 10px;font-size:8pt;color:#9FB0C6;margin-right:6px}
.cover .foot{font-size:8pt;color:#7C8798;border-top:1px solid #232B3A;padding-top:10px;display:flex;justify-content:space-between}
.toc{page-break-after:always}
.toc ol{list-style:none;margin:0;padding:0;counter-reset:s}
.toc > ol > li{counter-increment:s;border-bottom:1px solid var(--line);padding:8px 0;display:flex;gap:10px}
.toc > ol > li:before{content:counter(s) ".";color:var(--cyan-d);font-weight:700;min-width:22px}
.card ul{list-style:disc;margin:2px 0 0 16px;padding:0}
.card li{display:list-item;border:0;padding:0;margin:2px 0;counter-increment:none}
.card li:before{content:none;display:none}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 14px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:9px 10px;background:var(--soft)}
.kpi .v{font-size:17pt;font-weight:700;color:var(--cyan-d);line-height:1.1}
.kpi .l{font-size:7.8pt;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.callout{border-left:4px solid var(--cyan);background:var(--soft);border-radius:0 8px 8px 0;padding:9px 12px;margin:9px 0}
.callout.warn{border-color:var(--warn);background:#FFF8EC}
.callout.bad{border-color:var(--bad);background:#FEF2F2}
.callout.ok{border-color:var(--ok);background:#F0FDF4}
table.data{width:100%;border-collapse:collapse;margin:7px 0 12px;font-size:8.5pt}
table.data thead{display:table-header-group}
table.data th{background:#0F172A;color:#fff;text-align:left;padding:5px 6px;font-weight:600;font-size:8pt}
table.data td{border-bottom:1px solid var(--line);padding:4px 6px;vertical-align:top}
table.data tr:nth-child(even) td{background:#FAFBFD}
table.data tr{page-break-inside:avoid}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.b{font-weight:700}
.sys{font-weight:600}
.grp{color:var(--violet);font-weight:600;font-size:8pt;white-space:nowrap}
.verdict{font-weight:700;font-size:7.6pt}
.v-crit{color:#B91C1C}.v-alto{color:#B45309}.v-med{color:#0E7490}.v-bajo{color:#475569}.v-none{color:#94A3B8}
.w-num{width:26%}
.bar{display:inline-block;width:28mm;height:6px;background:#E7EDF5;border-radius:3px;overflow:hidden;vertical-align:middle}
.catalog{font-size:7.2pt}
.catalog td{padding:3px 5px}
.catalog .desc{width:31%}
.catalog .grp{font-size:6.9pt}
.catalog td:nth-child(8){white-space:nowrap}
.samples{font-size:7.6pt}
.samples td:nth-child(1),.samples td:nth-child(2),.samples td:nth-child(3){white-space:nowrap}
.card .mono{white-space:nowrap}
.tight{font-size:7.4pt}
.tight th{font-size:7.2pt;padding:4px}
.tight td{padding:3px 4px}
.dense td{padding:2px 4px}
.trend .bar{width:22mm}
h2,h3{page-break-after:avoid}
.bar span{display:block;height:100%}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0;page-break-inside:avoid}
.card h4{margin:0 0 4px;font-size:10pt;color:#0F172A}
.tag{display:inline-block;font-size:7.4pt;padding:1px 6px;border-radius:999px;background:#E6F7FB;color:#0E7490;margin-left:6px;vertical-align:2px}
.tag.red{background:#FEE2E2;color:#991B1B}.tag.amber{background:#FEF3C7;color:#92400E}.tag.green{background:#DCFCE7;color:#166534}
.tag.violet{background:#EDE9FE;color:#5B21B6}
ul.containers{list-style:none;columns:2;column-gap:16px;margin:0;padding:0;font-size:8.4pt}
ul.containers li{break-inside:avoid;margin:0 0 5px;padding:0 0 3px;border-bottom:1px dotted var(--line)}
.chip{display:inline-block;min-width:18px;text-align:center;background:#0F172A;color:#fff;border-radius:4px;font-size:7pt;padding:0 5px;margin-right:5px;font-family:Inter,sans-serif;white-space:nowrap;line-height:1.5}
.chip-empty{background:#E2E8F0;color:#64748B}
tr.sample-head td{background:#0F172A !important;color:#fff;font-weight:700;font-size:8pt}
.page-break{page-break-before:always}
.avoid{page-break-inside:avoid}
.footnote{font-size:7.8pt;color:var(--muted);border-top:1px solid var(--line);padding-top:6px;margin-top:10px}
</style>
</head>
<body>

<section class="cover">
  <div>
    <div class="kicker">GentleVanguard · Análisis de plataforma</div>
    <h1>Confluence <span>OTT</span></h1>
    <div class="sub">Catálogo de sistemas y productos documentados, señales de consulta, prioridad operativa e incidencias actuales e históricas.</div>
    <div style="margin-top:18px">
      <span class="badge">Solo lectura</span>
      <span class="badge">Sin escrituras en Atlassian</span>
      <span class="badge">Corte ${STAMP}</span>
    </div>
    <div class="meta">
      <div><b>Sitio</b>dtvott.atlassian.net</div>
      <div><b>Espacios</b>OTT (principal) · DGOBACKEND (complementario)${otherSpaces.length ? ` · ${esc(otherNames)} (metadatos)` : ''}</div>
      <div><b>Volumen analizado</b>${fmt(total)} páginas OTT · ${fmt(dgo.length)} páginas DGOBACKEND${otherSpaces.length ? ` · ${fmt(othersTotal)} páginas ${esc(otherNames)}` : ''}</div>
      <div><b>Incidencias</b>Jira GS + GSE · ${fmt(totals.all)} históricas</div>
      <div><b>Preparado para</b>Owner — eortiz2@directvla.com.ar</div>
      <div><b>Fecha</b>${coverDate}</div>
    </div>
    <div class="cover-stats">
      <div><b>${catalog.length}</b><span>familias documentadas</span></div>
      <div><b>${fmt(totals.all)}</b><span>incidentes analizados</span></div>
      <div><b>15</b><span>sistemas priorizados</span></div>
    </div>
  </div>
  <div class="foot">
    <span>Documento de trabajo — validar hallazgos y ranking de prioridad antes de decisiones</span>
    <span>v1.0</span>
  </div>
</section>

<section class="toc">
  <h2>Contenido</h2>
  <ol>
    <li><a href="#s1">Alcance, fuentes y método</a></li>
    <li><a href="#s2">Catálogo de sistemas y productos documentados</a></li>
    <li><a href="#s3">Señales de frecuencia de consulta</a></li>
    <li><a href="#s4">Prioridad de sistemas: de crítico a irrelevante</a></li>
    <li><a href="#s5">Incidencias: actual vs histórico</a></li>
    <li><a href="#s6">Hallazgos y riesgos</a></li>
    <li><a href="#s7">Recomendaciones y próximos pasos</a></li>
    <li><a href="#a1">Anexo A — Estructura de primer nivel del espacio OTT</a></li>
    <li><a href="#a2">Anexo B — Limitaciones, datos y reproducibilidad</a></li>
  </ol>
  <div class="callout" style="margin-top:18px">
    <b>Cómo leer este documento.</b> Las listas 2 a 6 del intercambio original se convierten aquí en secciones 2 a 5, con datos ampliados. Cada cifra indica su fuente. Donde no existe medición directa se dice explícitamente y se usa un proxy identificado: no se presenta un proxy como si fuera una vista real.
  </div>
  <div class="kpis">
    <div class="kpi"><div class="v">${fmt(total)}</div><div class="l">páginas en OTT</div></div>
    <div class="kpi"><div class="v">${pct(stale, total)}</div><div class="l">sin tocar hace >1 año</div></div>
    <div class="kpi"><div class="v">${pct(upd30, total)}</div><div class="l">actualizadas en 30 días</div></div>
    <div class="kpi"><div class="v">${fmt(totals.d30)}</div><div class="l">incidentes últimos 30 días</div></div>
  </div>
  <div class="card" style="margin-top:14px">
    <h4>Resumen ejecutivo</h4>
    <ul style="margin-bottom:0">
      <li><b>El espacio está intacto pero envejecido:</b> ${fmt(total)} páginas; solo ${fmt(upd30)} (${pct(upd30, total)}) se tocaron en 30 días y ${pct(stale, total)} lleva más de un año sin cambios. ${pct(byClass.borrador, compTotal)} son borradores de menos de 100 palabras.</li>
      <li><b>La cadena de ingresos es el eje de riesgo:</b> Package &amp; Entitlement (220 incidentes en 30 días), Buyflow/Kuiper y pagos concentran la operación y las prioridades oficiales Q4.</li>
      <li><b>Hay dos incidentes recurrentes con nombre propio:</b> <span class="mono">${MSSVC}</span> (error rate/latencia) y los links de activación de partners que fallan o devuelven 404.</li>
      <li><b>Casi 4 de cada 10 tickets recientes no describen un producto:</b> "Other" (${pct(253, totals.d30)}) + DataDog (${pct(187, totals.d30)}). Sin cerrar esa brecha, todo ranking subestima.</li>
      <li><b>Auth/ForgeRock cambió de riesgo:</b> 10.688 incidentes históricos, 0 en 12 meses y documentación congelada. El riesgo hoy es de conocimiento, no de disponibilidad.</li>
      <li><b>Lo obsoleto sigue en el árbol:</b> Orbis (${fmt(fam('Orbis (legacy)').pages)} páginas, última 2023) y DGOBACKEND (${pct(dgoStale, dgo.length, 0)} estancado).</li>
    </ul>
  </div>
</section>

<h2 id="s1">1. Alcance, fuentes y método</h2>
<p>El objetivo es responder cuatro preguntas sobre la documentación del cliente OTT: qué sistemas y productos están documentados, cuánto se consulta o mantiene esa documentación, cuáles son los más críticos y cuáles concentran incidencias hoy y en el histórico.</p>

<h3>1.1 Fuentes</h3>
<table class="data">
  <thead><tr><th>Fuente</th><th>Qué aporta</th><th>Ventana</th></tr></thead>
  <tbody>
    <tr><td class="sys">Confluence Cloud — espacio OTT</td><td>Título, jerarquía, fecha de última modificación y cuerpo de páginas ancla; composición por tipo de documento</td><td>Corte ${STAMP}</td></tr>
    <tr><td class="sys">Confluence Cloud — espacio DGOBACKEND</td><td>Documentación de backends complementaria (${fmt(dgo.length)} páginas)</td><td>Corte ${STAMP}</td></tr>
    ${
      otherSpaces.length
        ? `<tr><td class="sys">Confluence Cloud — espacios ${esc(otherNames)}</td><td>Metadatos de las ${fmt(othersTotal)} páginas restantes del sitio (título y última modificación) para medir cobertura fuera de OTT</td><td>Corte ${STAMP}</td></tr>`
        : ''
    }
    <tr><td class="sys">Jira Cloud — proyectos GS y GSE</td><td>Incidentes: ${fmt(totals.all)} históricos, ${fmt(totals.d30)} en 30 días, ${fmt(totals.d90)} en 90 días, ${fmt(totals.open)} abiertos. Campo oficial "Systems (Go support)"</td><td>Histórico completo + ventanas 30/90/365 días</td></tr>
    <tr><td class="sys">Censo Censor (2026-11-14)</td><td>Proxy de engagement (comentarios + versiones + citas), composición documental, duplicados y referencias internas</td><td>Censo completo del árbol</td></tr>
    <tr><td class="sys">Priorización Q4 del espacio</td><td>Iniciativas oficiales y su prioridad (Buyflow, Selfcare 2.0, pagos, regulatorio)</td><td>Trimestre en curso</td></tr>
  </tbody>
</table>

<h3>1.2 Radiografía del espacio OTT</h3>
<div class="kpis">
  <div class="kpi"><div class="v">${fmt(total)}</div><div class="l">páginas totales</div></div>
  <div class="kpi"><div class="v">${fmt(upd90)}</div><div class="l">actualizadas en 90 días</div></div>
  <div class="kpi"><div class="v">${fmt(stale)}</div><div class="l">estancadas (>1 año)</div></div>
  <div class="kpi"><div class="v">${dupe.clusters}</div><div class="l">clusters duplicados</div></div>
</div>
<table class="data tight">
  <thead><tr><th>Tipo de documento (censo)</th><th class="num">Páginas</th><th class="num">Participación</th><th>Lectura</th></tr></thead>
  <tbody>
    <tr><td>Borrador (&lt;100 palabras)</td><td class="num">${fmt(byClass.borrador)}</td><td class="num">${pct(byClass.borrador, compTotal)}</td><td class="muted">Casi la mitad del espacio no tiene contenido sustantivo</td></tr>
    <tr><td>Técnica</td><td class="num">${fmt(byClass.tecnica)}</td><td class="num">${pct(byClass.tecnica, compTotal)}</td><td class="muted">Documentación de sistemas y APIs</td></tr>
    <tr><td>Plana (contenido mínimo)</td><td class="num">${fmt(byClass.plano)}</td><td class="num">${pct(byClass.plano, compTotal)}</td><td class="muted">Índices y páginas de navegación</td></tr>
    <tr><td>Embed (adjuntos/visores)</td><td class="num">${fmt(byClass.embed)}</td><td class="num">${pct(byClass.embed, compTotal)}</td><td class="muted">Contenido alojado en adjuntos</td></tr>
    <tr><td>Mixta</td><td class="num">${fmt(byClass.mixto)}</td><td class="num">${pct(byClass.mixto, compTotal)}</td><td class="muted">Funcional y técnica sin separar</td></tr>
    <tr><td>Negocio</td><td class="num">${fmt(byClass.negocio)}</td><td class="num">${pct(byClass.negocio, compTotal)}</td><td class="muted">Requerimientos, portfolios, procesos</td></tr>
    <tr><td>Funcional</td><td class="num">${fmt(byClass.funcional)}</td><td class="num">${pct(byClass.funcional, compTotal)}</td><td class="muted">Flujos y módulos</td></tr>
  </tbody>
</table>
<p class="small muted">Contexto adicional del censo: ${fmt(census.jira?.pagesWithTickets)} páginas (${census.jira?.pct}%) referencian tickets de Jira (${fmt(census.jira?.keysTotal)} claves distintas); ${fmt(census.attachments?.totalAttachments)} adjuntos (${attachCats.map((c) => `${c.categoria.replace(/_/g, ' ')} ${fmt(c.cantidad)}`).join(', ')}); ${fmt(census.externalLinks?.pagesWithExternal)} páginas (${census.externalLinks?.pct}%) tienen enlaces externos; ${dupe.clusters} clusters de contenido duplicado implican ${fmt(dupe.pages)} páginas. El censo analizó ${fmt(census.stats?.totalDocs)} documentos descendientes del árbol.</p>

<h3>1.3 Límites que condicionan la lectura</h3>
<div class="callout warn">
  <b>Vistas reales no disponibles.</b> La API de analytics de contenido responde 404/403 con el token actual (requiere un plan de Confluence con analítica y un token habilitado). Por eso la sección 3 mide actividad documental, engagement proxy y citas internas — no "page views". Ninguna cifra de esa sección debe citarse como visitas.
</div>
<ul>
  <li><b>Atribución de incidentes:</b> el campo "Systems (Go support)" cubre ${pct(675, 1000, 1)} de una muestra de 1.000 incidentes recientes; el resto queda en "Other". Los cortes por texto del resumen (sección 5.7) cubren lo que el campo no registra.</li>
  <li><b>Conteo aproximado:</b> los totales de Jira usan <span class="mono">approximate-count</span>; sirven para ranking y orden de magnitud, no como contabilidad exacta.</li>
  <li><b>Conteo de páginas por nombre:</b> las cifras del catálogo surgen de coincidencias en el título; hay solapamientos (por ejemplo, Kuiper y Buyflow comparten páginas) y se excluyeron 10 páginas de prueba editorial ("prueba narrativa", "TEST - MCP").</li>
  <li><b>Fecha de corte:</b> los últimos 7 días pueden estar sub-representados por latencia de indexación en los conteos.</li>
</ul>

<h3>1.4 Cómo se atribuyó cada sistema</h3>
<ul>
  <li><b>Campo oficial primero:</b> cuando el incidente trae "Systems (Go support)", ese valor manda. Es el caso de Package &amp; Entitlement, Self Care, DataDog o ForgeRock.</li>
  <li><b>Título como segunda vía:</b> para sistemas sin campo propio —Buyflow, Kuiper, Orbis, Kraken— se buscaron términos en el resumen del ticket (sección 5.7), con variantes en español, portugués e inglés.</li>
  <li><b>Lectura de anclas:</b> cuando existía un KT, una página de proyecto o una priorización, se leyó el cuerpo para describir el sistema con sus microservicios y equipos, no solo por el nombre.</li>
  <li><b>Sin doble conteo:</b> un mismo incidente puede sumar en el campo oficial y en un corte por texto; las tablas no se suman entre sí.</li>
</ul>

<h2 id="s2">2. Catálogo de sistemas y productos documentados</h2>
<p>Se identificaron <b>35 familias</b> documentadas, agrupadas en 9 dominios. La columna "Págs. OTT" cuenta coincidencias por título (aproximado); "DGOBACKEND" indica presencia en el espacio de backends; "Última" es la fecha de la página más reciente de esa familia.</p>
<table class="data catalog">
  <thead><tr><th>Dominio</th><th>Sistema</th><th>Qué es</th><th class="num">Págs. OTT</th><th class="num">DGOBACKEND</th><th class="num">30d</th><th class="num">Estancadas</th><th>Última</th><th>Ancla</th></tr></thead>
  <tbody>${catalogRows}</tbody>
</table>

<h3>2.1 Fichas de los sistemas clave</h3>
<div class="card">
  <h4>Kuiper <span class="tag green">Emergente</span></h4>
  <p>Plataforma de e-commerce que sostiene la compra y la autogestión. El KT de L1 documenta cinco microservicios backend: <b>MS BSS Buyflow Global</b>, <b>MS Merlin Geolocation Global</b>, <b>MS BSS Identity Validation</b>, <b>MS Kuiper Leads</b> y <b>MS Kuiper Keywords</b>. Equipo responsable: Starship Troopers. Integración con Magento en casi todas las rutas del Buyflow (≈90% GraphQL), lo que convierte cualquier degradación de Magento en latencia del Buyflow.</p>
  <p class="muted small">Documentación: ${fmt(fam('Kuiper').pages)} páginas OTT · ${fam('Kuiper').d30} actualizadas en 30 días · última ${fam('Kuiper').newest}. Incidentes: 22 menciones históricas, 14 en los últimos 30 días (rampa de adopción).</p>
</div>
<div class="card">
  <h4>Buyflow / Buyflow 2.0 <span class="tag red">Crítico</span></h4>
  <p>Jornada de compra de punta a punta. La señal operativa más clara son los incidentes recurrentes sobre <span class="mono">${MSSVC}</span> (error rate y latencia) en producción. La prioridad oficial Q4 incluye "Rebranding Buyflow DGO" (P1) y el flujo de compra aparece repetidamente en los casos GS (carrito abandonado, tokenización, multi-base).</p>
  <p class="muted small">Documentación: ${fmt(fam('Buyflow / Buyflow 2.0').pages)} páginas · ${fam('Buyflow / Buyflow 2.0').d30} actualizadas en 30 días. Incidentes por texto: ${fmt(kw.buyflow.all)} históricos, ${kw.buyflow.d30} en 30 días.</p>
</div>
<div class="card">
  <h4>Selfcare / Selfcare 2.0 <span class="tag amber">En transición</span></h4>
  <p>Autogestión del cliente (planes, datos, equipos, cancelación, DirectvLink). La convivencia entre el front legacy y la plataforma nueva explica parte de la dispersión documental. En Q4 está priorizado "Home Selfcare 2.0 BR" y "Home Selfcare 2.0 AR" (P2).</p>
  <p class="muted small">Documentación: ${fmt(fam('Selfcare / Selfcare 2.0').pages)} páginas · solo ${fam('Selfcare / Selfcare 2.0').d30} actualizadas en 30 días. Incidentes en campo: ${fmt(field.counts['Self Care']?.all)} históricos, ${field.counts['Self Care']?.d30} en 30 días, ${field.counts['Self Care']?.open} abiertos.</p>
</div>
<div class="card">
  <h4>Package &amp; Entitlement <span class="tag red">Mayor carga</span></h4>
  <p>Paquetes, productos, billing, regiones y derechos. Es el sistema con más incidentes de negocio: ${fmt(field.counts['Package & Entitlement (Package/ Products/ Billing/ Regions/ Entitlement)']?.d30)} en 30 días y ${fmt(field.counts['Package & Entitlement (Package/ Products/ Billing/ Regions/ Entitlement)']?.all)} históricos. Las muestras recientes muestran un patrón concreto: <b>links de activación de partners (Disney+, Prime) que no llegan, devuelven 404 o no coinciden con la credencial</b>.</p>
  <p class="muted small">Documentación: ${fmt(fam('Package & Entitlement').pages)} páginas OTT + ${fam('Package & Entitlement').dgo} en DGOBACKEND · ${fam('Package & Entitlement').d30} actualizadas en 30 días.</p>
</div>
<div class="card">
  <h4>Pagos externos y billing <span class="tag red">Crítico</span></h4>
  <p>Cadena de cobro distribuida: Vindicia, CyberSource, PayU, WeBill, Magento y Web Commerce. Los casos GS documentan fallas de reembolso parcial, la diferencia entre <span class="mono">STOP_BILLING</span> y <span class="mono">STOP_ENTITLEMENT</span> y problemas de tokenización. En Q4 están abiertos WeBill (número de teléfono, SKU de voucher) y Magento (SATIS, Redis).</p>
  <p class="muted small">Documentación: ${fmt(fam('Pagos y billing').pages)} páginas · ${fam('Pagos y billing').d30} actualizadas en 30 días. Incidentes por texto: ${fmt(kw.payments.all)} históricos, ${kw.payments.d30} en 30 días.</p>
</div>
<div class="card">
  <h4>Auth / SSO (ForgeRock) <span class="tag amber">Riesgo de conocimiento</span></h4>
  <p>Puerta de acceso de todas las apps. El histórico registra ${fmt(field.counts['ForgeRock']?.all)} incidentes, pero <b>ninguno en los últimos 12 meses</b>: la operación se estabilizó o migró. El riesgo se trasladó al conocimiento: solo ${fam('Auth / SSO ForgeRock').d30} página se actualizó en 30 días y ${pct(fam('Auth / SSO ForgeRock').stale, fam('Auth / SSO ForgeRock').pages, 0)} de su documentación está estancada.</p>
</div>
<div class="card">
  <h4>Playback / DRM / CDN <span class="tag red">Experiencia núcleo</span></h4>
  <p>Reproducción, DRM y entrega. Los incidentes recientes se concentran en dispositivos específicos (Samsung, Xiaomi) y en streaming en vivo. La documentación de Orbis —predecesor de la plataforma de playback— está marcada OBSOLETE/DEPRECATED en su totalidad.</p>
  <p class="muted small">Documentación: ${fmt(fam('Playback / DRM / Player').pages)} páginas · ${fam('Playback / DRM / Player').d30} actualizadas en 30 días. Incidentes por texto: ${fmt(kw.playback.all)} históricos, ${kw.playback.d30} en 30 días.</p>
</div>
<div class="card">
  <h4>CMS / HUB / VMS / Catálogo <span class="tag violet">Cadena de contenido</span></h4>
  <p>Sin contenido publicado no hay nada que reproducir. El HUB aparece en migraciones activas (CDK Migration) y en reglas de negocio de catálogo (ratings, deduplicación, campos requeridos). La documentación está dispersa entre CMS/Liferay, ACTool, VMS/VLS y catálogo/EPG.</p>
  <p class="muted small">Volumen: HUB ${fmt(fam('HUB de contenido').pages)} · catálogo/EPG ${fmt(fam('Catálogo / EPG / Metadata').pages)} · CMS/Liferay ${fmt(fam('CMS / Liferay / ACTool').pages)} · VMS/VLS ${fmt(fam('VMS / VLS').pages)}. Actualización en 30 días: 1-2 páginas por familia.</p>
</div>

<h3>2.2 Legado, proyectos y obsolescencia</h3>
<table class="data">
  <thead><tr><th>Elemento</th><th>Estado</th><th>Evidencia</th><th>Acción sugerida</th></tr></thead>
  <tbody>
    <tr><td class="sys">Orbis</td><td><span class="tag red">Obsoleto</span></td><td>${fmt(fam('Orbis (legacy)').pages)} páginas, 0 actualizadas en >1 año; páginas rotuladas OBSOLETE/DEPRECATED; 47 menciones históricas en incidentes y 0 en 30 días</td><td>Archivar y documentar el reemplazo vigente</td></tr>
    <tr><td class="sys">ForgeRock</td><td><span class="tag amber">Estabilizado</span></td><td>10.688 incidentes históricos, 0 en 12 meses; documentación casi congelada</td><td>Documentar la arquitectura actual de auth y el runbook de contingencia</td></tr>
    <tr><td class="sys">Kraken (deeplinks)</td><td><span class="tag green">Vigente, docs escasas</span></td><td>7 páginas; última actualización 2025-12-11; reemplaza Firebase Dynamic Links y sirve a DGO, SKY+, SKY y MiDIRECTV</td><td>Actualizar runbook y operación de AdminJS</td></tr>
    <tr><td class="sys">Alcatraz</td><td><span class="tag green">Activo</span></td><td>Proyecto de hardening para SKY+ y DGO; página actualizada en septiembre de 2026</td><td>Mantener métricas de origen de instalación y exposición por plataforma</td></tr>
  </tbody>
</table>

<h3>2.3 Productos, marcas y partners</h3>
<p>Las marcas conviven sobre la misma plataforma, pero el conocimiento se documenta por separado. Esta tabla conecta cada marca con su documentación y con sus menciones en incidentes.</p>
<table class="data tight">
  <thead><tr><th>Producto / marca</th><th>Qué es</th><th class="num">Págs. OTT</th><th class="num">30d</th><th class="num">Menciones históricas</th><th>Lectura</th></tr></thead>
  <tbody>
    <tr><td class="sys">DGO</td><td>Marca OTT de LATAM</td><td class="num">${fmt(fam('Producto DGO').pages)}</td><td class="num">${fam('Producto DGO').d30}</td><td class="num">${fmt(kw.dgo.all)}</td><td class="muted">81 menciones en 30 días; producto más nombrado</td></tr>
    <tr><td class="sys">DTV GO</td><td>Marca OTT regional</td><td class="num">${fmt(fam('Producto DTV GO').pages)}</td><td class="num">${fam('Producto DTV GO').d30}</td><td class="num">${fmt(kw.dtvgo.all)}</td><td class="muted">597 tickets abiertos históricos: revisar vigencia</td></tr>
    <tr><td class="sys">SKY+</td><td>Marca OTT de Brasil</td><td class="num">${fmt(fam('Producto SKY+').pages)}</td><td class="num">${fam('Producto SKY+').d30}</td><td class="num">${fmt(kw.sky.all)}</td><td class="muted">Incluye menciones de SKY; 55 en 30 días</td></tr>
    <tr><td class="sys">Streamco</td><td>Operación/producto Australia</td><td class="num">${fmt(fam('Producto Streamco').pages)}</td><td class="num">${fam('Producto Streamco').d30}</td><td class="num">0</td><td class="muted">Casi sin documentación propia</td></tr>
    <tr><td class="sys">Partners (Disney+, HBO Max, Paramount+, UFC, Atresplayer, Mega GO)</td><td>Integraciones de contenido y activación</td><td class="num">${fmt(fam('Integraciones / Partners').pages)}</td><td class="num">${fam('Integraciones / Partners').d30}</td><td class="num">—</td><td class="muted">El puente con P&amp;E para activaciones</td></tr>
  </tbody>
</table>

${
  otherSpaces.length
    ? `<h3>2.4 Cobertura fuera de OTT: ${esc(otherNames)}</h3>
<p>El sitio tiene ${otherSpaces.length + 2} espacios. OTT y DGOBACKEND concentran la operación; ${esc(otherNames)} completan el mapa documental. Para estos últimos se aplicó la misma heurística de títulos <b>solo sobre metadatos</b> (título y última modificación): no se leyeron cuerpos ni se validó su taxonomía interna.</p>
<table class="data tight avoid">
  <thead><tr><th>Espacio</th><th>Nombre</th><th class="num">Páginas</th><th class="num">Actualizadas 30d</th><th class="num">Sin tocar &gt;1 año</th><th>Familias dominantes (por título)</th><th>Lectura</th></tr></thead>
  <tbody>${otherSpaces
    .map(
      (s) => `<tr>
      <td class="sys">${esc(s.key)}</td>
      <td>${esc(s.name)}</td>
      <td class="num b">${fmt(s.total)}</td>
      <td class="num">${fmt(s.d30)}</td>
      <td class="num">${fmt(s.stale)}</td>
      <td class="muted small">${s.top.length ? s.top.map(([n, c]) => `${esc(n)} (${c})`).join(' · ') : '—'}</td>
      <td class="muted small">${esc(s.read)}</td>
    </tr>`,
    )
    .join('')}</tbody>
</table>
<div class="callout"><b>Qué agrega y qué no.</b> Agrega evidencia de que el conocimiento no vive solo en OTT: ${fmt(othersTotal)} páginas adicionales con su propia frescura. No permite comparar criticidad entre espacios, porque no se analizó su contenido ni su relación con incidentes; para eso la primera entrega sigue siendo OTT + DGOBACKEND.</div>`
    : ''
}

${otherSpaces.length ? '' : '<div class="page-break"></div>'}
<h2 id="s3">3. Señales de frecuencia de consulta</h2>
<div class="callout bad">
  <b>Lo que no se puede afirmar.</b> Con el token actual no hay acceso a vistas por página. Cualquier número de "consultas" por sistema sería inventado. Esta sección ofrece tres señales medidas y separadas: (a) actividad documental, (b) engagement proxy del censo, (c) citas internas.
</div>

<h3>3.1 Actividad documental por sistema (últimos 30/90/365 días)</h3>
<table class="data">
  <thead><tr><th>Sistema</th><th class="num">Páginas</th><th class="num">30d</th><th class="num">90d</th><th class="num">1 año</th><th class="num">Estancadas</th><th>Última</th><th class="w-num">30d</th></tr></thead>
  <tbody>${freqRows}</tbody>
</table>
<p class="small muted">Lectura: una familia con muchas páginas y pocas actualizaciones es documentación "de archivo". Las familias con mayor actividad son Kuiper, Buyflow, Playback, Pagos y DGO — coinciden con los sistemas que hoy generan cambios de producto.</p>

<h3>3.2 Engagement proxy: páginas con más señales (comentarios + versiones + citas)</h3>
<table class="data">
  <thead><tr><th class="num">#</th><th>Página</th><th>Sistema asignado</th><th class="num">Score</th></tr></thead>
  <tbody>${topPages}</tbody>
</table>
<p class="small muted">Corte del censo del 14/11/2026. El score no es una vista: pondera señales de interacción. Sirve para identificar qué documentación concentra atención y mantenimiento.</p>

<h3>3.3 Citas internas (indicador de centralidad del conocimiento)</h3>
<p>El censo detectó ${fmt(census.internalRefs?.totalInternalLinks)} enlaces internos entre páginas. Los nodos más citados son tablas de datos (<span class="mono">dw_d_pda_sub_subscriber</span>, <span class="mono">dl_m_upc_unified_product_catalog</span>, <span class="mono">dw_a_osm_ott_subscriber_monthly_basis</span>), lo que confirma que la documentación más "usada" como referencia es la de <b>Data Platform</b>, no la de producto.</p>

<h3>3.4 Cómo cerrar la brecha de vistas reales</h3>
<p class="small"><b>Medición del ${STAMP}:</b> la sonda directa a <span class="mono">/api/v2/analytics/content/{id}/views</span> responde ${analytics ? (analytics.available ? 'con vistas reales' : 'sin acceso con el token actual') : 'sin registro de sonda'}. El bloqueo es de credenciales, no del informe: el generador ya consulta ese endpoint, así que un token con scope de analítica basta para reemplazar el proxy sin tocar el análisis.</p>
<ol>
  <li>Verificar si el tenant tiene analítica de contenido habilitada (plan/rol).</li>
  <li>Si la tiene, emitir un token con el scope de analytics y usar <span class="mono">/api/v2/analytics/content/{id}/views</span> por página.</li>
  <li>Reemplazar el proxy del censo por vistas reales en el reporte mensual: la estructura del informe ya separa la columna para hacerlo sin reescribir el análisis.</li>
</ol>

<h3>3.5 Densidad de incidentes vs documentación activa</h3>
<p class="small muted">Incidentes de 30 días divididos por la cantidad de páginas de esa familia actualizadas en 30 días. Un valor alto indica que la documentación no acompaña el ritmo operativo. Se excluye DataDog de la lectura por ser herramienta de monitoreo (187 incidentes, 0 páginas).</p>
<table class="data tight">
  <thead><tr><th>Sistema</th><th class="num">Incidentes 30d</th><th>Fuente</th><th class="num">Págs. actualizadas 30d</th><th class="num">Incidentes por página activa</th><th>Lectura</th></tr></thead>
  <tbody>
    <tr><td class="sys">Package &amp; Entitlement</td><td class="num">220</td><td class="muted">campo</td><td class="num">3</td><td class="num b">73,3</td><td>Máxima presión con mínima actualización</td></tr>
    <tr><td class="sys">Self Care</td><td class="num">29</td><td class="muted">campo</td><td class="num">3</td><td class="num b">9,7</td><td>Docs no acompañan la transición a Selfcare 2.0</td></tr>
    <tr><td class="sys">Pagos</td><td class="num">64</td><td class="muted">texto</td><td class="num">10</td><td class="num b">6,4</td><td>Actividad media; cadena muy distribuida</td></tr>
    <tr><td class="sys">Playback</td><td class="num">55</td><td class="muted">texto</td><td class="num">11</td><td class="num b">5,0</td><td>Mantiene un ritmo razonable</td></tr>
    <tr><td class="sys">Buyflow</td><td class="num">18</td><td class="muted">texto</td><td class="num">13</td><td class="num b">1,4</td><td>Documentación al día</td></tr>
    <tr><td class="sys">Kuiper</td><td class="num">14</td><td class="muted">texto</td><td class="num">15</td><td class="num b">0,9</td><td>Docs crecen más rápido que los incidentes</td></tr>
    <tr><td class="sys">Auth / ForgeRock</td><td class="num">0</td><td class="muted">campo</td><td class="num">1</td><td class="num b">0,0</td><td>Sin incidentes, sin documentación nueva: riesgo latente</td></tr>
  </tbody>
</table>
<div class="callout"><b>Conclusión.</b> La brecha no es general: está concentrada en P&amp;E y Selfcare. Buyflow y Kuiper demuestran que documentar al ritmo del producto es posible; P&amp;E opera en el extremo opuesto con 73 incidentes por página actualizada.</div>

<h3>3.6 Señales por plataforma</h3>
<p class="small muted">Actividad documental y menciones en incidentes por plataforma. La atribución por texto es parcial: no todos los tickets nombran el dispositivo.</p>
<table class="data tight">
  <thead><tr><th>Plataforma</th><th class="num">Págs. OTT</th><th class="num">Actualizadas 30d</th><th class="num">Incidentes 30d</th><th class="num">Histórico</th><th>Lectura</th></tr></thead>
  <tbody>
    <tr><td class="sys">Roku</td><td class="num">${fmt(fam('Plataforma Roku').pages)}</td><td class="num">${fam('Plataforma Roku').d30}</td><td class="num">${kw.roku.d30}</td><td class="num">${fmt(kw.roku.all)}</td><td class="muted">Documentación de release notes muy activa</td></tr>
    <tr><td class="sys">Android / GoogleTV</td><td class="num">${fmt(fam('Plataforma Android').pages)}</td><td class="num">${fam('Plataforma Android').d30}</td><td class="num">${kw.android.d30}</td><td class="num">${fmt(kw.android.all)}</td><td class="muted">Mayor volumen de incidentes entre apps</td></tr>
    <tr><td class="sys">iOS / tvOS</td><td class="num">${fmt(fam('Plataforma iOS').pages)}</td><td class="num">${fam('Plataforma iOS').d30}</td><td class="num">${kw.ios.d30}</td><td class="num">${fmt(kw.ios.all)}</td><td class="muted">Actividad baja</td></tr>
    <tr><td class="sys">HTML5 / Web</td><td class="num">${fmt(fam('Plataforma HTML5 / Web').pages)}</td><td class="num">${fam('Plataforma HTML5 / Web').d30}</td><td class="num">${kw.html5.d30}</td><td class="num">${fmt(kw.html5.all)}</td><td class="muted">Más páginas que incidentes: doc de producto</td></tr>
    <tr><td class="sys">Fire TV</td><td class="num">${fmt(fam('Plataforma FireTV').pages)}</td><td class="num">${fam('Plataforma FireTV').d30}</td><td class="num">${kw.firetv.d30}</td><td class="num">${fmt(kw.firetv.all)}</td><td class="muted">16 incidentes en 30 días con 3 páginas actualizadas</td></tr>
    <tr><td class="sys">Apple TV</td><td class="num">${fmt(fam('Plataforma AppleTV').pages)}</td><td class="num">${fam('Plataforma AppleTV').d30}</td><td class="num">${kw.appletv.d30}</td><td class="num">${fmt(kw.appletv.all)}</td><td class="muted">Bajo volumen de ambos lados</td></tr>
  </tbody>
</table>

<h3>3.7 Qué mide y qué no mide cada señal</h3>
<table class="data tight">
  <thead><tr><th>Señal</th><th>Qué mide</th><th>Qué no mide</th><th>Uso en este informe</th></tr></thead>
  <tbody>
    <tr><td class="sys">Actividad documental</td><td>Mantenimiento: última modificación y cantidad de páginas tocadas</td><td>Lectura, intención ni usuarios</td><td>Frescura por sistema y densidad de incidentes</td></tr>
    <tr><td class="sys">Engagement proxy (censo)</td><td>Interacción histórica: comentarios, versiones y citas</td><td>Vistas reales ni tráfico</td><td>Identificar páginas atendidas y concentración de atención</td></tr>
    <tr><td class="sys">Citas internas</td><td>Centralidad referencial entre páginas</td><td>Quién consulta ni por qué</td><td>Detectar hubs de conocimiento (Data Platform)</td></tr>
    <tr><td class="sys">Campo oficial de sistema</td><td>Clasificación operativa del incidente</td><td>Cobertura total (67,5%) ni causa</td><td>Base del ranking actual e histórico</td></tr>
    <tr><td class="sys">Menciones en el resumen</td><td>Atribución textual del sistema</td><td>Severidad, causa ni contexto completo</td><td>Cubrir Buyflow, Kuiper, Orbis y Kraken</td></tr>
  </tbody>
</table>

<div class="page-break"></div>
<h2 id="s4">4. Prioridad de sistemas: de crítico a irrelevante</h2>
<p>Ranking inferido con cinco señales: dependencia de ingresos, alcance de usuarios, carga de incidentes (30 días), salud documental y prioridad oficial Q4 del espacio. <b>Es una propuesta para validar</b>, no una decisión tomada.</p>
<table class="data tight">
  <thead><tr><th class="num">#</th><th>Sistema</th><th>Ingresos</th><th>Alcance</th><th>Carga 30d</th><th>Salud documental</th><th>Veredicto</th></tr></thead>
  <tbody>${priorityRows}</tbody>
</table>
<p class="small"><b>Señales oficiales Q4 del espacio:</b> P1 "Rebranding Buyflow DGO"; P2 "Home Selfcare 2.0 BR" y "Home Selfcare 2.0 AR"; P2 WeBill (teléfono, SKU de voucher) y Magento (SATIS, Redis); iniciativa DATA STRENGTH GTG para analytics; Alcatraz activo. Auth/ForgeRock, Playback y CMS no muestran iniciativa Q4 explícita.</p>
<div class="callout">
  <b>Por qué este orden.</b> Los tres primeros puestos son la cadena de ingresos: derechos (P&amp;E) → compra (Buyflow/Kuiper) → cobro (pagos). Auth ocupa el cuarto porque habilita todo, aunque hoy no genere incidentes: su riesgo es de conocimiento, no de disponibilidad. Playback y Selfcare siguen por impacto directo en cliente. Monitoreo aparece bajo porque su volumen es señal de salud de otros sistemas, no un producto que el cliente consuma.
</div>

<div class="page-break"></div>
<h2 id="s5">5. Incidencias: actual vs histórico</h2>
<h3>5.1 Universo y calidad del dato</h3>
<div class="kpis">
  <div class="kpi"><div class="v">${fmt(totals.all)}</div><div class="l">histórico total</div></div>
  <div class="kpi"><div class="v">${fmt(totals.d30)}</div><div class="l">últimos 30 días</div></div>
  <div class="kpi"><div class="v">${fmt(totals.d90)}</div><div class="l">últimos 90 días</div></div>
  <div class="kpi"><div class="v">${fmt(totals.open)}</div><div class="l">abiertos hoy</div></div>
</div>
<p>Los incidentes viven en dos proyectos: <b>GS</b> (unos 58,7 mil) y <b>GSE</b> (unos 4,2 mil). El campo "Systems (Go support)" tiene 48 opciones y ${pct(675, 1000, 1)} de cobertura en la muestra reciente. En 30 días, "Other" representa ${pct(253, totals.d30)} y DataDog ${pct(187, totals.d30)}: casi 4 de cada 10 tickets recientes no describen un producto o describen la herramienta de monitoreo.</p>

<h3>5.2 Volumen por sistema (campo oficial)</h3>
${fieldTable(topField, 'Sistema')}
<p class="small muted">Resto de sistemas (${restField.length} opciones menores): ${fmt(fieldRest.d30)} en 30d · ${fmt(fieldRest.d90)} en 90d · ${fmt(fieldRest.all)} históricos · ${fmt(fieldRest.open)} abiertos.</p>
<div class="callout"><b>Lo que la tabla no dice.</b> El primer puesto no es un producto: "Other" es deuda de atribución (${pct(253, totals.d30)} en 30 días) y DataDog es la herramienta con la que se detectan los incidentes, no el sistema que falla. Detrás de ellos, P&amp;E es el primer sistema de negocio y Self Care el segundo; ForgeRock conserva el mayor volumen histórico sin actividad en 12 meses.</div>

<div class="page-break"></div>
<h3>5.3 Aceleración: qué sistema crece hoy</h3>
<p class="small muted">Índice = peso del sistema en los últimos 30 días ÷ su peso en el histórico. 1,0× significa que crece al ritmo del total; 2,0× o más, que su volumen reciente duplica su peso histórico. Solo sistemas con 100+ incidentes históricos. Los pesos se calculan sobre tickets con sistema asignado (72% en 30 días, 99% en el histórico): el índice compara composición, no volumen absoluto.</p>
<table class="data tight avoid">
  <thead><tr><th>Sistema</th><th class="num">30 días</th><th class="num">Histórico</th><th class="num">Peso 30d</th><th class="num">Peso hist.</th><th class="num">Índice</th><th>Lectura</th></tr></thead>
  <tbody>${accelRows}</tbody>
</table>
<p class="small muted">Concentración: Other, DataDog, ForgeRock y Package &amp; Entitlement acumulan ${pct(fieldRows.slice(0, 4).reduce((a, [, v]) => a + v.all, 0), totals.all)} del histórico. ForgeRock y Orbis no aparecen por no tener incidentes en 30 días: su índice es 0.</p>

<h3>5.4 Tendencia semanal (12 semanas)</h3>
<p class="small muted">Incidentes creados por semana, de la más antigua (S1) a la más reciente (S12). La última semana puede estar incompleta por latencia de indexación.</p>
<table class="data tight trend">
  <thead><tr><th>Sistema</th>${wkLabels.map((w) => `<th class="num">${w}</th>`).join('')}<th>Última</th></tr></thead>
  <tbody>${trendRows}</tbody>
</table>
<div class="callout warn"><b>Pico de 30–90 días.</b> Package &amp; Entitlement pasó de ~100 a 161 incidentes semanales y DataDog de ~70 a 162. Las últimas semanas cayeron respecto del pico, con la última incompleta por latencia de indexación. El patrón es compatible con un evento masivo o una campaña de clasificación; sin evidencia de causa no se atribuye.</div>

<div class="page-break"></div>
<h3>5.5 Severidad declarada (últimos 30 días)</h3>
<table class="data avoid">
  <thead><tr><th>Prioridad Jira</th><th class="num">Incidentes</th><th class="num">Participación</th></tr></thead>
  <tbody>
    ${Object.entries(extra.prio30)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(v)}</td><td class="num">${pct(v, totals.d30)}</td></tr>`)
      .join('')}
  </tbody>
</table>

<h3>5.6 Qué falla: muestras reales por sistema</h3>
<table class="data samples">
  <thead><tr><th>Ticket</th><th>Fecha</th><th>Prioridad</th><th>Resumen</th></tr></thead>
  <tbody>${sampleRows}</tbody>
</table>

<h3>5.7 Corroboración por texto del resumen</h3>
<p class="small muted">Cubre lo que el campo oficial no clasifica (Buyflow, Kuiper, Orbis, Kraken). Cada fila suma variantes en español/portugués/inglés.</p>
<table class="data tight">
  <thead><tr><th>Término</th><th class="num">30d</th><th class="num">90d</th><th class="num">1 año</th><th class="num">Histórico</th><th>Nota</th></tr></thead>
  <tbody>${kwTable}</tbody>
</table>

<h3>5.8 Qué falta para confiar en el ranking</h3>
<ul>
  <li><b>Cobertura incompleta:</b> ${pct(325, 1000, 1)} de la muestra del censo no trae sistema asignado (${pct(totals.d30 - 830, totals.d30, 0)} de los tickets de 30 días); el ranking de producto cubre dos tercios del universo y el resto se lee por texto.</li>
  <li><b>Ruido de herramienta:</b> DataDog es el segundo valor más usado del campo. Una regla por componente lo separaría de los sistemas de negocio y liberaría ~16% del volumen reciente.</li>
  <li><b>Señales solapadas:</b> un mismo ticket puede figurar en el campo oficial y en un corte por texto. Las tablas de esta sección no se suman entre sí.</li>
  <li><b>Antigüedad de "abiertos":</b> el total abierto mezcla tickets nuevos con deuda histórica; no mide severidad ni tiempo de resolución.</li>
</ul>

<h2 id="s6">6. Hallazgos y riesgos</h2>
<ol>
  <li><b>Package &amp; Entitlement concentra el riesgo operativo.</b> Es el primer sistema de negocio en 30 días y en el histórico, y sus fallas bloquean acceso a contenido. Patrón dominante: activaciones de partners (links 404, credenciales que no coinciden).</li>
  <li><b>Kuiper está en rampa.</b> 14 de sus 22 menciones históricas ocurrieron en los últimos 30 días; el KT de L1 y los monitores ya existen, pero la operación está absorbiendo un sistema nuevo con equipo propio (Starship Troopers).</li>
  <li><b>Buyflow tiene una señal recurrente y verificable:</b> <span class="mono">${MSSVC}</span> con error rate o latencia alta en producción en al menos tres episodios de noviembre. Es el mejor candidato a seguimiento semanal.</li>
  <li><b>Casi la mitad del volumen reciente es ruido o deuda de clasificación:</b> "Other" + DataDog ≈ ${pct(253 + 187, totals.d30)} de los 30 días. Sin cerrar esa brecha, cualquier ranking de producto queda subestimado.</li>
  <li><b>ForgeRock muestra un riesgo de conocimiento, no de disponibilidad:</b> 10.688 incidentes históricos y cero en 12 meses, con documentación casi congelada. Si falla, el equipo actual puede no tener el runbook.</li>
  <li><b>Orbis es historia completa.</b> 53 páginas sin actualizar desde 2023 y 0 incidentes recientes: mantenerlo en el árbol activo solo agrega ruido de búsqueda.</li>
  <li><b>La documentación envejece más rápido de lo que se escribe:</b> ${pct(stale, total)} del espacio lleva más de un año sin cambios y ${pct(byClass.borrador, compTotal)} son borradores de menos de 100 palabras.</li>
  <li><b>Las prioridades oficiales coinciden con la carga real:</b> Buyflow (P1), Selfcare 2.0 (P2) y pagos (P2) son también los sistemas con más actividad documental y de incidentes. La alineación entre discurso y operación es buena.</li>
  <li><b>Las activaciones son un tema transversal de primer orden:</b> 7.214 menciones históricas y 328 en 30 días, conectadas a P&amp;E y a partners. Merece un tablero propio.</li>
  <li><b>El espacio DGOBACKEND está casi abandonado:</b> ${fmt(dgo.length)} páginas, ${dgoStale} con más de un año sin cambios. Si allí vive el conocimiento de backends, hoy no es una fuente confiable.</li>
</ol>

<h2 id="s7">7. Recomendaciones y próximos pasos</h2>
<p class="small"><b>Siguiente entrega propuesta:</b> un tablero de una página con P&amp;E y Buyflow semanales, activaciones, aperturas por sistema y salud documental (páginas actualizadas / estancadas). Se genera con los mismos datos, sin pedir accesos nuevos.</p>
<table class="data tight dense">
  <thead><tr><th class="num">#</th><th>Acción</th><th>Por qué</th><th>Impacto</th><th>Esfuerzo</th></tr></thead>
  <tbody>
    <tr><td class="num">1</td><td>Tablero semanal de P&amp;E y Buyflow (<span class="mono">${MSSVC}</span>)</td><td>Son los dos sistemas con señal operativa recurrente</td><td>Alto</td><td>Bajo</td></tr>
    <tr><td class="num">2</td><td>Cerrar la clasificación "Other" con una regla por componente/equipo (Datadog + Jira)</td><td>${pct(253 + 187, totals.d30)} del volumen reciente no describe producto</td><td>Alto</td><td>Medio</td></tr>
    <tr><td class="num">3</td><td>Documentar el runbook de Auth/ForgeRock y su reemplazo actual</td><td>10.688 incidentes históricos y 0 en 12 meses; docs congeladas</td><td>Alto</td><td>Medio</td></tr>
    <tr><td class="num">4</td><td>Archivar Orbis y enlazar la plataforma vigente</td><td>53 páginas obsoletas que contaminan la búsqueda</td><td>Medio</td><td>Bajo</td></tr>
    <tr><td class="num">5</td><td>Tablero de activaciones (P&amp;E + partners)</td><td>7.214 históricas, 328 en 30 días</td><td>Alto</td><td>Medio</td></tr>
    <tr><td class="num">6</td><td>Plan de reactivación de DGOBACKEND o decisión de archivo</td><td>${pct(dgoStale, dgo.length, 0)} de sus páginas está estancado</td><td>Medio</td><td>Medio</td></tr>
    <tr><td class="num">7</td><td>Kuiper: runbook de L1 y contacto de guardia consolidados</td><td>Sistema nuevo con rampa de incidentes</td><td>Alto</td><td>Medio</td></tr>
    <tr><td class="num">8</td><td>Actualizar Kuiper/Buyflow: ya tienen actividad; mantener el ritmo</td><td>Las familias más activas: 15 y 13 páginas en 30d</td><td>Medio</td><td>Bajo</td></tr>
    <tr><td class="num">9</td><td>Habilitar vistas reales (token con analytics)</td><td>Convertir el proxy en medición directa</td><td>Medio</td><td>Bajo</td></tr>
    <tr><td class="num">10</td><td>Extender el análisis a TS y DESIGN</td><td>Completan el mapa documental del tenant</td><td>Medio</td><td>Bajo</td></tr>
    <tr><td class="num">11</td><td>Deduplicar contenido por plantilla (323 clusters)</td><td>2.407 páginas implicadas; reduce ruido de búsqueda</td><td>Medio</td><td>Alto</td></tr>
    <tr><td class="num">12</td><td>Reporte mensual automatizado (Censor + Jira)</td><td>Lo vuelve un indicador continuo</td><td>Alto</td><td>Medio</td></tr>
  </tbody>
</table>

<h2 id="a1">Anexo A — Estructura de primer nivel del espacio OTT</h2>
<p class="small muted">${containers.count} nodos hijos de "Vrio Space" tras excluir páginas de prueba del stack. El número indica cantidad de hijos directos; los nodos con más hijos son los hubs naturales de documentación.</p>
<ul class="containers">${containers.html}</ul>

<h2 id="a2">Anexo B — Limitaciones, datos y reproducibilidad</h2>
<h3>B.1 Archivos de datos (locales, no versionados)</h3>
<ul class="small">
  <li><span class="mono">.runtime/censor/ott-analysis/pages.json</span> — ${fmt(total)} páginas OTT (id, título, última modificación).</li>
  <li><span class="mono">.runtime/censor/ott-analysis/dgobackend-pages.json</span> — ${fmt(dgo.length)} páginas DGOBACKEND.</li>
  ${
    otherSpaces
      .map(
        (s) =>
          `<li><span class="mono">.runtime/censor/ott-analysis/${s.key.toLowerCase()}-pages.json</span> — ${fmt(s.total)} páginas de ${esc(s.name)} (metadatos).</li>`,
      )
      .join('\n  ')
  }
  <li><span class="mono">.runtime/censor/ott-analysis/spaces.json</span> — espacios del sitio con su nombre; <span class="mono">analytics-probe.json</span> — resultado de la sonda de vistas reales.</li>
  <li><span class="mono">.runtime/censor/ott-analysis/incidents-by-system-field.json</span> — conteos por campo oficial (48 opciones).</li>
  <li><span class="mono">.runtime/censor/ott-analysis/incidents.json</span> — conteos por texto del resumen.</li>
  <li><span class="mono">.runtime/censor/ott-analysis/incident-totals.json</span> — totales por ventana.</li>
  <li><span class="mono">.runtime/censor/ott-analysis/report-extra.json</span> — prioridades, tendencia semanal y muestras.</li>
  <li><span class="mono">.runtime/censor/runs/run-2026-11-14T17-19-03-143Z.json</span> — censo Censor (composición, engagement proxy, citas, duplicados).</li>
</ul>
<h3>B.2 Método</h3>
<ul class="small">
  <li>Lectura de Confluence por CQL con paginación por cursor y gap de 110 ms entre requests; Jira por <span class="mono">search/jql</span> y <span class="mono">search/approximate-count</span>.</li>
  <li>Atribución de sistemas por: (a) campo oficial de Jira, (b) coincidencia de términos en el título de la página y del incidente, (c) lectura de páginas ancla (KT, proyectos, priorización).</li>
  <li>Frescura calculada contra el corte del informe (${STAMP}); ventanas de incidentes por fecha de creación.</li>
  <li>Se excluyeron páginas de prueba editorial creadas por el propio stack (10 páginas) para no inflar familias.</li>
</ul>
<h3>B.3 Lo que este documento no prueba</h3>
<ul class="small">
  <li>No mide visitas reales ni usuarios únicos por página.</li>
  <li>No establece causas de los picos de incidencias; describe el patrón temporal.</li>
  <li>No certifica que el campo "Systems (Go support)" esté usado con disciplina en todos los equipos.</li>
  <li>Para TS y DESIGN solo se midieron metadatos (título y frescura): no se leyeron cuerpos ni se validó su taxonomía interna.</li>
  <li>No valida el ranking de prioridad con el negocio: es una propuesta basada en evidencia documental y operativa.</li>
</ul>
<div class="footnote">Generado el ${coverDate} a partir de datos en vivo al ${STAMP}. Este documento es de trabajo interno; las cifras de Jira son aproximadas y las de Confluence dependen de coincidencias de título.</div>

</body>
</html>`;

return html;
}
