import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AnalyticsProbe,
  ExtraSnapshot,
  PageLite,
  SpaceInfo,
  TermCounts,
  TreeNode,
  WindowCounts,
} from './types.js';
import { createJiraClient, loadConnection, loadConfluence } from './client.js';
import type { AtlassianConnection, ConfluenceApi, JiraClient } from './client.js';

const OTT_ROOT_ID = '45944688';
export const DEFAULT_SPACES = ['OTT', 'DGOBACKEND', 'TS', 'DESIGN'];

const WINDOWS = {
  d30: 'created >= -30d',
  d90: 'created >= -90d',
  y1: 'created >= -365d',
  all: '',
} as const;

/** Términos de resumen usados como segunda vía de atribución (no excluyentes). */
const SUMMARY_TERMS: Record<string, string[]> = {
  buyflow: ['buyflow', 'buy flow', '"buy-flow"'],
  selfcare: ['selfcare', 'self care', '"self-care"'],
  kuiper: ['kuiper'],
  kraken: ['kraken'],
  orbis: ['orbis'],
  roku: ['roku'],
  android: ['android', 'androidtv'],
  ios: ['ios', 'iphone', 'ipad'],
  html5: ['html5'],
  firetv: ['firetv', 'fire tv'],
  appletv: ['appletv', 'apple tv'],
  webpublic: ['"web public"', 'webpublic', 'pwa'],
  cms: ['cms'],
  catalog: ['catalog', 'catalogo', 'catálogo'],
  auth: ['login', 'authentication', 'autenticacion', 'autenticação', 'forgerock', 'sso'],
  playback: ['playback', 'streaming', 'player', 'drm'],
  payments: ['payment', 'vindicia', 'billing', 'checkout', 'pago', 'pagamento'],
  cdn: ['cdn'],
  notifications: ['email', 'notification', 'notificacion', 'notificação', 'push', 'sms'],
  entitlements: ['entitlement', 'rights', 'derechos', 'direitos'],
  alcatraz: ['alcatraz'],
  watson: ['watson', 'chatbot'],
  dtvgo: ['"dtv go"', 'dtvgo'],
  sky: ['"sky+"', '"sky plus"'],
  dgo: ['dgo'],
  misdatos: ['"mis datos"', '"meus dados"'],
  activations: ['activation', 'activacion', 'ativação', 'provisioning'],
  search: ['search', 'busca', 'búsqueda'],
  recommendations: ['recommendation', 'recomenda', 'recomendación'],
  ads: ['ads', 'advertising', 'publicidad', 'tagueamento'],
};

const FIELD_FALLBACK = [
  'Other',
  'DataDog',
  'Package & Entitlement (Package/ Products/ Billing/ Regions/ Entitlement)',
  'iOS/ Android/ Swift/ Kotlin',
  'Self Care',
  'AWS',
  'HTML5',
  'WeBill',
  'Youbora (NPAW)',
  'CyberSource',
  'Live Ingestion, Transcoding & Delivery',
  'Magento',
  'Web Commerce',
  'ToolBox',
];

const WEEKLY_SYSTEMS: Record<string, string> = {
  'Package & Entitlement':
    'customfield_24728 = "Package & Entitlement (Package/ Products/ Billing/ Regions/ Entitlement)"',
  DataDog: 'customfield_24728 = "DataDog"',
  'Self Care': 'customfield_24728 = "Self Care"',
  Buyflow: 'summary ~ "buyflow" OR summary ~ "buy flow"',
  Kuiper: 'summary ~ "kuiper"',
  Playback: 'summary ~ "playback" OR summary ~ "streaming"',
  Auth: 'summary ~ "login" OR summary ~ "authentication"',
  Payments: 'summary ~ "payment" OR summary ~ "pagamento"',
};

const SAMPLE_JQL: Record<string, string> = {
  'Package & Entitlement':
    'issuetype = Incident AND customfield_24728 = "Package & Entitlement (Package/ Products/ Billing/ Regions/ Entitlement)" ORDER BY created DESC',
  'Self Care': 'issuetype = Incident AND customfield_24728 = "Self Care" ORDER BY created DESC',
  DataDog: 'issuetype = Incident AND customfield_24728 = "DataDog" ORDER BY created DESC',
  Kuiper: 'issuetype = Incident AND (summary ~ "kuiper") ORDER BY created DESC',
  Buyflow:
    'issuetype = Incident AND (summary ~ "buyflow" OR summary ~ "buy flow") ORDER BY created DESC',
  Playback:
    'issuetype = Incident AND (summary ~ "playback" OR summary ~ "streaming") ORDER BY created DESC',
};

