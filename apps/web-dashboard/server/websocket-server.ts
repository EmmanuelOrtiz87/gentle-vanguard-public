import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, watch, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { getBridge } from './mcp-bridge.ts';
import { getStateBridge } from './shared-state-bridge.ts';
import { getGlobalHealth } from './global-health-api.ts';
import { getResilienceConfig } from '@gentle-vanguard/core/resilience-bridge';
import {
  getListings,
  getListing,
  createListing,
  addReview,
  incrementDownloads,
  installListing,
  uninstallListing,
  getListingVersions,
  createListingVersion,
  rollbackListing,
  getCatalogValidationReport,
  updateListingReviewStatus,
  createMigrationDraft,
  createAllMigrationDrafts,
  applyMigration,
  applyAllMigrations,
  validateSkillStructure,
  getSkillContent,
} from './marketplace-api.ts';
import { DatabaseManager, DEFAULT_TENANT_ID } from './database/manager.ts';
import { getOtelPipeline } from './otel-pipeline.ts';
import {
  getRealMetrics,
  getMetricHistory,
  getTraces,
  getCloudMetrics,
  getTenantScopedMetrics,
  getSkillUsageFromDb,
  getTokenUsageFromDb,
  getContractResultsFromDb,
  getRoutingRulesFromDb,
} from './real-data.ts';
import {
  mcpServersHandler,
  mcpServerActionHandler,
  mcpServerRegisterHandler,
} from './mcp-gateway-api.ts';
import { meshHandler, meshDiscoverHandler, meshSyncHandler } from './mesh-api.ts';
import { runValidations } from './validations.ts';
import { ROOT, readJson, countSkills, STACK_VERSION } from './shared.ts';
import { knowledgeHandler } from './knowledge-api.ts';
import { OperationalMetricsTracker } from '@gentle-vanguard/core/operational-metrics-tracker';
import { createDashboardAuth } from './auth.ts';
import { createHash, randomBytes } from 'node:crypto';
import { can, resolveRoutePermission } from './rbac.ts';
import { createLoginRateLimiter } from './login-rate-limiter.ts';
import { isDashboardRole, type DashboardRole } from './database/repositories/PrincipalRepo';
import {
  resolveDeploymentTenantContext,
  validateTenantSelector,
  type DeploymentTenantContext,
} from '../../../src/deployment-tenant-context.ts';
import {
  loadManifest,
  loadPlatformRegistry,
  packageJob,
  saveManifest,
  transition,
  validate as validateContentJob,
  type Status,
} from '../../../src/content-operations/engine.ts';

const ALERTS_CONFIG_PATH = join(ROOT, 'config', 'dashboard-alerts.json');
import type {
  AgentSession,
  AgentMessage,
  AgentToolCall,
  HitlRequest,
  HitlResponse,
  UIHint,
} from '../src/types/agent.ts';
import { parseSkillList, buildSkillListHint } from '../src/lib/agent-command-utils.ts';

const STATS_PATH = join(ROOT, '.atl', 'skill-stats.json');
const REGISTRY_PATH = join(ROOT, '.atl', 'skill-registry.md');
const SESSIONS_HISTORY_PATH = join(ROOT, '.event-bus', 'sessions-history.json');

const PORT = parseInt(process.env.WS_PORT || '8080', 10);
const dashboardDatabase = DatabaseManager.getInstance();
const dashboardAuth = createDashboardAuth(process.env, dashboardDatabase.authSessions);
const loginRateLimiter = createLoginRateLimiter(process.env);
const CSRF_COOKIE = 'gv_dashboard_csrf';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface SessionAccess {
  principalId: string;
  role: DashboardRole;
}

/** Resolve the authenticated session to its bound principal + tenant role. */
function resolveSessionAccess(req: IncomingMessage): SessionAccess | undefined {
  if (dashboardAuth.devMode && dashboardAuth.isLocalhost(req)) return undefined;
  const sessionId = dashboardAuth.cookie(req);
  if (!sessionId) return undefined;
  const principalId = dashboardDatabase.authSessions.getPrincipalId(sessionId);
  if (!principalId) return undefined;
  const role = dashboardDatabase.principals.getRole(DEFAULT_TENANT_ID, principalId);
  if (!role) return undefined;
  return { principalId, role };
}

function devBypassActive(req: IncomingMessage): boolean {
  // devMode bypass (GV_DASHBOARD_DEV_AUTH=1) or the local-default profile:
  // no configured token + loopback request = trusted owner access (ADR-0017).
  // Production always resolves sessions through RBAC instead.
  return (
    !dashboardAuth.productionMode &&
    (dashboardAuth.devMode || !dashboardAuth.enabled) &&
    dashboardAuth.isLocalhost(req)
  );
}

/**
 * Double-submit CSRF verification for cookie-authenticated mutations:
 * the X-GV-CSRF header must match the CSRF cookie, and both must hash to
 * the value stored server-side with the session.
 */
function verifyCsrf(req: IncomingMessage): boolean {
  const sessionId = dashboardAuth.cookie(req);
  if (!sessionId) return false;
  const header = req.headers['x-gv-csrf'];
  const headerToken = Array.isArray(header) ? header[0] : header;
  if (!headerToken) return false;
  let cookieToken: string | undefined;
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === CSRF_COOKIE) cookieToken = value.join('=') || undefined;
  }
  if (!cookieToken || cookieToken !== headerToken) return false;
  try {
    return dashboardDatabase.authSessions.getCsrfHash(sessionId) === sha256Hex(headerToken);
  } catch {
    return false;
  }
}

if (dashboardAuth.warning) console.warn(`[AUTH-WARNING] ${dashboardAuth.warning}`);
const deploymentTenant = resolveDeploymentTenantContext(
  process.env,
  join(ROOT, 'config', 'tenant-registry.json'),
);
const server = createServer(handleRequest);
const MAX_JSON_BODY_BYTES = 1_048_576;
const MAX_WS_MESSAGE_BYTES = 256 * 1024;
const MAX_WS_BUFFERED_BYTES = 1_048_576;
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.timeout = 30_000;
server.keepAliveTimeout = 5_000;
server.on('error', (err: Error) => console.error('[WS-ERROR] HTTP server:', err.message));
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });
const wsTenants = new WeakMap<WebSocket, DeploymentTenantContext>();
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (!validateTenantSelector(deploymentTenant, url.searchParams.get('tenantId'))) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (url.searchParams.has('token') || !dashboardAuth.authenticate(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('error', (err: Error) => console.error('[WS-ERROR] WS server:', err.message));

const clients = new Set<WebSocket>();
const agentSubscriptions = new Map<string, Set<WebSocket>>();
const sessions = new Map<string, AgentSession>();
const connPerIp = new Map<string, number>();
const MAX_CONN_PER_IP = 5;
const dashboardTelemetry = {
  httpRequests: 0,
  httpErrors: 0,
  httpLatencyTotalMs: 0,
  httpLatencyMaxMs: 0,
  httpStatusCounts: new Map<number, number>(),
  wsConnectionsTotal: 0,
  wsConnectionsPeak: 0,
};
let bridgeReady = false;
let bridgeToolCount = 0;

class RequestBodyTooLargeError extends Error {}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<T> {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > maxBytes) throw new RequestBodyTooLargeError('Request body too large');
  const chunks: Buffer[] = [];
  let bytes = 0;
  return new Promise<T>((resolve, reject) => {
    const fail = (error: Error): void => {
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
      req.resume();
      reject(error);
    };
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(new RequestBodyTooLargeError('Request body too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', (error) => reject(error));
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
}

function safeSend(ws: WebSocket, message: string): boolean {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) return false;
  try {
    ws.send(message);
    return true;
  } catch {
    return false;
  }
}

function sendJson(ws: WebSocket, payload: unknown): boolean {
  return safeSend(ws, JSON.stringify(payload));
}

interface ActiveSkillExecution {
  active: boolean;
  cancelled: boolean;
  messageId?: string;
  abortController?: AbortController;
}

const activeSkillExecutions = new Map<string, ActiveSkillExecution>();

// ─── Database Persistence Layer ───────────────────────────────────────
// Unified OTel pipeline: owns both the spans ingest cycle and the
// MetricsWriter snapshot cycle (see server/otel-pipeline.ts).
const otelPipeline = getOtelPipeline();
let metricsWriterStarted = false;

function loadStats() {
  const content = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH);
  return content || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };
}

function saveSessions(): void {
  try {
    const dir = dirname(SESSIONS_HISTORY_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      agent: s.agent,
      status: s.status,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: s.messages,
    }));
    writeFileSync(SESSIONS_HISTORY_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch {
    /* persistence best-effort */
  }
}

function loadSessions(): void {
  try {
    if (!existsSync(SESSIONS_HISTORY_PATH)) return;
    const content = readFileSync(SESSIONS_HISTORY_PATH, 'utf-8');
    const list: AgentSession[] = JSON.parse(content);
    for (const s of list) {
      if (!s.messages) s.messages = [];
      if (!sessions.has(s.id)) sessions.set(s.id, s);
    }
    console.log(`[HISTORY] Loaded ${list.length} sessions from disk`);
  } catch {
    /* best-effort */
  }
}

function generateMetrics(tenantId?: string) {
  const effectiveTenantId = tenantId ?? deploymentTenant.tenantId;
  const real = effectiveTenantId ? getTenantScopedMetrics(effectiveTenantId) : getRealMetrics();
  return {
    ...real,
    globalHealth: getGlobalHealth(),
    tenantScope: deploymentTenant.configured
      ? { type: deploymentTenant.scopeLabel, tenantId: deploymentTenant.tenantId }
      : {
          type: deploymentTenant.scopeLabel,
          warning: 'Metrics are system-wide; no tenant boundary is configured.',
        },
  };
}

function readAuditEntries(limit = 100, query = ''): Array<Record<string, unknown>> {
  const auditDir = join(ROOT, '.session', 'audit', 'logs');
  if (!existsSync(auditDir)) return [];
  const needle = query.trim().toLowerCase();
  const entries: Array<Record<string, unknown>> = [];
  const files = readdirSync(auditDir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort()
    .reverse();
  for (const file of files) {
    try {
      const lines = readFileSync(join(auditDir, file), 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean)
        .reverse();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (!needle || JSON.stringify(entry).toLowerCase().includes(needle)) entries.push(entry);
          if (entries.length >= limit) return entries;
        } catch {
          // Ignore incomplete JSONL lines while a writer is appending.
        }
      }
    } catch {
      // Audit viewer is best-effort and must not affect the metrics API.
    }
  }
  return entries;
}

