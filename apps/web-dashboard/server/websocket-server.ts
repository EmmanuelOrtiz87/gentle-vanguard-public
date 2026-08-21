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
  validateSkillStructure,
  getSkillContent,
} from './marketplace-api.ts';
import { MetricsWriter } from './database/metrics-writer.ts';
import {
  getRealMetrics,
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
import { ROOT, readJson, countSkills } from './shared.ts';
import { OperationalMetricsTracker } from '@gentle-vanguard/core/operational-metrics-tracker';

const FEEDBACK_PATH = join(ROOT, '.runtime', 'metrics', 'feedback.json');
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
const server = createServer(handleRequest);
server.on('error', (err: Error) => console.error('[WS-ERROR] HTTP server:', err.message));
const wss = new WebSocketServer({ server });
wss.on('error', (err: Error) => console.error('[WS-ERROR] WS server:', err.message));

const clients = new Set<WebSocket>();
const agentSubscriptions = new Map<string, Set<WebSocket>>();
const sessions = new Map<string, AgentSession>();
const connPerIp = new Map<string, number>();
const MAX_CONN_PER_IP = 5;
let bridgeReady = false;
let bridgeToolCount = 0;

interface ActiveSkillExecution {
  active: boolean;
  cancelled: boolean;
  messageId?: string;
  abortController?: AbortController;
}

const activeSkillExecutions = new Map<string, ActiveSkillExecution>();

// ─── Database Persistence Layer ───────────────────────────────────────
const metricsWriter = new MetricsWriter();
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
  const real = tenantId ? getTenantScopedMetrics(tenantId) : getRealMetrics();
  return { ...real, globalHealth: getGlobalHealth() };
}

