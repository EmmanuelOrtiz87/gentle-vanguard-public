/**
 * Dashboard Health Checker — Solución Definitiva
 *
 * PROBLEMA QUE RESUELVE:
 *   El health check anterior (src/core/health-check.ts) solo verificaba
 *   si el puerto TCP estaba abierto con un socket raw. Esto fallaba porque:
 *   - El servidor WebSocket necesita HTTP upgrade handshake
 *   - Un socket TCP simple no hace el handshake WebSocket
 *   - Resultado: false positive (puerto "abierto" pero WS no funciona)
 *
 * SOLUCIÓN:
 *   Este módulo implementa 3 niveles de verificación:
 *
 *   Level 1: HTTP GET /api/health → JSON response expected
 *   Level 2: HTTP GET /api/metrics → JSON response expected  
 *   Level 3: TCP socket (legacy fallback) → open/closed
 *
 *   Si Level 1 o Level 2 pasan, el dashboard está HEALTHY.
 *   Si solo Level 3 pasa, está DEGRADED (corriendo pero no funcional).
 *   Si ninguno pasa, está DOWN.
 *
 * USO:
 *   import { checkDashboardHealth } from './dashboard-health-checker.js';
 *   const result = await checkDashboardHealth();
 *   // result.status: 'healthy' | 'degraded' | 'down'
 */

import * as http from 'http';
import { pathToFileURL } from 'url';
import * as net from 'net';
import { isDashboardHtml } from './dashboard-common.js';

export interface DashboardHealthResult {
  status: 'healthy' | 'degraded' | 'down';
  httpHealthOk: boolean;
  httpMetricsOk: boolean;
  tcpOpen: boolean;
  viteOk: boolean;
  viteApiOk: boolean;
  port: number;
  vitePort: number;
  message: string;
  details?: {
    httpHealthResponse?: { statusCode: number; body?: unknown };
    httpMetricsResponse?: { statusCode: number; body?: unknown };
    tcpError?: string;
  };
}

/**
 * Make HTTP GET request and return JSON response
 */
async function httpGetJson(
  port: number,
  path: string,
  timeout = 3000,
  hostname = '127.0.0.1',
  accept = 'application/json',
): Promise<{ ok: boolean; statusCode: number; body: unknown; error?: string }> {
  return new Promise((resolve) => {
    const options = {
      hostname,
      port,
      path,
      method: 'GET',
      timeout,
      headers: {
        Accept: accept,
      },
    };

    let body = '';
    const req = http.request(options, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({
            ok: res.statusCode === 200,
            statusCode: res.statusCode || 0,
            body: json,
          });
        } catch {
          resolve({
            ok: res.statusCode === 200,
            statusCode: res.statusCode || 0,
            body: body.slice(0, 200), // First 200 chars if not JSON
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, statusCode: 0, body: null, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, body: null, error: 'timeout' });
    });

    req.end();
  });
}

/**
 * Legacy TCP check (socket only)
 */
async function tcpCheck(port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, '127.0.0.1');
  });
}

/**
 * Check if Vite dev server is running (port 5173)
 */
async function checkViteHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/', timeout: 2000, headers: { Accept: 'text/html' } },
      (res) => {
        let html = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (html.length < 16_384) html += chunk;
        });
        res.on('end', () => {
          resolve(res.statusCode === 200 && isDashboardHtml(html));
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Main health check function
 */
export async function checkDashboardHealth(
  wsPort = 8080,
  vitePort = 5173,
): Promise<DashboardHealthResult> {
  // Run all checks in parallel
  const [healthApi, metricsApi, tcpResult, viteOk, viteHealthApi] = await Promise.all([
    httpGetJson(wsPort, '/api/health/live', 5000),
    httpGetJson(wsPort, '/api/metrics', 3000),
    tcpCheck(wsPort, 2000),
    checkViteHealth(vitePort),
    httpGetJson(vitePort, '/api/health/live', 5000),
  ]);

  const httpHealthOk =
    healthApi.ok &&
    typeof healthApi.body === 'object' &&
    healthApi.body !== null &&
    'status' in healthApi.body &&
    healthApi.body.status === 'ok';
  const httpMetricsOk = metricsApi.ok && metricsApi.body !== null;
  const tcpOpen = tcpResult;
  const viteApiOk =
    viteHealthApi.ok &&
    typeof viteHealthApi.body === 'object' &&
    viteHealthApi.body !== null &&
    'status' in viteHealthApi.body &&
    viteHealthApi.body.status === 'ok';

  let status: DashboardHealthResult['status'];
  let message: string;

  if (httpHealthOk || httpMetricsOk) {
    status = 'healthy';
    message = viteOk
      ? `Dashboard fully operational (WS:${wsPort}, Vite:${vitePort})`
      : `Dashboard WS operational (WS:${wsPort}); Vite not responding on ${vitePort}`;
  } else if (tcpOpen) {
    status = 'degraded';
    message = `Dashboard listening on ${wsPort} but HTTP API not responding`;
  } else {
    status = 'down';
    message = `Dashboard not responding on ${wsPort}`;
  }

  return {
    status,
    httpHealthOk,
    httpMetricsOk,
    tcpOpen,
    viteOk,
    viteApiOk,
    port: wsPort,
    vitePort: vitePort,
    message,
    details: {
      httpHealthResponse: {
        statusCode: healthApi.statusCode,
        body: healthApi.body,
      },
      httpMetricsResponse: {
        statusCode: metricsApi.statusCode,
        body: metricsApi.body,
      },
      tcpError: tcpOpen ? undefined : 'TCP connection refused',
    },
  };
}

/**
 * Quick check (boolean only)
 */
export async function isDashboardHealthy(): Promise<boolean> {
  const result = await checkDashboardHealth();
  return result.status === 'healthy';
}

/**
 * Check with automatic retry
 */
export async function checkDashboardHealthWithRetry(
  retries = 2,
  delay = 1000,
): Promise<DashboardHealthResult> {
  for (let i = 0; i <= retries; i++) {
    const result = await checkDashboardHealth();
    if (result.status === 'healthy') {
      return result;
    }
    if (i < retries) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return checkDashboardHealth();
}

// CLI usage
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkDashboardHealth()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === 'down' ? 1 : 0);
    })
    .catch((err) => {
      console.error(
        JSON.stringify(
          {
            status: 'error',
            error: err.message,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    });
}