function prometheusMetrics(): string {
  const metrics = generateMetrics() as Record<string, any>;
  const health = getGlobalHealth() as Record<string, any>;
  const otel = otelPipeline.getStats();
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const lines = [
    '# HELP gentle_vanguard_dashboard_up Dashboard process health.',
    '# TYPE gentle_vanguard_dashboard_up gauge',
    'gentle_vanguard_dashboard_up 1',
    '# HELP gentle_vanguard_dashboard_uptime_seconds Dashboard process uptime.',
    '# TYPE gentle_vanguard_dashboard_uptime_seconds gauge',
    `gentle_vanguard_dashboard_uptime_seconds ${process.uptime()}`,
    '# HELP gentle_vanguard_dashboard_ws_connections Current WebSocket clients.',
    '# TYPE gentle_vanguard_dashboard_ws_connections gauge',
    `gentle_vanguard_dashboard_ws_connections ${clients.size}`,
    '# HELP gentle_vanguard_tokens_used Current real token consumption.',
    '# TYPE gentle_vanguard_tokens_used gauge',
    `gentle_vanguard_tokens_used ${number(metrics.tokens?.used)}`,
    '# HELP gentle_vanguard_active_sessions Current active sessions.',
    '# TYPE gentle_vanguard_active_sessions gauge',
    `gentle_vanguard_active_sessions ${number(metrics.sessions?.active)}`,
    '# HELP gentle_vanguard_health_status Health status encoded as 1 healthy, 0 otherwise.',
    '# TYPE gentle_vanguard_health_status gauge',
    `gentle_vanguard_health_status ${health.status === 'healthy' || health.status === 'ok' ? 1 : 0}`,
    // ── OTel pipeline self-observability ──
    '# HELP gentle_vanguard_otel_pipeline_running Whether the unified OTel pipeline is running.',
    '# TYPE gentle_vanguard_otel_pipeline_running gauge',
    `gentle_vanguard_otel_pipeline_running ${otel.running ? 1 : 0}`,
    '# HELP gentle_vanguard_otel_spans_ingested_total Total spans ingested into Nexus since process start.',
    '# TYPE gentle_vanguard_otel_spans_ingested_total counter',
    `gentle_vanguard_otel_spans_ingested_total ${number(otel.spansIngestedTotal)}`,
    '# HELP gentle_vanguard_otel_ingest_errors Total ingest cycle errors since process start.',
    '# TYPE gentle_vanguard_otel_ingest_errors counter',
    `gentle_vanguard_otel_ingest_errors ${number(otel.ingestErrors)}`,
    '# HELP gentle_vanguard_otel_last_ingest_age_seconds Seconds since the last successful ingest cycle.',
    '# TYPE gentle_vanguard_otel_last_ingest_age_seconds gauge',
    `gentle_vanguard_otel_last_ingest_age_seconds ${
      otel.lastIngestAt ? Math.max(0, (Date.now() - Date.parse(otel.lastIngestAt)) / 1000) : -1
    }`,
  ];
  return `${lines.join('\n')}\n`;
}

interface TenantSloObjectives {
  availabilityTargetPct: number;
  latencyTargetMs: number;
  errorBudgetPct: number;
}

/** SLO defaults; overridable per tenant via config/tenant-registry.json. */
const SLO_DEFAULTS: TenantSloObjectives = {
  availabilityTargetPct: 99.9,
  latencyTargetMs: 2000,
  errorBudgetPct: 0.1,
};

function getTenantSloObjectives(tenantId?: string): TenantSloObjectives {
  const effective = tenantId || deploymentTenant.tenantId;
  try {
    const registryPath = join(ROOT, 'config', 'tenant-registry.json');
    if (existsSync(registryPath)) {
      const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
      // Registry-level defaults first…
      const base: TenantSloObjectives = {
        ...SLO_DEFAULTS,
        ...(registry.sloDefaults ?? {}),
      };
      // …then tenant-specific overrides.
      const tenant = (registry.tenants ?? []).find((t: any) => t.id === effective);
      if (tenant?.slo) return { ...base, ...tenant.slo };
      return base;
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...SLO_DEFAULTS };
}

function calculateBurnRate(tenantId?: string) {
  const objectives = getTenantSloObjectives(tenantId);
  const errorBudget = objectives.errorBudgetPct / 100;
  const windows = [
    { label: '1h', range: '1h' as const },
    { label: '6h', range: '7d' as const, hours: 6 },
    { label: '24h', range: '24h' as const },
    { label: '72h', range: '7d' as const, hours: 72 },
  ];
  return windows.map(({ label, range, hours }) => {
    const history = getMetricHistory(2000, range).filter((row: any) => {
      if (!hours) return true;
      const timestamp = Date.parse(String(row.timestamp || ''));
      return Number.isFinite(timestamp) && Date.now() - timestamp <= hours * 60 * 60 * 1000;
    });
    const total = history.length;
    const errors = history.filter(
      (row: any) =>
        !['healthy', 'ok', 'pass'].includes(String(row.health_status || '').toLowerCase()),
    ).length;
    const errorRate = total > 0 ? errors / total : null;
    return {
      window: label,
      samples: total,
      errors,
      errorRate,
      burnRate: errorRate === null ? null : errorBudget > 0 ? errorRate / errorBudget : null,
      status:
        total === 0
          ? 'NO_DATA'
          : errorRate !== null && errorRate > errorBudget
            ? 'BREACH'
            : 'WITHIN_BUDGET',
    };
  });
}

// --- Agent Session Management ---

function createSession(agent: string): AgentSession {
  const session: AgentSession = {
    id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agent,
    status: 'idle',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sessions.set(session.id, session);
  return session;
}

function addMessage(sessionId: string, msg: AgentMessage): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push(msg);
    session.updatedAt = new Date().toISOString();
    saveSessions();
  }
}

function broadcastToSession(sessionId: string, payload: Record<string, unknown>): void {
  const subs = agentSubscriptions.get(sessionId);
  if (!subs) return;
  const msg = JSON.stringify(payload);
  for (const ws of subs) {
    safeSend(ws, msg);
  }
}

const hitlTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleHitlTimeout(request: HitlRequest, sessionId: string): void {
  if (!request.timeoutMs || request.timeoutMs <= 0) return;
  const timeout = setTimeout(() => {
    hitlTimeouts.delete(request.id);
    const session = sessions.get(sessionId);
    if (session) session.status = 'active';
    const response: HitlResponse = {
      requestId: request.id,
      kind: request.kind,
      approved: false,
      reviewed: false,
      timedOut: true,
      sessionId,
    };
    broadcastToSession(sessionId, { type: 'hitl_resolved', requestId: request.id, response });
  }, request.timeoutMs);
  hitlTimeouts.set(request.id, timeout);
}

function cancelHitlTimeout(requestId: string): void {
  const timeout = hitlTimeouts.get(requestId);
  if (timeout) {
    clearTimeout(timeout);
    hitlTimeouts.delete(requestId);
  }
}

function buildDemoHitlRequest(session: AgentSession, text: string): HitlRequest {
  const base = {
    id: `hitl-${Date.now()}`,
    sessionId: session.id,
    timeoutMs: 60000,
  };
  if (text.includes('elige') || text.includes('choose') || text.includes('select')) {
    return {
      ...base,
      kind: 'selection' as const,
      title: 'Select an Option',
      message: `Agent ${session.agent} needs you to pick an option.`,
      options: ['Option A', 'Option B', 'Option C'],
    };
  }
  if (text.includes('formulario') || /\bform\b/.test(text)) {
    return {
      ...base,
      kind: 'form' as const,
      title: 'Complete the Form',
      message: `Agent ${session.agent} needs additional input.`,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Your name' },
        { name: 'count', label: 'Count', type: 'number', required: true },
        {
          name: 'mode',
          label: 'Mode',
          type: 'select',
          required: true,
          options: ['fast', 'safe', 'balanced'],
        },
        { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional notes' },
        { name: 'dryRun', label: 'Dry run', type: 'boolean' },
      ],
    };
  }
  if (text.includes('revisar') || text.includes('review')) {
    return {
      ...base,
      kind: 'review' as const,
      title: 'Review Changes',
      message: `Agent ${session.agent} prepared changes for your review.`,
      review: [
        { label: 'File', value: 'src/config.ts', severity: 'info' },
        { label: 'Lines changed', value: '+42 / -17', severity: 'info' },
        { label: 'Breaking change', value: 'Yes — API contract updated', severity: 'warning' },
        { label: 'Security', value: 'New secret rotation required', severity: 'error' },
      ],
    };
  }
  return {
    ...base,
    kind: 'confirmation' as const,
    title: 'Human-in-the-Loop Required',
    message: `Agent ${session.agent} requires your approval before proceeding.`,
  };
}

async function handleAgentCommand(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
  const { action, sessionId, agent, skill, params } = msg as Record<string, string>;

  if (action === 'create_session') {
    const session = createSession(agent || 'DEV');
    subscribeToAgentSession(ws, session.id);
    sendJson(ws, { type: 'agent_session_created', session });
    return;
  }

  if (!sessionId) {
    sendJson(ws, { type: 'error', error: 'sessionId required' });
    return;
  }

  const session = sessions.get(sessionId as string);
  if (!session) {
    sendJson(ws, { type: 'error', error: 'Session not found' });
    return;
  }

  if (action === 'subscribe') {
    subscribeToAgentSession(ws, sessionId as string);
    sendJson(ws, { type: 'subscribed', sessionId });
    return;
  }

  if (action === 'list_sessions') {
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      agent: s.agent,
      status: s.status,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    }));
    sendJson(ws, { type: 'agent_sessions', sessions: list });
    return;
  }

  if (action === 'list_history') {
    sendJson(ws, { type: 'agent_history', sessions: Array.from(sessions.values()) });
    return;
  }

  if (action === 'get_session') {
    sendJson(ws, { type: 'agent_session', session });
    return;
  }

  if (action === 'list_tools') {
    const bridge = getBridge();
    sendJson(ws, { type: 'agent_tools', tools: bridge.tools, connected: bridge.connected });
    return;
  }

  if (action === 'execute_skill') {
    void executeSkillAndStream(
      ws,
      session,
      skill as string,
      params as unknown as Record<string, unknown>,
    );
    return;
  }

  if (action === 'cancel') {
    cancelSkillExecution(session.id, ws);
    return;
  }

  if (action === 'list_skills' || action === 'search_skills') {
    await handleSkillListing(ws, session, action, (msg as { query?: string }).query);
    return;
  }

  if (action === 'emit_event') {
    const eventMsg = msg as { event?: string; payload?: Record<string, unknown> };
    if (eventMsg.event) {
      getStateBridge().emitEvent(eventMsg.event, eventMsg.payload || {});
    }
    return;
  }

  if (action === 'hitl_response') {
    const hitlResponse = msg as unknown as HitlResponse;
    session.status = 'active';
    cancelHitlTimeout(hitlResponse.requestId);
    broadcastToSession(session.id, {
      type: 'hitl_resolved',
      requestId: hitlResponse.requestId,
      response: hitlResponse,
    });
    return;
  }

  if (action === 'send_message') {
    const userMsg: AgentMessage = {
      id: `msg-${Date.now()}`,
      agent: session.agent,
      role: 'user',
      content: (msg as Record<string, string>).message || '',
      timestamp: new Date().toISOString(),
    };
    addMessage(session.id, userMsg);
    broadcastToSession(session.id, { type: 'agent_message', message: userMsg });

    const assistantMsg: AgentMessage = {
      id: `msg-${Date.now()}-1`,
      agent: session.agent,
      role: 'assistant',
      content: `Procesando solicitud en agente ${session.agent}...`,
      timestamp: new Date().toISOString(),
      streaming: true,
    };
    addMessage(session.id, assistantMsg);
    broadcastToSession(session.id, { type: 'agent_message', message: assistantMsg });

    const text = (msg as Record<string, string>).message?.toLowerCase() || '';
    const needsHITL =
      text.includes('approve') ||
      text.includes('confirm') ||
      text.includes('delegate') ||
      text.includes('revisar') ||
      text.includes('elige') ||
      text.includes('choose') ||
      text.includes('select') ||
      text.includes('formulario') ||
      /\bform\b/.test(text);

    if (needsHITL) {
      session.status = 'awaiting_input';
      const hitlRequest = buildDemoHitlRequest(session, text);
      broadcastToSession(session.id, { type: 'hitl_request', hitlRequest });
      scheduleHitlTimeout(hitlRequest, session.id);
    } else {
      setTimeout(() => {
        assistantMsg.streaming = false;
        assistantMsg.content = `Solicitud procesada por agente ${session.agent}. La respuesta sería generada aquí en producción.`;
        broadcastToSession(session.id, { type: 'agent_message', message: assistantMsg });
        broadcastToSession(session.id, { type: 'agent_stream_done', messageId: assistantMsg.id });
      }, 1500);
    }
    return;
  }
}

