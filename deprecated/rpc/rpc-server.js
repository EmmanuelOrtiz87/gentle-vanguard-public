import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { toolDefinitions, executeTool, availableTools } from './rpc-tools.js';

const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  if (idx > -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1], 10);
  return parseInt(process.env.RPC_PORT || '8732', 10);
})();

const TOOL_TIMEOUT = 30000;
let requestCount = 0;
const startTime = Date.now();
const logDir = path.resolve(import.meta.dirname, '..', '..', '.session', 'rpc-logs');

fs.mkdirSync(logDir, { recursive: true });

function writeLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(logDir, 'rpc-server.log'), line + '\n');
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function safeExec(toolName, toolArgs, logFn) {
  const result = await Promise.race([
    executeTool(toolName, toolArgs, logFn),
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Tool execution timed out'), { code: 504 })), TOOL_TIMEOUT)),
  ]);
  return result;
}

function handleError(err) {
  if (err.code === 504) return { error: 'Tool execution timed out', duration: Date.now() - startTime };
  return { error: err.message, duration: Date.now() - startTime };
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  requestCount++;
  const logFn = (...msg) => writeLog(`[${req.method} ${req.url}] ${msg.join(' ')}`);

  try {
    if (req.url === '/health' && req.method === 'GET') {
      return json(res, 200, { status: 'ok', uptime: (Date.now() - startTime) / 1000, tools: availableTools, requestCount });
    }
    if (req.url === '/tools' && req.method === 'GET') {
      return json(res, 200, { tools: toolDefinitions.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) });
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

    let body;
    try { body = await getBody(req); } catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    const reqId = body.id || crypto.randomUUID();
    logFn(`id=${reqId} body=${JSON.stringify(body).slice(0, 200)}`);

    if (req.url === '/rpc/batch') {
      const r = await safeExec('rpc_batch', body, logFn);
      return json(res, 200, { id: reqId, results: r.results, duration: Date.now() - start });
    }
    if (req.url === '/rpc/watch') {
      const r = await safeExec('rpc_watch', body, logFn);
      return json(res, 200, { id: reqId, pollResults: r.pollResults, duration: Date.now() - start });
    }
    if (req.url === '/feedback' && req.method === 'POST') {
      if (!body.rating) return json(res, 400, { id: reqId, error: 'Missing rating', duration: Date.now() - start });
      const { submitFeedback } = await import('../gateway/feedback/feedback-store.js');
      const r = submitFeedback(body);
      return json(res, r.success ? 200 : 400, { id: reqId, result: r, duration: Date.now() - start });
    }
    if (req.url === '/feedback/stats' && req.method === 'GET') {
      const { getFeedbackStats } = await import('../gateway/feedback/feedback-store.js');
      return json(res, 200, { stats: getFeedbackStats() });
    }
    if (req.url === '/rpc') {
      if (!body.tool) return json(res, 400, { id: reqId, error: 'Missing tool name', duration: Date.now() - start });
      const r = await safeExec(body.tool, body.args || {}, logFn);
      return json(res, 200, { id: reqId, result: r, duration: Date.now() - start });
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const e = handleError(err);
    json(res, err.code === 504 ? 504 : 500, { id: null, ...e });
  }
});

server.listen(PORT, () => {
  writeLog(`RPC server started on port ${PORT}, ${availableTools.length} tools available`);
});

process.on('SIGINT', () => { writeLog('Shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { writeLog('Shutting down...'); server.close(() => process.exit(0)); });