export function pageFileFor(spaceKey: string): string {
  return spaceKey.toUpperCase() === 'OTT' ? 'pages.json' : `${spaceKey.toLowerCase()}-pages.json`;
}

export async function listSpaces(api: ConfluenceApi): Promise<SpaceInfo[]> {
  const data = await api.request('/rest/api/space', { query: { limit: 250 } });
  return ((data?.results ?? []) as any[]).map((s) => ({ key: s.key, name: s.name }));
}

async function collectSpacePages(
  api: ConfluenceApi,
  spaceKey: string,
): Promise<PageLite[]> {
  const all = await api.searchCql(`space = "${spaceKey}" and type = page`, {
    limit: 100,
    maxPages: 200,
    expand: 'content.history',
  });
  return all.items.map((r) => ({
    id: String(r.content?.id ?? r.id),
    title: r.content?.title ?? r.title,
    lastModified: r.lastModified ?? r.content?.history?.lastUpdated?.when ?? null,
    created: r.content?.history?.createdDate ?? null,
    status: r.content?.status ?? null,
  }));
}

async function collectSpaceTree(
  api: ConfluenceApi,
  rootId = OTT_ROOT_ID,
): Promise<TreeNode[]> {
  const level1 = await api.searchCql(`space = "OTT" and type = page and parent = ${rootId}`, {
    limit: 100,
    maxPages: 5,
  });
  const tree: TreeNode[] = [];
  for (const r of level1.items) {
    const id = String(r.content.id);
    const kids = await api
      .searchCql(`type = page and parent = ${id}`, { limit: 100, maxPages: 3 })
      .catch(() => ({ items: [] as any[], totalSize: -1 }));
    tree.push({
      id,
      title: r.content.title,
      children: kids.items.map((k) => ({ id: String(k.content.id), title: k.content.title })),
      childTotal: kids.totalSize,
    });
  }
  return tree;
}

export async function probeAnalytics(
  api: ConfluenceApi,
  pageId = OTT_ROOT_ID,
): Promise<AnalyticsProbe> {
  const views = await api.fetchViews(pageId).catch(() => ({
    views: null,
    lastViewedAt: null,
    available: false,
  }));
  return {
    endpoint: '/api/v2/analytics/content/{id}/views',
    available: views.available,
    checkedAt: new Date().toISOString(),
    pagesChecked: 1,
    lastViewedAt: views.lastViewedAt,
  };
}

function anyTerm(terms: string[]): string {
  return terms.map((t) => `summary ~ ${t.startsWith('"') ? t : JSON.stringify(t)}`).join(' OR ');
}

async function collectSummaryCounts(jira: JiraClient): Promise<TermCounts> {
  const rows: TermCounts = {};
  for (const [key, terms] of Object.entries(SUMMARY_TERMS)) {
    const cond = `issuetype = Incident AND (${anyTerm(terms)})`;
    const counts = {} as WindowCounts;
    for (const [w, range] of Object.entries(WINDOWS)) {
      counts[w as keyof WindowCounts] = await jira.count(range ? `${cond} AND ${range}` : cond);
    }
    counts.open = await jira.count(`${cond} AND resolution = Unresolved`);
    rows[key] = counts;
  }
  return rows;
}

async function collectIncidentTotals(jira: JiraClient): Promise<WindowCounts> {
  const totals = {} as WindowCounts;
  for (const [w, range] of Object.entries(WINDOWS)) {
    totals[w as keyof WindowCounts] = await jira.count(
      range ? `issuetype = Incident AND ${range}` : 'issuetype = Incident',
    );
  }
  totals.open = await jira.count('issuetype = Incident AND resolution = Unresolved');
  return totals;
}