function cancelSkillExecution(sessionId: string, ws: WebSocket): void {
  const exec = activeSkillExecutions.get(sessionId);
  if (!exec || !exec.active) {
    sendJson(ws, { type: 'error', error: 'No active skill execution to cancel' });
    return;
  }
  exec.cancelled = true;
  exec.abortController?.abort();
  const systemMsg: AgentMessage = {
    id: `msg-${Date.now()}`,
    agent: 'system',
    role: 'system',
    content: 'Ejecución cancelada.',
    timestamp: new Date().toISOString(),
  };
  addMessage(sessionId, systemMsg);
  broadcastToSession(sessionId, { type: 'agent_message', message: systemMsg });
  if (exec.messageId) {
    broadcastToSession(sessionId, { type: 'agent_stream_done', messageId: exec.messageId });
  }
}

async function handleSkillListing(
  ws: WebSocket,
  session: AgentSession,
  action: 'list_skills' | 'search_skills',
  query?: string,
): Promise<void> {
  const bridge = getBridge();
  if (!bridge.connected) {
    sendJson(ws, { type: 'error', error: 'MCP bridge not connected' });
    return;
  }
  try {
    const args = action === 'search_skills' ? { query: query || '' } : {};
    const result = await bridge.callTool(action, args);
    const names = parseSkillList(result);
    const content =
      action === 'list_skills'
        ? `${names.length} skills disponibles. Haz clic en una skill para ejecutarla.`
        : `${names.length} resultado(s) para "${query || ''}". Haz clic en una skill para ejecutarla.`;
    const listMsg: AgentMessage = {
      id: `msg-${Date.now()}`,
      agent: session.agent,
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      uiHints: [buildSkillListHint(names)],
    };
    addMessage(session.id, listMsg);
    broadcastToSession(session.id, { type: 'agent_message', message: listMsg });
  } catch (err) {
    sendJson(ws, {
      type: 'error',
      error: `Failed to ${action}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function subscribeToAgentSession(ws: WebSocket, sessionId: string): void {
  if (!agentSubscriptions.has(sessionId)) {
    agentSubscriptions.set(sessionId, new Set());
  }
  const subs = agentSubscriptions.get(sessionId);
  if (subs) subs.add(ws);
}

function extractUiHints(result: unknown): UIHint[] | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.ui_hints)) return r.ui_hints as UIHint[];
  if (r.uiHint && typeof r.uiHint === 'object') return [r.uiHint as UIHint];
  return null;
}

function extractChunks(result: unknown): string[] | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const chunks = Array.isArray(r.chunks) ? r.chunks : Array.isArray(r.stream) ? r.stream : null;
  if (!chunks) return null;
  return chunks.filter((c): c is string => typeof c === 'string');
}

async function executeSkillAndStream(
  _ws: WebSocket,
  session: AgentSession,
  skillName: string,
  params?: Record<string, unknown>,
): Promise<void> {
  session.status = 'active';

  const toolCall: AgentToolCall = {
    id: `tc-${Date.now()}`,
    tool: 'execute_skill',
    args: { name: skillName, ...params },
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  const msg: AgentMessage = {
    id: `msg-${Date.now()}`,
    agent: session.agent,
    role: 'assistant',
    content: `Ejecutando skill "${skillName}"...`,
    timestamp: new Date().toISOString(),
    streaming: true,
    toolCalls: [toolCall],
  };

  const exec: ActiveSkillExecution = {
    active: true,
    cancelled: false,
    messageId: msg.id,
    abortController: new AbortController(),
  };
  activeSkillExecutions.set(session.id, exec);

  addMessage(session.id, msg);
  broadcastToSession(session.id, { type: 'agent_message', message: msg });

  const finalize = (cancelled: boolean): void => {
    exec.active = false;
    if (activeSkillExecutions.get(session.id) === exec) {
      activeSkillExecutions.delete(session.id);
    }
    msg.streaming = false;
    if (cancelled) {
      msg.content = `Skill "${skillName}" cancelado.`;
      toolCall.status = 'cancelled';
      toolCall.completedAt = new Date().toISOString();
    }
    broadcastToSession(session.id, { type: 'agent_message', message: msg });
    broadcastToSession(session.id, { type: 'agent_stream_done', messageId: msg.id });
    session.status = 'idle';
  };

  try {
    const bridge = getBridge();
    if (!bridge.connected) {
      throw new Error('MCP bridge not connected');
    }

    const result = await bridge.callTool('execute_skill', { name: skillName, params });
    if (exec.cancelled) {
      finalize(true);
      return;
    }

    // AG-UI Hints (patrón 2): parsear ui_hints de la respuesta MCP
    const uiHints = extractUiHints(result);
    if (uiHints && uiHints.length > 0) {
      msg.uiHints = uiHints;
      broadcastToSession(session.id, { type: 'agent_ui_hints', messageId: msg.id, uiHints });
    }

    // Streaming incremental (patrón 1): emitir chunks antes del mensaje final
    const chunks = extractChunks(result);

    toolCall.result = JSON.stringify(result);
    toolCall.completedAt = new Date().toISOString();

    if (chunks && chunks.length > 0) {
      chunks.forEach((chunk, i) => {
        setTimeout(
          () => {
            if (exec.cancelled) return;
            broadcastToSession(session.id, {
              type: 'agent_stream_chunk',
              messageId: msg.id,
              content: chunk,
            });
          },
          50 * (i + 1),
        );
      });
      setTimeout(
        () => {
          if (exec.cancelled) {
            finalize(true);
            return;
          }
          toolCall.status = 'completed';
          msg.content = chunks.join('');
          finalize(false);
        },
        50 * (chunks.length + 1),
      );
    } else {
      toolCall.status = 'completed';
      msg.content = `Skill "${skillName}" ejecutado exitosamente.`;
      finalize(false);
    }
  } catch (err) {
    if (exec.cancelled) {
      finalize(true);
      return;
    }
    msg.content = `Error ejecutando skill "${skillName}": ${err instanceof Error ? err.message : String(err)}`;
    toolCall.status = 'error';
    toolCall.error = err instanceof Error ? err.message : String(err);
    toolCall.completedAt = new Date().toISOString();
    finalize(false);
  }
}

// --- HTTP Handlers ---

process.on('uncaughtException', (err) => {
  console.error('[WS-ERROR] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err: unknown) => {
  console.error(
    '[WS-ERROR] Unhandled rejection:',
    err instanceof Error ? err.message : String(err),
  );
});

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const configuredOrigins = (
    process.env.GV_DASHBOARD_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;
  const allowedOrigin =
    requestOrigin && configuredOrigins.includes(requestOrigin)
      ? requestOrigin
      : configuredOrigins[0];
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GV-Dashboard-Token',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
  const requestStartedAt = Date.now();
  dashboardTelemetry.httpRequests++;
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
      res.end();
      return;
    }

    const publicHealth = url.pathname === '/api/health' && req.method === 'GET';
    const publicAuth =
      url.pathname === '/api/auth/status' ||
      url.pathname === '/api/auth/login' ||
      url.pathname === '/api/auth/logout';
    if (!publicHealth && !publicAuth && !dashboardAuth.authenticate(req)) {
      res.writeHead(401, { ...headers, 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ success: false, error: 'Dashboard authentication required' }));
      return;
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const clientKey = req.socket.remoteAddress || 'unknown';
      const limit = loginRateLimiter.check(clientKey);
      if (!limit.allowed) {
        res.writeHead(429, {
          ...headers,
          'Retry-After': String(limit.retryAfterSeconds),
        });
        res.end(JSON.stringify({ success: false, error: 'Too many login attempts' }));
        return;
      }
      const body = await readJsonBody<{ token?: string }>(req);
      const sessionId = dashboardAuth.login(body.token || '');
      if (!sessionId) {
        loginRateLimiter.recordFailure(clientKey);
        res.writeHead(401, headers);
        res.end(JSON.stringify({ success: false, error: 'Invalid dashboard token' }));
        return;
      }
      loginRateLimiter.reset(clientKey);

      // Bind session → principal with bootstrap semantics:
      // the first principal becomes admin; later logins keep their existing
      // tenant role or default to viewer (fail-closed).
      const subject = process.env.GV_DASHBOARD_PRINCIPAL_SUBJECT?.trim() || 'dashboard-operator';
      const principal = dashboardDatabase.principals.findOrCreateBySubject(
        subject,
        'Dashboard Operator',
      );
      let role = dashboardDatabase.principals.getRole(DEFAULT_TENANT_ID, principal.id);
      if (!role && dashboardDatabase.principals.countAdmins() === 0) role = 'admin';
      if (!role) role = 'viewer';
      dashboardDatabase.principals.upsertMembership(DEFAULT_TENANT_ID, principal.id, role);

      const csrfToken = randomBytes(32).toString('hex');
      try {
        dashboardDatabase.authSessions.bindSession(sessionId, principal.id, sha256Hex(csrfToken));
      } catch {
        dashboardAuth.logout(req);
        res.writeHead(500, headers);
        res.end(JSON.stringify({ success: false, error: 'Session binding failed' }));
        return;
      }
      dashboardDatabase.insertEvent('dashboard.auth.login', {
        principalId: principal.id,
        subject,
        role,
      });

      const ttlSeconds = Math.floor(
        (Number(process.env.GV_DASHBOARD_SESSION_TTL_MS) || 8 * 60 * 60 * 1000) / 1000,
      );
      const csrfCookie = `${CSRF_COOKIE}=${csrfToken}; Path=/; SameSite=Strict${dashboardAuth.productionMode ? '; Secure' : ''}; Max-Age=${ttlSeconds}`;
      res.writeHead(200, {
        ...headers,
        'Set-Cookie': [dashboardAuth.cookieHeader(sessionId), csrfCookie],
      });
      res.end(
        JSON.stringify({
          success: true,
          principal: { id: principal.id, subject: principal.subject, role },
        }),
      );
      return;
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      dashboardAuth.logout(req);
      const clearCsrf = `${CSRF_COOKIE}=; Path=/; SameSite=Strict${dashboardAuth.productionMode ? '; Secure' : ''}; Max-Age=0`;
      res.writeHead(200, {
        ...headers,
        'Set-Cookie': [dashboardAuth.clearCookieHeader(), clearCsrf],
      });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (url.pathname === '/api/auth/status') {
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          enabled: dashboardAuth.enabled,
          mode: dashboardAuth.devMode
            ? 'dev-localhost'
            : dashboardAuth.enabled
              ? 'session'
              : 'disabled',
          authenticated: dashboardAuth.authenticate(req),
          warning: dashboardAuth.warning,
        }),
      );
      return;
    }

    // ─── Admin API (RBAC v1) ────────────────────────────────────────────
    const adminMatch = url.pathname.match(
      /^\/api\/admin\/principals(?:\/([^/]+)(?:\/(role|revoke-sessions))?)?$/,
    );
    if (adminMatch) {
      const bypass = devBypassActive(req);
      const access = resolveSessionAccess(req);
      if (!bypass && (!access || access.role !== 'admin')) {
        res.writeHead(403, headers);
        res.end(JSON.stringify({ success: false, error: 'Admin role required' }));
        return;
      }
      const actorId = access?.principalId ?? 'dev-bypass';
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating && !bypass && !verifyCsrf(req)) {
        res.writeHead(403, headers);
        res.end(JSON.stringify({ success: false, error: 'CSRF token missing or invalid' }));
        return;
      }

      const [, principalId, adminAction] = adminMatch;

      if (!principalId && req.method === 'GET') {
        const principals = dashboardDatabase.principals.list().map((p) => ({
          ...p,
          memberships: dashboardDatabase.principals.listMemberships(p.id),
        }));
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, principals }));
        return;
      }

      if (!principalId && req.method === 'POST') {
        const body = await readJsonBody<{
          subject?: string;
          displayName?: string;
          role?: string;
        }>(req);
        const subject = body.subject?.trim();
        if (!subject) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ success: false, error: 'subject is required' }));
          return;
        }
        const role = body.role ?? 'viewer';
        if (!isDashboardRole(role)) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ success: false, error: 'role must be viewer|operator|admin' }));
          return;
        }
        const created = dashboardDatabase.principals.findOrCreateBySubject(
          subject,
          body.displayName,
        );
        dashboardDatabase.principals.upsertMembership(DEFAULT_TENANT_ID, created.id, role);
        dashboardDatabase.insertEvent('dashboard.admin.principal.create', {
          actorId,
          principalId: created.id,
          subject,
          role,
        });
        res.writeHead(201, headers);
        res.end(JSON.stringify({ success: true, principal: { ...created, role } }));
        return;
      }

      if (principalId && adminAction === 'role' && req.method === 'PATCH') {
        if (principalId === actorId) {
          res.writeHead(409, headers);
          res.end(JSON.stringify({ success: false, error: 'Cannot change own role' }));
          return;
        }
        const body = await readJsonBody<{ role?: string; tenantId?: string }>(req);
        const role = body.role;
        const tenantId = body.tenantId?.trim() || DEFAULT_TENANT_ID;
        if (!isDashboardRole(role)) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ success: false, error: 'role must be viewer|operator|admin' }));
          return;
        }
        const target = dashboardDatabase.principals.getById(principalId);
        if (!target) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Principal not found' }));
          return;
        }
        const previousRole = dashboardDatabase.principals.getRole(tenantId, principalId);
        if (
          previousRole === 'admin' &&
          role !== 'admin' &&
          dashboardDatabase.principals.countAdmins() <= 1
        ) {
          res.writeHead(409, headers);
          res.end(JSON.stringify({ success: false, error: 'Cannot demote the last admin' }));
          return;
        }
        dashboardDatabase.principals.upsertMembership(tenantId, principalId, role);
        dashboardDatabase.insertEvent('dashboard.admin.principal.role_change', {
          actorId,
          principalId,
          tenantId,
          from: previousRole ?? null,
          to: role,
        });
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, principalId, tenantId, role }));
        return;
      }

      if (principalId && adminAction === 'revoke-sessions' && req.method === 'POST') {
        const revoked = dashboardDatabase.authSessions.revokeAllForPrincipal(principalId);
        dashboardDatabase.insertEvent('dashboard.admin.sessions.revoke', {
          actorId,
          principalId,
          revoked,
        });
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, revoked }));
        return;
      }

      if (principalId && !adminAction && req.method === 'DELETE') {
        if (principalId === actorId) {
          res.writeHead(409, headers);
          res.end(JSON.stringify({ success: false, error: 'Cannot delete own principal' }));
          return;
        }
        const target = dashboardDatabase.principals.getById(principalId);
        if (!target) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Principal not found' }));
          return;
        }
        if (
          dashboardDatabase.principals.getRole(DEFAULT_TENANT_ID, principalId) === 'admin' &&
          dashboardDatabase.principals.countAdmins() <= 1
        ) {
          res.writeHead(409, headers);
          res.end(JSON.stringify({ success: false, error: 'Cannot delete the last admin' }));
          return;
        }
        dashboardDatabase.authSessions.revokeAllForPrincipal(principalId);
        dashboardDatabase.principals.delete(principalId);
        dashboardDatabase.insertEvent('dashboard.admin.principal.delete', {
          actorId,
          principalId,
          subject: target.subject,
        });
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(405, { ...headers, Allow: 'GET, POST, PATCH, DELETE, POST' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }

    if (!validateTenantSelector(deploymentTenant, url.searchParams.get('tenantId'))) {
      res.writeHead(400, headers);
      res.end(
        JSON.stringify({
          success: false,
          error: 'Tenant selector does not match this deployment',
        }),
      );
      return;
    }

    // ─── Coarse RBAC guard (policy v1) ─────────────────────────────────
    // Reads require viewer; mutations require operator (admin endpoints are
    // handled above with their own admin gate + CSRF). Local-default/dev
    // loopback bypass keeps full access; production sessions without a bound
    // principal must re-login to acquire one.
    const routePermission = resolveRoutePermission(url.pathname, req.method ?? 'GET');
    if (routePermission && !devBypassActive(req)) {
      const access = resolveSessionAccess(req);
      if (!access || !can(access.role, routePermission)) {
        res.writeHead(403, headers);
        res.end(
          JSON.stringify({
            success: false,
            error: 'Insufficient dashboard role',
            required: routePermission,
            policyVersion: 1,
          }),
        );
        return;
      }
    }

    if (url.pathname === '/api/metrics') {
      const tenantIdParam = url.searchParams.get('tenantId');
      const tenantId = typeof tenantIdParam === 'string' ? tenantIdParam : undefined;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'metrics', data: generateMetrics(tenantId) }));
      return;
    }

    if (url.pathname === '/api/sse/metrics') {
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      const send = () => {
        res.write(
          `event: metrics\ndata: ${JSON.stringify({ type: 'metrics', data: generateMetrics() })}\n\n`,
        );
      };
      send();
      const interval = setInterval(send, 5000);
      req.on('close', () => clearInterval(interval));
      return;
    }

    if (url.pathname === '/api/metrics/history') {
      const requested = Number(url.searchParams.get('limit') || 120);
      const requestedRange = url.searchParams.get('range');
      const ranges = new Set(['5m', '1h', '24h', '7d', '30d']);
      const range =
        requestedRange && ranges.has(requestedRange)
          ? (requestedRange as '5m' | '1h' | '24h' | '7d' | '30d')
          : undefined;
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'metrics_history',
          range: range || 'all',
          data: getMetricHistory(requested, range),
        }),
      );
      return;
    }

    if (url.pathname === '/metrics' || url.pathname === '/api/metrics/prometheus') {
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(prometheusMetrics());
      return;
    }

    if (url.pathname === '/api/audit') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
      const query = url.searchParams.get('q') || '';
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          success: true,
          data: { entries: readAuditEntries(limit, query), query, limit },
        }),
      );
      return;
    }

    // SLO metrics endpoint — GET returns latest, POST stores from perf:slo
    const SLO_PATH = join(ROOT, '.runtime', 'metrics', 'slo-latest.json');
    if (url.pathname === '/api/slo' && req.method === 'POST') {
      try {
        const data = await readJsonBody<Record<string, unknown>>(req);
        mkdirSync(dirname(SLO_PATH), { recursive: true });
        writeFileSync(
          SLO_PATH,
          JSON.stringify({ ...data, ingested: new Date().toISOString() }, null, 2),
        );
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(e instanceof RequestBodyTooLargeError ? 413 : 400, headers);
        res.end(
          JSON.stringify({
            error:
              e instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON',
          }),
        );
      }
      return;
    }
    if (url.pathname === '/api/validations') {
      // HTTP fallback so Validaciones en vivo has data on first paint
      // (WS broadcast remains the live source afterwards).
      res.writeHead(200, headers);
      try {
        const validations = runValidations(bridgeReady, bridgeToolCount, clients.size);
        res.end(JSON.stringify({ type: 'validations', data: validations }));
      } catch (err) {
        res.end(JSON.stringify({ type: 'validations', data: [] }));
      }
      return;
    }

    if (url.pathname === '/api/slo') {
      let sloData = existsSync(SLO_PATH) ? JSON.parse(readFileSync(SLO_PATH, 'utf8')) : null;
      // No SLO file → compute live SLOs from real Nexus data so the panel
      // always reflects actual stack health instead of "waiting".
      if (!sloData) {
        try {
          const db = DatabaseManager.getInstance();
          const sql = db.getDb();
          const traceStats = sql
            .prepare(
              "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors FROM traces WHERE tenant_id = ?",
            )
            .get(deploymentTenant.tenantId) as { total: number; errors: number | null };
          const lat = db.traces.getLatencyStats(deploymentTenant.tenantId ?? 'gentle-vanguard');
          const lastSpan = sql
            .prepare('SELECT MAX(start_time) AS last FROM traces WHERE tenant_id = ?')
            .get(deploymentTenant.tenantId) as {
            last: number | null;
          };
          const alertRows = sql
            .prepare(
              'SELECT COUNT(DISTINCT name) AS total, SUM(CASE WHEN triggered = 1 THEN 1 ELSE 0 END) AS fired FROM alerts WHERE tenant_id = ? AND id IN (SELECT MAX(id) FROM alerts WHERE tenant_id = ? GROUP BY name)',
            )
            .get(deploymentTenant.tenantId, deploymentTenant.tenantId) as {
            total: number;
            fired: number | null;
          };

          const mk = (name: string, current: number, threshold: number, unit: string): any => ({
            name,
            current,
            threshold,
            unit,
            status: current <= threshold ? 'PASS' : current <= threshold * 2 ? 'WARN' : 'FAIL',
          });
          const errorRatePct =
            traceStats.total > 0 ? ((traceStats.errors ?? 0) / traceStats.total) * 100 : 0;
          const freshnessMin = lastSpan.last
            ? Math.round((Date.now() - lastSpan.last) / 60000)
            : 9999;
          const alertFiredPct =
            alertRows.total > 0 ? ((alertRows.fired ?? 0) / alertRows.total) * 100 : 0;

          const checks = [
            mk('trace_error_rate_pct', Number(errorRatePct.toFixed(2)), 5, '%'),
            mk('latency_p95_ms', lat.p95, 60000, 'ms'),
            mk('telemetry_freshness_min', freshnessMin, 60, 'min'),
            mk('alerts_firing_pct', Number(alertFiredPct.toFixed(2)), 30, '%'),
          ];
          sloData = {
            timestamp: new Date().toISOString(),
            passed: checks.every((c) => c.status === 'PASS'),
            overall: {
              total: checks.length,
              passed: checks.filter((c) => c.status === 'PASS').length,
              warned: checks.filter((c) => c.status === 'WARN').length,
              failed: checks.filter((c) => c.status === 'FAIL').length,
            },
            checks,
          };
        } catch {
          sloData = null;
        }
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'slo', data: sloData }));
      return;
    }

    if (url.pathname === '/api/slo/burn-rate') {
      const tenantParam = url.searchParams.get('tenant') || undefined;
      const objectives = getTenantSloObjectives(tenantParam);
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          success: true,
          data: {
            tenant: tenantParam ?? deploymentTenant.tenantId,
            target: objectives.availabilityTargetPct,
            errorBudget: objectives.errorBudgetPct,
            latencyTargetMs: objectives.latencyTargetMs,
            windows: calculateBurnRate(tenantParam),
          },
        }),
      );
      return;
    }

    if (url.pathname === '/api/tenants') {
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          tenants: deploymentTenant.configured
            ? [
                {
                  id: deploymentTenant.tenantId,
                  name: deploymentTenant.tenantName,
                  isDefault: true,
                },
              ]
            : [],
        }),
      );
      return;
    }

    if (url.pathname === '/api/mcp/metrics') {
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'mcp',
          data: { skills: countSkills(REGISTRY_PATH), calls: loadStats() },
        }),
      );
      return;
    }

    if (url.pathname === '/api/mcp/servers' && req.method === 'POST') {
      mcpServerRegisterHandler(req, res, headers);
      return;
    }

    if (url.pathname === '/api/mcp/servers') {
      mcpServersHandler(req, res, headers);
      return;
    }

    if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/(start|stop)$/)) {
      mcpServerActionHandler(req, res, headers);
      return;
    }

    if (url.pathname === '/api/health') {
      const adaptiveNormsPath = join(ROOT, 'rules', 'adaptive', 'norms-registry.json');
      const adaptiveNorms = existsSync(adaptiveNormsPath)
        ? JSON.parse(readFileSync(adaptiveNormsPath, 'utf-8')).stats
        : null;
      const metricsReportPath = join(ROOT, '.session', 'metrics-report.json');
      const sessionMetrics = existsSync(metricsReportPath)
        ? JSON.parse(readFileSync(metricsReportPath, 'utf-8')).summary
        : null;
      const logAggregatePath = join(ROOT, '.session', 'logs', 'aggregate.json');
      const logAggregate = existsSync(logAggregatePath)
        ? JSON.parse(readFileSync(logAggregatePath, 'utf-8'))
        : null;
      const cloudMetricsFile = join(ROOT, '.session', 'cloud-metrics.json');
      const cloudMetrics = existsSync(cloudMetricsFile)
        ? JSON.parse(readFileSync(cloudMetricsFile, 'utf-8'))
        : null;
      const checkpointDir = join(ROOT, '.session', 'checkpoints');
      const checkpointCount = existsSync(checkpointDir)
        ? readdirSync(checkpointDir).filter((d) => !d.includes('.')).length
        : 0;
      const auditDir = join(ROOT, '.session', 'audit', 'logs');
      const auditFileCount = existsSync(auditDir)
        ? readdirSync(auditDir).filter((f) => f.endsWith('.jsonl')).length
        : 0;
      const telemetryDir = join(ROOT, '.telemetry', 'traces');
      const traceFileCount = existsSync(telemetryDir)
        ? readdirSync(telemetryDir).filter((f) => f.endsWith('.jsonl')).length
        : 0;

      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          status: 'ok',
          version: STACK_VERSION,
          uptime: process.uptime(),
          connections: clients.size,
          components: {
            websocket: { status: 'ok', clients: clients.size },
            dashboard: (() => {
              const requests = dashboardTelemetry.httpRequests;
              return {
                status: dashboardTelemetry.httpErrors === 0 ? 'ok' : 'degraded',
                httpRequests: requests,
                httpErrors: dashboardTelemetry.httpErrors,
                httpErrorRate: requests > 0 ? dashboardTelemetry.httpErrors / requests : 0,
                httpLatencyAvgMs:
                  requests > 0 ? dashboardTelemetry.httpLatencyTotalMs / requests : 0,
                httpLatencyMaxMs: dashboardTelemetry.httpLatencyMaxMs,
                httpStatusCounts: Object.fromEntries(dashboardTelemetry.httpStatusCounts),
                wsConnectionsTotal: dashboardTelemetry.wsConnectionsTotal,
                wsConnectionsPeak: dashboardTelemetry.wsConnectionsPeak,
              };
            })(),
            mcp: { status: bridgeReady ? 'ok' : 'degraded', tools: bridgeToolCount },
            adaptive: {
              status: adaptiveNorms ? 'ok' : 'unknown',
              normsLoaded: adaptiveNorms?.totalNorms || 0,
              sessionScore: sessionMetrics?.quality_score || 0,
              logEntries: logAggregate?.totals?.totalEntries || 0,
              logErrorRate: logAggregate?.totals?.errorRate || 0,
              logComponents: logAggregate?.componentCount || 0,
            },
            cloud: {
              status: cloudMetrics && cloudMetrics.executions?.length > 0 ? 'ok' : 'unknown',
              executions: cloudMetrics?.executions?.length || 0,
              totalCost:
                cloudMetrics?.executions?.reduce((s: number, e: any) => s + (e.cost || 0), 0) || 0,
            },
            tracing: {
              status: traceFileCount > 0 ? 'ok' : 'unknown',
              traceFiles: traceFileCount,
            },
            checkpoints: {
              status: checkpointCount > 0 ? 'ok' : 'unknown',
              total: checkpointCount,
            },
            audit: {
              status: auditFileCount > 0 ? 'ok' : 'unknown',
              logFiles: auditFileCount,
            },
            resilience: (() => {
              try {
                const config = getResilienceConfig();
                const operations = Object.keys(config.timeoutConfig).length;
                const circuitBreakers = Object.keys(config.circuitBreakers).length;
                return {
                  status: operations > 0 ? 'ok' : 'unknown',
                  operations,
                  circuitBreakers,
                  retryConfigured: Object.keys(config.retryConfig).length,
                };
              } catch {
                return { status: 'unknown', operations: 0, circuitBreakers: 0, retryConfigured: 0 };
              }
            })(),
            budget: (() => {
              try {
                const guardPath = join(ROOT, 'config', 'token-budget-guard.json');
                if (existsSync(guardPath)) {
                  const raw = JSON.parse(readFileSync(guardPath, 'utf-8'));
                  const limits = raw?.tokenBudget?.limits || {};
                  const usedPath = join(
                    ROOT,
                    'docs',
                    'sessions',
                    'metrics',
                    'token-guard-usage.csv',
                  );
                  let usedToday = 0;
                  if (existsSync(usedPath)) {
                    const csv = readFileSync(usedPath, 'utf-8');
                    const today = new Date().toISOString().slice(0, 10);
                    const lines = csv.split('\n').filter((l) => l.trim());
                    for (const line of lines.slice(1)) {
                      const cols = line.split(',');
                      if (cols[1] === today && /^\d+$/.test(cols[4])) {
                        usedToday += parseInt(cols[4], 10);
                      }
                    }
                  }
                  const daily = limits.daily || 120000;
                  return {
                    status: usedToday < daily ? 'ok' : 'warning',
                    dailyLimit: daily,
                    perSessionLimit: limits.perSession || 15000,
                    perAgentLimit: limits.perAgent || 3000,
                    usedToday,
                    usedPercent: Math.round((usedToday / daily) * 100),
                    softThreshold: limits.softThreshold || 70,
                    hardThreshold: limits.hardThreshold || 90,
                    sourceOfTruth: 'config/token-budget-guard.json',
                  };
                }
                return { status: 'unknown', dailyLimit: 0, usedToday: 0 };
              } catch {
                return { status: 'unknown', dailyLimit: 0, usedToday: 0 };
              }
            })(),
            auth: {
              enabled: dashboardAuth.enabled,
              mode: dashboardAuth.devMode
                ? 'dev-localhost'
                : dashboardAuth.enabled
                  ? 'session'
                  : 'disabled',
            },
          },
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === '/api/traces') {
      const rangeParam = url.searchParams.get('range') || '';
      const rangeMs =
        rangeParam === '1h'
          ? 3_600_000
          : rangeParam === '24h'
            ? 86_400_000
            : rangeParam === '7d'
              ? 604_800_000
              : 0;
      res.writeHead(200, headers);
      res.end(JSON.stringify(getTraces(rangeMs, deploymentTenant.tenantId)));
      return;
    }

    if (url.pathname === '/api/knowledge') {
      knowledgeHandler(req, res, headers);
      return;
    }

    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      try {
        const { traceId, spanId, type } = await readJsonBody<{
          traceId?: string;
          spanId?: string;
          type?: string;
        }>(req);
        if (!traceId || !spanId || !type) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'traceId, spanId, type required' }));
          return;
        }
        if (type !== 'up' && type !== 'down') {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'type must be up or down' }));
          return;
        }
        const db = DatabaseManager.getInstance();
        db.traces.insertFeedback(deploymentTenant.tenantId ?? 'gentle-vanguard', {
          trace_id: traceId,
          span_id: spanId,
          type,
        });
        const stats = db.traces.getFeedbackStats(deploymentTenant.tenantId ?? 'gentle-vanguard');
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true, score: stats.score }));
      } catch (e) {
        res.writeHead(e instanceof RequestBodyTooLargeError ? 413 : 400, headers);
        res.end(
          JSON.stringify({
            error:
              e instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON',
          }),
        );
      }
      return;
    }

    if (url.pathname === '/api/alerts') {
      let alerts: Record<string, unknown>[] = [];
      try {
        if (existsSync(ALERTS_CONFIG_PATH)) {
          const config = JSON.parse(readFileSync(ALERTS_CONFIG_PATH, 'utf-8'));
          const metrics = generateMetrics();
          alerts = Object.entries(config.rules || {})
            .filter(([, rule]: [string, any]) => rule.enabled !== false)
            .map(([name, rule]: [string, any]) => {
              const actual = rule.metric
                .split('.')
                .reduce((obj: any, key: string) => obj?.[key], metrics as any);
              const below = rule.direction === 'below';
              const triggered =
                typeof actual === 'number' &&
                typeof rule.threshold === 'number' &&
                (below ? actual <= rule.threshold : actual >= rule.threshold);
              return {
                name,
                rule: rule.label || name,
                actual: actual ?? 0,
                threshold: rule.threshold,
                severity: rule.severity || 'info',
                triggered,
                unit: rule.unit || '',
              };
            });
        }
      } catch {
        /* best-effort */
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ alerts }));
      return;
    }

    if (url.pathname === '/api/health/global') {
      res.writeHead(200, headers);
      res.end(JSON.stringify(getGlobalHealth()));
      return;
    }

    if (url.pathname === '/api/safety') {
      const safetyAuditDir = join(ROOT, '.session', 'safety', 'audit');
      const guardrailLogs = existsSync(safetyAuditDir)
        ? readdirSync(safetyAuditDir).filter((f) => f.startsWith('guardrail-'))
        : [];
      const scorerLogs = existsSync(safetyAuditDir)
        ? readdirSync(safetyAuditDir).filter((f) => f.startsWith('scorer-'))
        : [];
      const injectionLogs = existsSync(safetyAuditDir)
        ? readdirSync(safetyAuditDir).filter((f) => f.startsWith('injection-'))
        : [];

      let totalBlocked = 0;
      let totalAllowed = 0;
      for (const log of guardrailLogs.slice(-20)) {
        try {
          const data = JSON.parse(readFileSync(join(safetyAuditDir, log), 'utf-8'));
          if (data.allowed === false) totalBlocked++;
          else totalAllowed++;
        } catch {
          /* ignore parse errors */
        }
      }

      let lastScored: any = null;
      if (scorerLogs.length > 0) {
        try {
          lastScored = JSON.parse(
            readFileSync(join(safetyAuditDir, scorerLogs[scorerLogs.length - 1]), 'utf-8'),
          );
        } catch {
          /* ignore parse errors */
        }
      }

      const safetyConfigPath = join(ROOT, 'config', 'safety-layer.json');
      const config = existsSync(safetyConfigPath)
        ? JSON.parse(readFileSync(safetyConfigPath, 'utf-8'))
        : null;

      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'safety',
          data: {
            enabled: config?.global?.enabled ?? false,
            guardrailChecks: guardrailLogs.length,
            scorerEvals: scorerLogs.length,
            injectionScans: injectionLogs.length,
            mutationsBlocked: totalBlocked,
            mutationsAllowed: totalAllowed,
            lastRiskScore: lastScored?.score ?? null,
            lastRiskLevel: lastScored?.riskLevel ?? null,
            constitutionalRules: config?.guardrails?.constitutional?.length ?? 0,
            blockedPatterns: config?.guardrails?.blockedPatterns?.length ?? 0,
            injectionPatterns: config?.injectionProtection?.knownPatterns?.length ?? 0,
          },
        }),
      );
      return;
    }

    if (url.pathname === '/api/federation') {
      const fedRegistryPath = join(ROOT, '.session', 'federation', 'org-registry.json');
      const fedConfigPath = join(ROOT, 'config', 'federation-config.json');
      const fedConfig = existsSync(fedConfigPath)
        ? JSON.parse(readFileSync(fedConfigPath, 'utf-8'))
        : null;
      const registry = existsSync(fedRegistryPath)
        ? JSON.parse(readFileSync(fedRegistryPath, 'utf-8'))
        : null;

      const knownOrgs = registry?.knownOrgs ?? [];
      const trustedOrgs = knownOrgs.filter((o: any) => o.trusted === true);
      const handshakePending = knownOrgs.filter(
        (o: any) => o.lastHandshake === null || o.lastHandshake === undefined,
      );

      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'federation',
          data: {
            localOrg: fedConfig?.localOrg?.id ?? 'unknown',
            displayName: fedConfig?.localOrg?.displayName ?? '',
            knownOrgCount: knownOrgs.length,
            trustedOrgCount: trustedOrgs.length,
            handshakePendingCount: handshakePending.length,
            requireSignedManifests: fedConfig?.auth?.requireSignedManifests ?? true,
            tokenExpiryMinutes: fedConfig?.auth?.tokenExpiryMinutes ?? 60,
            defaultMeshPort: fedConfig?.localOrg?.defaultMeshPort ?? 9091,
            orgs: knownOrgs.map((o: any) => ({
              id: o.id,
              trusted: o.trusted ?? false,
              lastHandshake: o.lastHandshake ?? 'never',
              approvedCapabilities: o.approvedCapabilities ?? [],
            })),
          },
        }),
      );
      return;
    }

    if (url.pathname === '/api/mesh') {
      meshHandler(req, res, headers);
      return;
    }

    if (url.pathname === '/api/mesh/discover' && req.method === 'POST') {
      meshDiscoverHandler(req, res, headers);
      return;
    }

    if (url.pathname === '/api/mesh/sync' && req.method === 'POST') {
      meshSyncHandler(req, res, headers);
      return;
    }

    if (url.pathname === '/api/cloud/metrics') {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'cloud', data: getCloudMetrics() }));
      return;
    }

    // ─── Stack Tables API (Wave 37: SQLite-backed) ─────────────────────
    if (url.pathname === '/api/skill-usage') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'skill-usage',
          data: getSkillUsageFromDb(limit, deploymentTenant.tenantId),
        }),
      );
      return;
    }

    if (url.pathname === '/api/token-usage') {
      const sessionId = url.searchParams.get('sessionId') || undefined;
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'token-usage',
          data: getTokenUsageFromDb(sessionId, deploymentTenant.tenantId),
        }),
      );
      return;
    }

    if (url.pathname === '/api/contract-results') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'contract-results', data: getContractResultsFromDb(limit) }));
      return;
    }

    if (url.pathname === '/api/routing-rules') {
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          type: 'routing-rules',
          data: getRoutingRulesFromDb(deploymentTenant.tenantId),
        }),
      );
      return;
    }

    if (url.pathname === '/api/agent/tools') {
      const bridge = getBridge();
      res.writeHead(200, headers);
      res.end(JSON.stringify({ tools: bridge.tools, connected: bridge.connected }));
      return;
    }

    if (url.pathname === '/api/agent/sessions') {
      // Live in-memory agent sessions first…
      const list: Array<{
        id: string;
        agent: string;
        status: string;
        messageCount: number;
        updatedAt: string;
        startedAt?: string;
        totalTokens?: number;
        cost?: number;
      }> = Array.from(sessions.values()).map((s) => ({
        id: s.id,
        agent: s.agent,
        status: s.status,
        messageCount: s.messages?.length ?? 0,
        updatedAt: s.updatedAt,
      }));
      // …then real historical sessions from Nexus (source of truth).
      try {
        const db = DatabaseManager.getInstance();
        const rows = db
          .getDb()
          .prepare(
            'SELECT id, tenant_id, agent, status, created_at, updated_at, tokens_used, cost, message_count FROM sessions WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 50',
          )
          .all(DEFAULT_TENANT_ID) as Array<{
          id: string;
          agent: string | null;
          status: string | null;
          created_at: string;
          updated_at: string;
          tokens_used: number;
          cost: number;
          message_count: number;
        }>;
        const known = new Set(list.map((s) => s.id));
        for (const r of rows) {
          if (known.has(r.id)) continue;
          list.push({
            id: r.id,
            agent: r.agent || 'orchestrator',
            status: r.status === 'active' ? 'active' : 'idle',
            messageCount: r.message_count ?? 0,
            updatedAt: r.updated_at || r.created_at,
            startedAt: r.created_at,
            totalTokens: r.tokens_used ?? 0,
            cost: r.cost ?? 0,
          });
        }
      } catch {
        /* Nexus unavailable — live sessions only */
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ sessions: list }));
      return;
    }

    if (url.pathname === '/api/state/events') {
      res.writeHead(200, headers);
      try {
        const historyPath = join(ROOT, '.event-bus', 'history.json');
        if (existsSync(historyPath)) {
          const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
          res.end(JSON.stringify({ events: history.events || [] }));
        } else {
          res.end(JSON.stringify({ events: [] }));
        }
      } catch {
        res.end(JSON.stringify({ events: [] }));
      }
      return;
    }

    if (url.pathname === '/api/state/events/persisted') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      res.writeHead(200, headers);
      try {
        const events = await getStateBridge().getPersistedEvents(limit);
        res.end(JSON.stringify({ events, source: 'nexus' }));
      } catch {
        res.end(JSON.stringify({ events: [], source: 'nexus' }));
      }
      return;
    }

    if (url.pathname === '/api/state/tasks') {
      res.writeHead(200, headers);
      const bridge = getStateBridge();
      res.end(JSON.stringify({ tasks: bridge.tasks }));
      return;
    }

    if (url.pathname === '/api/state/emit' && req.method === 'POST') {
      try {
        const { event, payload } = await readJsonBody<{
          event?: string;
          payload?: Record<string, unknown>;
        }>(req);
        if (event) {
          getStateBridge().emitEvent(event, payload || {});
          res.writeHead(200, headers);
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'event field required' }));
        }
      } catch (e) {
        res.writeHead(e instanceof RequestBodyTooLargeError ? 413 : 400, headers);
        res.end(
          JSON.stringify({
            error:
              e instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON',
          }),
        );
      }
      return;
    }

    if (url.pathname.startsWith('/api/agent/session/')) {
      const sessionId = url.pathname.split('/').pop();
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ session }));
      return;
    }

    // --- Marketplace Routes ---

    if (url.pathname === '/api/marketplace' && req.method === 'GET') {
      const listings = getListings();
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: listings, total: listings.length }));
      return;
    }

    if (url.pathname === '/api/marketplace/validation' && req.method === 'GET') {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: getCatalogValidationReport() }));
      return;
    }

    if (url.pathname === '/api/marketplace/migrations' && req.method === 'POST') {
      try {
        const payload = await readJsonBody<{ limit?: number }>(req);
        const result = createAllMigrationDrafts(Number(payload.limit || 250));
        res.writeHead(201, headers);
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (err) {
        res.writeHead(err instanceof RequestBodyTooLargeError ? 413 : 400, headers);
        res.end(
          JSON.stringify({
            success: false,
            error:
              err instanceof RequestBodyTooLargeError
                ? 'Request body too large'
                : err instanceof Error
                  ? err.message
                  : 'Migration failed',
          }),
        );
      }
      return;
    }

    // Native migration engine: apply (not just draft) canonical structure to
    // every invalid catalog entry — bulk variant.
    if (url.pathname === '/api/marketplace/migrations/apply' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          void applyAllMigrations(Number(payload.limit || 250))
            .then((result) => {
              res.writeHead(200, headers);
              res.end(JSON.stringify({ success: true, data: result }));
            })
            .catch((err: unknown) => {
              res.writeHead(400, headers);
              res.end(
                JSON.stringify({
                  success: false,
                  error: err instanceof Error ? err.message : 'Apply migrations failed',
                }),
              );
            });
        } catch (err) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : 'Apply migrations failed',
            }),
          );
        }
      });
      return;
    }

    if (url.pathname === '/api/content-operations' && req.method === 'GET') {
      const jobs = loadManifest(ROOT);
      const registry = loadPlatformRegistry(ROOT);
      const validation = jobs.map((job) => ({
        id: job.id,
        errors: validateContentJob(job, registry),
      }));
      const byStatus = jobs.reduce<Record<string, number>>((counts, job) => {
        counts[job.status] = (counts[job.status] || 0) + 1;
        return counts;
      }, {});
      const byPlatform = jobs.reduce<Record<string, number>>((counts, job) => {
        counts[job.platform] = (counts[job.platform] || 0) + 1;
        return counts;
      }, {});
      const byDate = jobs.reduce<Record<string, number>>((counts, job) => {
        counts[job.date] = (counts[job.date] || 0) + 1;
        return counts;
      }, {});
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({ success: true, data: { jobs, byStatus, byPlatform, byDate, validation } }),
      );
      return;
    }

    if (url.pathname === '/api/content-operations' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body) as {
            id?: string;
            action?: 'transition' | 'package';
            to?: Status;
          };
          const jobs = loadManifest(ROOT);
          const index = jobs.findIndex((job) => job.id === payload.id);
          if (index < 0) throw new Error('Content job not found');
          const job = jobs[index];
          const registry = loadPlatformRegistry(ROOT);
          const errors = validateContentJob(job, registry);
          if (payload.action === 'transition') {
            if (!payload.to) throw new Error('Target status is required');
            const updated = transition(job, payload.to);
            jobs[index] = updated;
            saveManifest(ROOT, jobs);
            res.writeHead(200, headers);
            res.end(JSON.stringify({ success: true, data: updated }));
            return;
          }
          if (payload.action === 'package') {
            if (errors.length) throw new Error(`Validation failed: ${errors.join('; ')}`);
            const output = packageJob(ROOT, job);
            res.writeHead(200, headers);
            res.end(
              JSON.stringify({ success: true, data: { id: job.id, output, status: 'REVIEW' } }),
            );
            return;
          }
          throw new Error('Unsupported content operation');
        } catch (err) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : 'Invalid content operation',
            }),
          );
        }
      });
      return;
    }

    const contentJobMatch = url.pathname.match(/^\/api\/content-operations\/([A-Za-z0-9._-]+)$/);
    if (contentJobMatch && req.method === 'GET') {
      const jobId = contentJobMatch[1];
      const job = loadManifest(ROOT).find((item) => item.id === jobId);
      if (!job) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ success: false, error: 'Content job not found' }));
        return;
      }
      const packagePath = join(
        ROOT,
        '.runtime',
        'content-operations',
        job.date,
        job.platform,
        job.id,
      );
      const captionPath = join(packagePath, 'caption.txt');
      const publicationPath = join(packagePath, 'publication.json');
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          success: true,
          data: {
            job,
            validation: validateContentJob(job, loadPlatformRegistry(ROOT)),
            packaged: existsSync(publicationPath),
            output: existsSync(publicationPath) ? packagePath : null,
            caption: existsSync(captionPath) ? readFileSync(captionPath, 'utf8') : null,
            publication: existsSync(publicationPath)
              ? JSON.parse(readFileSync(publicationPath, 'utf8'))
              : null,
          },
        }),
      );
      return;
    }

    if (url.pathname === '/api/marketplace' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const missingFields: string[] = [];
          if (!payload.name) missingFields.push('name');
          if (!payload.description) missingFields.push('description');
          if (!payload.author) missingFields.push('author');
          if (!payload.skillContent) missingFields.push('skillContent');

          if (missingFields.length > 0) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`,
              }),
            );
            return;
          }

          const validation = validateSkillStructure(payload.skillContent);
          if (!validation.valid) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: 'Skill structure validation failed',
                details: validation.errors,
              }),
            );
            return;
          }

          const listing = createListing({
            name: payload.name,
            description: payload.description,
            author: payload.author,
            version: payload.version,
            tags: payload.tags,
            triggers: payload.triggers,
            agentType: payload.agentType,
            skillContent: payload.skillContent,
          });
          res.writeHead(201, headers);
          res.end(
            JSON.stringify({
              success: true,
              data: listing,
              message: `Skill '${payload.name}' created successfully`,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create listing';
          const status = message.includes('already exists') ? 409 : 500;
          res.writeHead(status, headers);
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/marketplace/validate/structure' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const { skillContent } = JSON.parse(body);
          if (!skillContent) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({ success: false, error: 'Missing required field: skillContent' }),
            );
            return;
          }
          const result = validateSkillStructure(skillContent);
          res.writeHead(200, headers);
          res.end(JSON.stringify({ success: true, data: result }));
        } catch {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Match /api/marketplace/:id/review, /download, /install, /uninstall, /versions and /rollback
    const marketplaceMatch = url.pathname.match(
      /^\/api\/marketplace\/([^/]+)(?:\/(review|download|install|uninstall|versions|rollback|moderate|migrate|apply-migration))?$/,
    );
    if (marketplaceMatch) {
      const listingId = marketplaceMatch[1];
      const action = marketplaceMatch[2];

      if (action === 'versions' && req.method === 'GET') {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: getListingVersions(listingId) }));
        return;
      }

      if (action === 'versions' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            const version = createListingVersion(listingId, payload.version, payload.content);
            res.writeHead(201, headers);
            res.end(JSON.stringify({ success: true, data: version }));
          } catch (err) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : 'Invalid version',
              }),
            );
          }
        });
        return;
      }

      if (action === 'rollback' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            const version = rollbackListing(listingId, payload.version);
            if (!version) {
              res.writeHead(404, headers);
              res.end(JSON.stringify({ success: false, error: 'Version not found' }));
              return;
            }
            res.writeHead(200, headers);
            res.end(JSON.stringify({ success: true, data: version }));
          } catch (err) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : 'Invalid rollback',
              }),
            );
          }
        });
        return;
      }

      if (action === 'moderate' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            if (payload.status !== 'approved' && payload.status !== 'rejected')
              throw new Error('status must be approved or rejected');
            const listing = updateListingReviewStatus(listingId, payload.status);
            if (!listing) throw new Error('Listing not found or validation failed');
            res.writeHead(200, headers);
            res.end(JSON.stringify({ success: true, data: listing }));
          } catch (err) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : 'Invalid moderation',
              }),
            );
          }
        });
        return;
      }

      if (action === 'migrate' && req.method === 'POST') {
        const draft = createMigrationDraft(listingId);
        if (!draft) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Listing content not found' }));
          return;
        }
        res.writeHead(201, headers);
        res.end(JSON.stringify({ success: true, data: draft }));
        return;
      }

      // Native migration: apply canonical structure directly to SKILL.md.
      if (action === 'apply-migration' && req.method === 'POST') {
        const result = applyMigration(listingId);
        if (!result) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Listing content not found' }));
          return;
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: result }));
        return;
      }

      if (!action && req.method === 'GET') {
        const listing = getListing(listingId);
        if (!listing) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Listing not found' }));
          return;
        }
        const content = listing.skillPath ? getSkillContent(listing.skillPath) : null;
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: { ...listing, content } }));
        return;
      }

      if (action === 'review' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const { user, rating, comment } = JSON.parse(body);
            if (!user || rating === null || !comment) {
              res.writeHead(400, headers);
              res.end(
                JSON.stringify({
                  success: false,
                  error: 'Missing required fields: user, rating, comment',
                }),
              );
              return;
            }
            if (typeof rating !== 'number' || rating < 1 || rating > 5) {
              res.writeHead(400, headers);
              res.end(
                JSON.stringify({
                  success: false,
                  error: 'Rating must be a number between 1 and 5',
                }),
              );
              return;
            }
            const review = addReview(listingId, { user, rating, comment });
            res.writeHead(201, headers);
            res.end(JSON.stringify({ success: true, data: review }));
          } catch {
            res.writeHead(400, headers);
            res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (action === 'download' && req.method === 'POST') {
        const downloads = incrementDownloads(listingId);
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: { id: listingId, downloads } }));
        return;
      }

      if (action === 'install' && req.method === 'POST') {
        const installation = installListing(listingId);
        if (!installation) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Listing is not installable' }));
          return;
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: installation }));
        return;
      }

      if (action === 'uninstall' && req.method === 'POST') {
        const removed = uninstallListing(listingId);
        if (!removed) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({ success: false, error: 'Listing is not installed' }));
          return;
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: { id: listingId, installed: false } }));
        return;
      }

      res.writeHead(404, headers);
      res.end(JSON.stringify({ success: false, error: 'Route not found' }));
      return;
    }

    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[WS-ERROR] handleRequest failed:', msg);
    try {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    } catch {
      /* ignore write errors after crash */
    }
  } finally {
    const elapsedMs = Date.now() - requestStartedAt;
    dashboardTelemetry.httpLatencyTotalMs += elapsedMs;
    dashboardTelemetry.httpLatencyMaxMs = Math.max(dashboardTelemetry.httpLatencyMaxMs, elapsedMs);
    dashboardTelemetry.httpStatusCounts.set(
      res.statusCode,
      (dashboardTelemetry.httpStatusCounts.get(res.statusCode) || 0) + 1,
    );
    if (res.statusCode >= 500) dashboardTelemetry.httpErrors++;
  }
}