function readTenantRegistry() {
  const registryPath = join(ROOT, 'config', 'tenant-registry.json');
  try {
    if (!existsSync(registryPath)) return { tenants: [] };
    return JSON.parse(readFileSync(registryPath, 'utf-8'));
  } catch {
    return { tenants: [] };
  }
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
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
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
    ws.send(JSON.stringify({ type: 'agent_session_created', session }));
    return;
  }

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', error: 'sessionId required' }));
    return;
  }

  const session = sessions.get(sessionId as string);
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
    return;
  }

  if (action === 'subscribe') {
    subscribeToAgentSession(ws, sessionId as string);
    ws.send(JSON.stringify({ type: 'subscribed', sessionId }));
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
    ws.send(JSON.stringify({ type: 'agent_sessions', sessions: list }));
    return;
  }

  if (action === 'list_history') {
    ws.send(JSON.stringify({ type: 'agent_history', sessions: Array.from(sessions.values()) }));
    return;
  }

  if (action === 'get_session') {
    ws.send(JSON.stringify({ type: 'agent_session', session }));
    return;
  }

  if (action === 'list_tools') {
    const bridge = getBridge();
    ws.send(
      JSON.stringify({ type: 'agent_tools', tools: bridge.tools, connected: bridge.connected }),
    );
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
    ws.send(JSON.stringify({ type: 'error', error: 'No active skill execution to cancel' }));
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
    ws.send(JSON.stringify({ type: 'error', error: 'MCP bridge not connected' }));
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
    ws.send(
      JSON.stringify({
        type: 'error',
        error: `Failed to ${action}: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
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
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
      res.end();
      return;
    }

    if (url.pathname === '/api/metrics') {
      const tenantIdParam = url.searchParams.get('tenantId');
      const tenantId = typeof tenantIdParam === 'string' ? tenantIdParam : undefined;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'metrics', data: generateMetrics(tenantId) }));
      return;
    }

    // SLO metrics endpoint — GET returns latest, POST stores from perf:slo
    const SLO_PATH = join(ROOT, '.runtime', 'metrics', 'slo-latest.json');
    if (url.pathname === '/api/slo' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          mkdirSync(dirname(SLO_PATH), { recursive: true });
          writeFileSync(
            SLO_PATH,
            JSON.stringify({ ...data, ingested: new Date().toISOString() }, null, 2),
          );
          res.writeHead(200, headers);
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    if (url.pathname === '/api/slo') {
      const sloData = existsSync(SLO_PATH) ? JSON.parse(readFileSync(SLO_PATH, 'utf8')) : null;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'slo', data: sloData }));
      return;
    }

    if (url.pathname === '/api/tenants') {
      res.writeHead(200, headers);
      res.end(JSON.stringify(readTenantRegistry()));
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
          version: '3.3.1',
          uptime: process.uptime(),
          connections: clients.size,
          components: {
            websocket: { status: 'ok', clients: clients.size },
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
          },
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === '/api/traces') {
      res.writeHead(200, headers);
      res.end(JSON.stringify(getTraces()));
      return;
    }

    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const { traceId, spanId, type } = JSON.parse(body);
          if (!traceId || !spanId || !type) {
            res.writeHead(400, headers);
            res.end(JSON.stringify({ error: 'traceId, spanId, type required' }));
            return;
          }
          const dir = dirname(FEEDBACK_PATH);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const existing = readJson<{
            thumbsUp: number;
            thumbsDown: number;
            entries: Record<string, string>;
          }>(FEEDBACK_PATH) || { thumbsUp: 0, thumbsDown: 0, entries: {} };
          existing.entries[spanId] = type;
          if (type === 'up') existing.thumbsUp++;
          else existing.thumbsDown++;
          writeFileSync(FEEDBACK_PATH, JSON.stringify(existing, null, 2));
          res.writeHead(200, headers);
          res.end(
            JSON.stringify({
              ok: true,
              score: (existing.thumbsUp / (existing.thumbsUp + existing.thumbsDown)) * 100,
            }),
          );
        } catch {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/alerts') {
      let alerts: Record<string, unknown>[] = [];
      try {
        if (existsSync(ALERTS_CONFIG_PATH)) {
          const config = JSON.parse(readFileSync(ALERTS_CONFIG_PATH, 'utf-8'));
          const metrics = generateMetrics();
          alerts = Object.entries(config.rules || {}).map(([name, rule]: [string, any]) => {
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
      res.end(JSON.stringify({ type: 'skill-usage', data: getSkillUsageFromDb(limit) }));
      return;
    }

    if (url.pathname === '/api/token-usage') {
      const sessionId = url.searchParams.get('sessionId') || undefined;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ type: 'token-usage', data: getTokenUsageFromDb(sessionId) }));
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
      res.end(JSON.stringify({ type: 'routing-rules', data: getRoutingRulesFromDb() }));
      return;
    }

    if (url.pathname === '/api/agent/tools') {
      const bridge = getBridge();
      res.writeHead(200, headers);
      res.end(JSON.stringify({ tools: bridge.tools, connected: bridge.connected }));
      return;
    }

    if (url.pathname === '/api/agent/sessions') {
      const list = Array.from(sessions.values()).map((s) => ({
        id: s.id,
        agent: s.agent,
        status: s.status,
        messageCount: s.messages?.length ?? 0,
        updatedAt: s.updatedAt,
      }));
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
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const { event, payload } = JSON.parse(body);
          if (event) {
            getStateBridge().emitEvent(event, payload || {});
            res.writeHead(200, headers);
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(400, headers);
            res.end(JSON.stringify({ error: 'event field required' }));
          }
        } catch {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
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

    // Match /api/marketplace/:id/review and /api/marketplace/:id/download
    const marketplaceMatch = url.pathname.match(
      /^\/api\/marketplace\/([^/]+)(?:\/(review|download))?$/,
    );
    if (marketplaceMatch) {
      const listingId = marketplaceMatch[1];
      const action = marketplaceMatch[2];

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
  }
}

// --- WebSocket ---

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
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
  console.log(`[WS] Client connected (${ip}, conns: ${current + 1})`);
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'metrics', data: generateMetrics() }));
  ws.send(JSON.stringify({ type: 'bridge_status', connected: bridgeReady }));

  // Send current state to newly connected client
  const stateBridge = getStateBridge();
  ws.send(JSON.stringify({ type: 'state_tasks', tasks: stateBridge.tasks }));
  try {
    const historyPath = join(ROOT, '.event-bus', 'history.json');
    if (existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      ws.send(
        JSON.stringify({ type: 'state_history', events: (history.events || []).slice(0, 20) }),
      );
    }
  } catch (e) {
    console.warn('[WS] Failed to send state history to new client:', (e as Error).message);
  }

  ws.on('message', (raw: Buffer | string) => {
    try {
      const parsed = JSON.parse(raw.toString());

      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
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
        if (c.readyState === WebSocket.OPEN) c.send(msg);
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
          transition,
        };
      })
      .filter(Boolean) as any[];
  } catch {
    return [];
  }
}

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
  clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
  broadcastValidations();

  // Broadcast alert state with transitions
  const alerts = evaluateAlerts(metrics);
  const transitions = alerts.filter((a) => a.transition);
  alerts.forEach((a) => prevAlertState.set(a.name, a.triggered));
  const alertMsg = JSON.stringify({ type: 'alerts', data: alerts });
  clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(alertMsg));

  // Broadcast alert transitions as notifications
  if (transitions.length > 0) {
    const transitionNotifications = transitions.map((a) => ({
      type: a.transition === 'fired' ? 'alert_fired' : 'alert_resolved',
      message:
        a.transition === 'fired'
          ? `Alert: ${a.rule} triggered (${a.actual}${a.unit} > ${a.threshold}${a.unit})`
          : `Resolved: ${a.rule} (${a.actual}${a.unit})`,
      severity: a.transition === 'fired' ? a.severity : 'info',
      timestamp: new Date().toISOString(),
    }));
    const note = JSON.stringify({ type: 'notification', notifications: transitionNotifications });
    clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(note));
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
      clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(note));
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
        clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
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
  // Start the database-backed metrics writer (snapshots + consolidated.json)
  metricsWriter.start(30000);
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
    clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
  });
  stateBridge.on('task_update', (tasks: unknown) => {
    const msg = JSON.stringify({ type: 'state_tasks', tasks });
    clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
  });
  stateBridge.on('event', (evt: unknown) => {
    const msg = JSON.stringify({ type: 'state_event', event: evt });
    clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
  });
  stateBridge.on('state_delta', (delta: unknown) => {
    const msg = JSON.stringify({ type: 'state_delta', ...(delta as object) });
    clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
  });
  stateBridge.on('task_delta', (delta: unknown) => {
    const msg = JSON.stringify({ type: 'task_delta', ...(delta as object) });
    clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
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
        clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
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
  if (metricsWriterStarted) metricsWriter.stop();
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
