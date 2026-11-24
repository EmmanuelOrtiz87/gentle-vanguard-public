/**
 * Puente tipado a la capa Atlassian ya probada del stack:
 * - Confluence: apps/censor/lib/confluence.mjs (CQL por cursor, gap 110 ms, retry 429).
 * - Credenciales: apps/censor/lib/vault.mjs (vault propio de Censor).
 * Se importa por URL para no duplicar cliente ni rate-limit (stack-first).
 */
import type { IssueSample } from './types.js';

const CONFLUENCE_MOD = new URL('../../../../apps/censor/lib/confluence.mjs', import.meta.url);
const VAULT_MOD = new URL('../../../../apps/censor/lib/vault.mjs', import.meta.url);

export interface ConfluenceApi {
  cfg: { base: string; space: string };
  request: (
    path: string,
    options?: { query?: Record<string, unknown>; method?: string },
  ) => Promise<any>;
  searchCql: (
    cql: string,
    options?: { limit?: number; maxPages?: number; expand?: string },
  ) => Promise<{ items: any[]; totalSize: number }>;
  fetchViews: (
    pageId: string,
  ) => Promise<{ views: number | null; lastViewedAt: string | null; available: boolean }>;
}

export interface AtlassianConnection {
  siteUrl: string;
  email: string;
  apiToken: string;
}

export async function loadConnection(): Promise<AtlassianConnection> {
  const mod: any = await import(VAULT_MOD.href);
  const conn = mod.loadConnection();
  if (!conn?.siteUrl || !conn?.email || !conn?.apiToken) {
    throw new Error(
      'Sin conexión Atlassian en el vault de Censor: configurala en Ajustes de Censor o por .env.',
    );
  }
  return conn;
}

export async function loadConfluence(space: string): Promise<ConfluenceApi> {
  const mod: any = await import(CONFLUENCE_MOD.href);
  return mod.createClient({ space });
}

export interface JiraClient {
  count: (jql: string) => Promise<number>;
  search: (jql: string, maxResults?: number) => Promise<IssueSample[]>;
  priorities: () => Promise<string[]>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function createJiraClient(conn: AtlassianConnection): Promise<JiraClient> {
  const base = conn.siteUrl.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64')}`;
  let lastStartedAt = 0;

  async function call(path: string, init?: RequestInit): Promise<Response> {
    const gap = Date.now() - lastStartedAt;
    if (gap < 60) await sleep(60 - gap);
    lastStartedAt = Date.now();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(base + path, {
        ...init,
        headers: { authorization: auth, accept: 'application/json', ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(30000),
      });
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 2) return res;
      await sleep([1000, 3000][attempt]);
    }
  }

  return {
    async count(jql) {
      const res = await call('/rest/api/3/search/approximate-count', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jql }),
      });
      if (!res.ok) return -1;
      const body = (await res.json().catch(() => ({}))) as { count?: number };
      return body.count ?? -1;
    },
    async search(jql, maxResults = 8) {
      const url = new URL(`${base}/rest/api/3/search/jql`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('fields', 'summary,created,status,priority,project');
      const res = await call(url.pathname + url.search);
      if (!res.ok) return [];
      const data = (await res.json().catch(() => ({}))) as { issues?: any[] };
      return (data.issues ?? []).map((i: any) => ({
        key: i.key,
        summary: i.fields?.summary ?? '',
        created: i.fields?.created ?? '',
        status: i.fields?.status?.name ?? '',
        priority: i.fields?.priority?.name ?? '',
      }));
    },
    async priorities() {
      const res = await call('/rest/api/3/priority');
      if (!res.ok) return [];
      const data = (await res.json().catch(() => [])) as Array<{ name?: string }>;
      return data.map((p) => p.name ?? '').filter(Boolean);
    },
  };
}