// --- WebSocket ---

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  if (!dashboardAuth.authenticate(req)) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  wsTenants.set(ws, deploymentTenant);
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const current = connPerIp.get(ip) || 0;
  if (current >= MAX_CONN_PER_IP) {
    console.log(`[WS] Blocked excessive connection from ${ip} (${current})`);
    ws.close(1013, 'Too many connections');
    return;
  }
  connPerIp.set(ip, current + 1);
  dashboardTelemetry.wsConnectionsTotal++;
  dashboardTelemetry.wsConnectionsPeak = Math.max(
    dashboardTelemetry.wsConnectionsPeak,
    clients.size + 1,
  );
  console.log(`[WS] Client connected (${ip}, conns: ${current + 1})`);
  clients.add(ws);
  sendJson(ws, { type: 'metrics', data: generateMetrics(wsTenants.get(ws)?.tenantId) });
  sendJson(ws, { type: 'bridge_status', connected: bridgeReady });

  // Send current state to newly connected client
  const stateBridge = getStateBridge();
  sendJson(ws, { type: 'state_tasks', tasks: stateBridge.tasks });
  try {
    const historyPath = join(ROOT, '.event-bus', 'history.json');
    if (existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      sendJson(ws, { type: 'state_history', events: (history.events || []).slice(0, 20) });
    }
  } catch (e) {
    console.warn('[WS] Failed to send state history to new client:', (e as Error).message);
  }

  ws.on('message', (raw: Buffer | string) => {
    if (Buffer.byteLength(raw.toString(), 'utf8') > MAX_WS_MESSAGE_BYTES) {
      ws.close(1009, 'Message too large');
      return;
    }
    try {
      const parsed = JSON.parse(raw.toString());

      if (parsed.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      if (parsed.type === 'agent') {
        void handleAgentCommand(ws, parsed);
        return;
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    const prev = connPerIp.get(ip) || 1;
    if (prev <= 1) connPerIp.delete(ip);
    else connPerIp.set(ip, prev - 1);
    for (const [, subs] of agentSubscriptions) {
      subs.delete(ws);
    }
  });
});

let prevMetrics: Record<string, unknown> | null = null;
const prevAlertState = new Map<string, boolean>();

function broadcastValidations(): void {
  try {
    const validations = runValidations(bridgeReady, bridgeToolCount, clients.size);
    const msg = JSON.stringify({ type: 'validations', data: validations });
    clients.forEach((c) => {
      try {
        safeSend(c, msg);
      } catch {
        /* ignore send errors */
      }
    });
  } catch (err) {
    console.error(
      '[WS-VALIDATIONS] broadcast error:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function evaluateAlerts(metrics: any): Array<{
  name: string;
  rule: string;
  actual: number;
  threshold: number;
  severity: string;
  triggered: boolean;
  unit: string;
  direction: 'above' | 'below';
  transition?: string;
}> {
  try {
    if (!existsSync(ALERTS_CONFIG_PATH)) return [];
    const config = JSON.parse(readFileSync(ALERTS_CONFIG_PATH, 'utf-8'));
    return Object.entries(config.rules || {})
      .map(([name, rule]: [string, any]) => {
        if (rule.enabled === false) return null;
        const actual = rule.metric
          .split('.')
          .reduce((obj: any, key: string) => obj?.[key], metrics as any);
        const below = rule.direction === 'below';
        const triggered =
          typeof actual === 'number' &&
          typeof rule.threshold === 'number' &&
          (below ? actual <= rule.threshold : actual >= rule.threshold);
        const wasTriggered = prevAlertState.get(name) || false;
        let transition: string | undefined;
        if (triggered && !wasTriggered) transition = 'fired';
        else if (!triggered && wasTriggered) transition = 'resolved';
        return {
          name,
          rule: rule.label || name,
          actual: actual ?? 0,
          threshold: rule.threshold,
          severity: rule.severity || 'info',
          triggered,
          unit: rule.unit || '',
          direction: below ? 'below' : 'above',
          transition,
        };
      })
      .filter(Boolean) as any[];
  } catch {
    return [];
  }
}

// Telemetry → Nexus bridge now owned by the unified OTel pipeline
// (otelPipeline.start() below in start(): initial ingest + 60s cycle).

setInterval(() => {
  const metrics = generateMetrics();

  // Agregar métricas operacionales si existen datos
  try {
    const operationalMetrics = OperationalMetricsTracker.calculateMetrics();
    if (operationalMetrics && operationalMetrics.totalOperations > 0) {
      (metrics as any).operational = operationalMetrics;
    }
  } catch {
    // Silencioso si no hay métricas operacionales aún
  }

  const msg = JSON.stringify({ type: 'metrics', data: metrics });
  clients.forEach((c) => safeSend(c, msg));
  broadcastValidations();

  // Broadcast alert state with transitions
  const alerts = evaluateAlerts(metrics);
  const transitions = alerts.filter((a) => a.transition);
  alerts.forEach((a) => prevAlertState.set(a.name, a.triggered));
  const alertMsg = JSON.stringify({ type: 'alerts', data: alerts });
  clients.forEach((c) => safeSend(c, alertMsg));

  // Persist alert transitions to Nexus (audit trail for the Alerts panel).
  if (transitions.length > 0) {
    try {
      const db = DatabaseManager.getInstance();
      for (const a of transitions) {
        db.events.insertAlert(deploymentTenant.tenantId ?? 'gentle-vanguard', {
          name: a.name,
          rule: a.rule,
          severity: a.severity,
          triggered: a.triggered ? 1 : 0,
          actual: a.actual,
          threshold: a.threshold,
          transition: a.transition ?? undefined,
        });
      }
    } catch {
      /* DB unavailable — broadcast already sent */
    }
  }

  // Broadcast alert transitions as notifications
  if (transitions.length > 0) {
    const transitionNotifications = transitions.map((a) => ({
      type: a.transition === 'fired' ? 'alert_fired' : 'alert_resolved',
      message:
        a.transition === 'fired'
          ? `Alert: ${a.rule} triggered (${a.actual}${a.unit} ${a.direction === 'below' ? '<=' : '>='} ${a.threshold}${a.unit})`
          : `Resolved: ${a.rule} (${a.actual}${a.unit})`,
      severity: a.transition === 'fired' ? a.severity : 'info',
      timestamp: new Date().toISOString(),
    }));
    const note = JSON.stringify({ type: 'notification', notifications: transitionNotifications });
    clients.forEach((c) => safeSend(c, note));
  }

  if (prevMetrics) {
    const prev = prevMetrics as Record<string, any>;
    const curr = metrics as Record<string, any>;
    const currTokens = curr?.tokens?.used || 0;
    const prevTokens = prev?.tokens?.used || 0;
    const currSessions = curr?.sessions?.total || 0;
    const prevSessions = prev?.sessions?.total || 0;
    const currActive = curr?.sessions?.active || 0;
    const prevActive = prev?.sessions?.active || 0;
    const currEvents = curr?.events?.length || 0;
    const prevEvents = prev?.events?.length || 0;

    const notifications: Array<{
      type: string;
      message: string;
      severity: string;
      timestamp: string;
    }> = [];

    if (currTokens > prevTokens) {
      const delta = currTokens - prevTokens;
      notifications.push({
        type: 'token_usage',
        message: `+${delta} tokens (${(currTokens / 1000).toFixed(1)}K total)`,
        severity: 'info',
        timestamp: curr.timestamp,
      });
    }
    if (currSessions > prevSessions) {
      notifications.push({
        type: 'session_created',
        message: `Nueva sesión creada (${currSessions} total)`,
        severity: 'info',
        timestamp: curr.timestamp,
      });
    }
    if (currActive !== prevActive) {
      notifications.push({
        type: 'session_status',
        message: `Sesiones activas: ${prevActive} → ${currActive}`,
        severity: currActive > prevActive ? 'info' : 'warning',
        timestamp: curr.timestamp,
      });
    }
    if (currEvents > prevEvents) {
      const delta = currEvents - prevEvents;
      notifications.push({
        type: 'new_events',
        message: `${delta} nuevo(s) evento(s) en timeline`,
        severity: 'info',
        timestamp: curr.timestamp,
      });
    }

    if (notifications.length > 0) {
      const note = JSON.stringify({ type: 'notification', notifications });
      clients.forEach((c) => safeSend(c, note));
    }
  }

  prevMetrics = metrics;
}, 5000);

// --- Database-Backed Metrics Writer (replaces JSON consolidation) ---
// MetricsWriter handles:
//   1. Collecting real metrics from git, sessions, tokens, MCP, system
//   2. Writing metric_snapshots to SQLite every 30s
//   3. Writing consolidated.json for backward compatibility
//   4. Housekeeping (pruning old data, VACUUM)
//
// The first writeSnapshot() happens immediately on start(),
// then every 30s automatically.

// File watcher en .runtime/metrics/ — broadcast inmediato ante cambios reales
const METRICS_WATCH_DIR = join(ROOT, '.runtime', 'metrics');
if (existsSync(METRICS_WATCH_DIR)) {
  try {
    let watchTimer: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 200;
    watch(METRICS_WATCH_DIR, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        const metrics = generateMetrics();
        const msg = JSON.stringify({ type: 'metrics', data: metrics });
        clients.forEach((c) => safeSend(c, msg));
        console.log(`[WATCH] metrics file changed: ${filename} → broadcast`);
      }, DEBOUNCE_MS);
    });
    console.log('[WATCH] .runtime/metrics/ watcher started');
  } catch (err) {
    console.warn('[WATCH] Could not start metrics watcher:', (err as Error).message);
  }
}