async function fieldOptions(conn: AtlassianConnection): Promise<string[]> {
  const base = conn.siteUrl.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64')}`;
  const ctx = await fetch(`${base}/rest/api/3/field/customfield_24728/context`, {
    headers: { authorization: auth, accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const options: string[] = [];
  for (const c of (ctx?.values ?? []) as Array<{ id: string }>) {
    const opt = await fetch(
      `${base}/rest/api/3/field/customfield_24728/context/${c.id}/option?maxResults=200`,
      { headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(30000) },
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    for (const o of (opt?.values ?? []) as Array<{ value: string }>) options.push(o.value);
  }
  const unique = [...new Set(options)];
  return unique.length ? unique : FIELD_FALLBACK;
}

async function collectFieldCounts(
  conn: AtlassianConnection,
  jira: JiraClient,
): Promise<{ options: string[]; counts: TermCounts }> {
  const options = await fieldOptions(conn);
  const counts: TermCounts = {};
  for (const name of options) {
    const esc = name.replace(/"/g, '\\"');
    const base = `issuetype = Incident AND (customfield_24728 = "${esc}" OR cf[24728] = "${esc}")`;
    counts[name] = {
      d30: await jira.count(`${base} AND created >= -30d`),
      d90: await jira.count(`${base} AND created >= -90d`),
      y1: await jira.count(`${base} AND created >= -365d`),
      all: await jira.count(base),
      open: await jira.count(`${base} AND resolution = Unresolved`),
    };
  }
  return { options, counts };
}

async function collectExtra(jira: JiraClient): Promise<ExtraSnapshot> {
  const prio30: Record<string, number> = {};
  for (const p of await jira.priorities()) {
    prio30[p] = await jira.count(
      `issuetype = Incident AND created >= -30d AND priority = "${p.replace(/"/g, '\\"')}"`,
    );
  }

  const weeks: ExtraSnapshot['weeks'] = [];
  for (const [system, cond] of Object.entries(WEEKLY_SYSTEMS)) {
    const series: number[] = [];
    for (let w = 0; w < 12; w++) {
      series.push(
        await jira.count(
          `issuetype = Incident AND (${cond}) AND created >= -${(w + 1) * 7}d AND created < -${w * 7}d`,
        ),
      );
    }
    weeks.push({ system, series: series.reverse() });
  }

  const samples: ExtraSnapshot['samples'] = {};
  for (const [system, jql] of Object.entries(SAMPLE_JQL)) {
    samples[system] = await jira.search(jql, 8);
  }

  return { prio30, weeks, samples };
}

export interface CollectOptions {
  spaces: string[];
  includeJira: boolean;
  rootId: string;
  dataDir: string;
}

export async function collectAll(options: CollectOptions): Promise<Record<string, unknown>> {
  const { spaces, includeJira, rootId, dataDir } = options;
  mkdirSync(dataDir, { recursive: true });
  const api = await loadConfluence(spaces[0] ?? 'OTT');
  const written: Record<string, unknown> = {};

  const spaceList = await listSpaces(api);
  writeFileSync(join(dataDir, 'spaces.json'), JSON.stringify(spaceList, null, 1));
  written.spaces = spaceList.length;

  for (const key of spaces) {
    const pages = await collectSpacePages(api, key);
    const file = pageFileFor(key);
    writeFileSync(join(dataDir, file), JSON.stringify(pages, null, 1));
    written[file] = pages.length;
  }

  if (spaces.includes('OTT')) {
    const tree = await collectSpaceTree(api, rootId);
    writeFileSync(join(dataDir, 'tree-level2.json'), JSON.stringify(tree, null, 1));
    written['tree-level2.json'] = tree.length;

    const analytics = await probeAnalytics(api, rootId);
    writeFileSync(join(dataDir, 'analytics-probe.json'), JSON.stringify(analytics, null, 1));
    written.analytics = analytics.available ? 'available' : 'not-available';
  }

  if (includeJira) {
    const conn = await loadConnection();
    const jira = await createJiraClient(conn);
    const [kw, totals, field, extra] = [
      await collectSummaryCounts(jira),
      await collectIncidentTotals(jira),
      await collectFieldCounts(conn, jira),
      await collectExtra(jira),
    ];
    writeFileSync(join(dataDir, 'incidents.json'), JSON.stringify(kw, null, 1));
    writeFileSync(join(dataDir, 'incident-totals.json'), JSON.stringify(totals, null, 1));
    writeFileSync(join(dataDir, 'incidents-by-system-field.json'), JSON.stringify(field, null, 1));
    writeFileSync(join(dataDir, 'report-extra.json'), JSON.stringify(extra, null, 1));
    written.jira = totals;
  }

  return written;
}
