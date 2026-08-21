#!/usr/bin/env node
/**
 * Dashboard CMD Launcher - 100% CMD Native, Zero PowerShell Dependency
 *
 * SOLUCIONA EL ROOT CAUSE:
 * - Probema: ChildProcess.kill falla con PowerShell
 * - Solución: CMD nativo exclusivo, spawn directo sin shell intermedio
 * - Arquitectura: Single-shot launcher, no watchers, no doble ejecución
 *
 * USO: npx tsx src/dashboard-cmd-launcher.ts [--port 8080]
 */

import { spawn, execFile } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import * as http from 'http';

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const WS_SCRIPT = join(ROOT, 'apps', 'web-dashboard', 'server', 'websocket-server.ts');
const PID_FILE = join(RUNTIME_DIR, 'dashboard-ws.pid');
const LOG_FILE = join(RUNTIME_DIR, 'dashboard-cmd.log');

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.log(line.trim());
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf-8') : '';
    writeFileSync(LOG_FILE, existing + line, 'utf-8');
  } catch {
    // Silenciar errores de log
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function cleanupPIDs(): void {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (!isNaN(pid)) {
        try {
          // CMD nativo: taskkill sin PowerShell
          execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, () => {
            log(`Cleaned up old process PID ${pid}`);
          });
        } catch {
          // Proceso ya muerto
        }
      }
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignorar errores de cleanup
  }
}

async function findFreePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    const inUse = await isPortInUse(port);
    if (!inUse) return port;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + 100}`);
}

function launchDashboard(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // CMD NATIVO: Usar spawn con cmd.exe para ejecutar el batch
    // ¡Este es el truco! ejecutar cmd.exe que corra tsx.cmd
    const child = spawn('cmd.exe', ['/c', 'npx', 'tsx', WS_SCRIPT], {
      cwd: join(ROOT, 'apps', 'web-dashboard'),
      windowsHide: true,
      detached: false, // NO detached para evitar orphans
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WS_PORT: String(port),
        NODE_ENV: 'development',
      },
    });

    if (child.pid) {
      writeFileSync(PID_FILE, String(child.pid), 'utf-8');
      log(`Dashboard launched with PID ${child.pid} on port ${port}`);
      resolve(child.pid);
    } else {
      reject(new Error('Failed to get PID'));
    }

    // Log stderr para debugging
    child.stderr?.on('data', (data) => {
      log(`[STDERR] ${data.toString().trim()}`);
    });

    child.on('error', (err) => {
      log(`[ERROR] Child process error: ${err.message}`);
      reject(err);
    });

    child.on('exit', (code) => {
      log(`[EXIT] Child process exited with code ${code}`);
      try {
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      } catch {
        // Ignorar
      }
    });
  });
}

async function waitForHealth(port: number, timeoutMs: number = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const healthy = await isPortInUse(port);
    if (healthy) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const portArg = args.find((a, i) => a === '--port' && args[i + 1])?.slice(0, -1) || '8080';
  const requestedPort = parseInt(portArg, 10) || 8080;

  log('=== Dashboard CMD Launcher ===');
  log('Architecture: CMD Native, Zero PowerShell');

  // Limpiar PIDs viejos
  cleanupPIDs();

  // Verificar si ya está corriendo
  if (await isPortInUse(requestedPort)) {
    log(`Dashboard already running on port ${requestedPort}`);
    return 0;
  }

  // Buscar puerto libre
  const port = await findFreePort(requestedPort);
  log(`Selected port: ${port}`);

  // Guardar configuración
  const portsFile = join(RUNTIME_DIR, 'dashboard-ports.json');
  writeFileSync(portsFile, JSON.stringify({ wsPort: port, vitePort: 5173 }, null, 2));

  // Lanzar dashboard
  try {
    await launchDashboard(port);

    // Esperar health check
    log('Waiting for health check...');
    const healthy = await waitForHealth(port);

    if (healthy) {
      log(`✓ Dashboard healthy on http://localhost:${port}`);
      return 0;
    } else {
      log('✗ Health check timeout');
      return 1;
    }
  } catch (err) {
    log(`✗ Failed to launch: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