// --- Start ---

async function start() {
  loadSessions();
  // Start the unified OTel pipeline (spans ingest + metrics writer snapshots)
  otelPipeline.start();
  metricsWriterStarted = true;
  try {
    const mcpBridge = getBridge();
    await mcpBridge.start();
    bridgeReady = true;
    bridgeToolCount = mcpBridge.tools.length;
    console.log(`[MCP] Bridge connected — ${bridgeToolCount} tools available`);
  } catch {
    console.warn('[MCP] Bridge not available (MCP server not running)');
    bridgeReady = false;
    bridgeToolCount = 0;
  }
}

function initSharedState(): void {
  const stateBridge = getStateBridge();
  stateBridge.on('history_update', (events: unknown) => {
    const msg = JSON.stringify({ type: 'state_history', events });
    clients.forEach((c) => safeSend(c, msg));
  });
  stateBridge.on('task_update', (tasks: unknown) => {
    const msg = JSON.stringify({ type: 'state_tasks', tasks });
    clients.forEach((c) => safeSend(c, msg));
  });
  stateBridge.on('event', (evt: unknown) => {
    const msg = JSON.stringify({ type: 'state_event', event: evt });
    clients.forEach((c) => safeSend(c, msg));
  });
  stateBridge.on('state_delta', (delta: unknown) => {
    const msg = JSON.stringify({ type: 'state_delta', ...(delta as object) });
    clients.forEach((c) => safeSend(c, msg));
  });
  stateBridge.on('task_delta', (delta: unknown) => {
    const msg = JSON.stringify({ type: 'task_delta', ...(delta as object) });
    clients.forEach((c) => safeSend(c, msg));
  });
  stateBridge.start();
  console.log('[STATE] Shared State Bridge started');
}

function startTraceWatcher(): void {
  const ctxDir = join(ROOT, '.session', 'context-log');
  if (!existsSync(ctxDir)) {
    mkdirSync(ctxDir, { recursive: true });
  }
  try {
    watch(ctxDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.state.json')) return;
      const statePath = join(ctxDir, filename);
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        const msg = JSON.stringify({
          type: 'trace_update',
          session: { id: state.sessionId || filename.split(/[\\/]/)[0], state },
        });
        clients.forEach((c) => safeSend(c, msg));
      } catch (e) {
        console.warn('[TRACE] Error parsing state file:', filename, (e as Error).message);
      }
    });
    console.log('[TRACE] Context-log watcher started');
  } catch (err) {
    console.warn('[TRACE] File watcher not available:', (err as Error).message);
  }
}

server.listen(PORT, () => {
  console.log(`[WS] Server on port ${PORT}`);
  void start();
  initSharedState();
  startTraceWatcher();
});

// --- Graceful Shutdown ---

function shutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal}, closing gracefully...`);
  if (metricsWriterStarted) otelPipeline.stop();
  const bridge = getBridge();
  bridge.stop().catch(() => {});
  getStateBridge().stop();
  wss.close(() => {
    console.log('[SHUTDOWN] WebSocket server closed');
  });
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
