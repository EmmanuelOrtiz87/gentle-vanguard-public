#!/usr/bin/env tsx
/**
 * serve-presentations — HTTP server for docs/presentations/
 *
 * Zero-dependency Node.js static file server for the presentations book.
 * Replaces start-presentations-server.ps1 (migrated to TS).
 *
 * Usage:
 *   npx tsx src/cli/serve-presentations.ts [--port 3000] [--no-browser] [--quiet] [--no-store]
 *
 * Features:
 *   - Serves docs/presentations/ directory via built-in http module
 *   - Auto-detects local/network IP addresses
 *   - MIME type support for all presentation assets (.html, .css, .js, .svg, .png, etc.)
 *   - Directory index redirect (serves index.html for /)
 *   - Graceful shutdown on SIGINT/SIGTERM
 *   - QR code URL display for mobile access
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runSyncShell } from '../core/run-command.js';
import { printBanner } from './banner.js';

const PORT = parseInt(
  process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? process.env.PORT ?? '3000',
  10,
);
const NO_BROWSER = process.argv.includes('--no-browser');
const QUIET = process.argv.includes('--quiet');
const NO_STORE = process.argv.includes('--no-store');
const ROOT = path.resolve(process.cwd(), 'docs/presentations');
const LOG_PATH = path.resolve(process.cwd(), '.runtime/presentations-server.log');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function getNetworkIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        !name.toLowerCase().includes('loopback') &&
        !name.toLowerCase().includes('bluetooth') &&
        !name.toLowerCase().includes('virtual') &&
        !name.toLowerCase().includes('hyper-v') &&
        !name.toLowerCase().includes('docker')
      ) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] ${message}`;
  const logDir = path.dirname(LOG_PATH);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(LOG_PATH, line + '\n', 'utf-8');
  if (!QUIET) console.log(line);
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers: Record<string, string> = {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    };
    // --no-store: evita caché (necesario para verificar modales i18n en Chrome/CDP con recargas)
    if (NO_STORE) headers['Cache-Control'] = 'no-store, must-revalidate';
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>404 — Not Found</h1><p>${path.basename(filePath)}</p>`);
  }
}

const server = http.createServer((req, res) => {
  let urlPath = req.url ?? '/';
  // Parse query string off
  const queryIdx = urlPath.indexOf('?');
  if (queryIdx !== -1) urlPath = urlPath.substring(0, queryIdx);

  // Default to index.html for directory requests
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // Security: prevent path traversal
  const safePath = path.normalize(urlPath).replace(/^[/\\]+/, '');
  const filePath = path.join(ROOT, safePath);

  // Ensure we're still within ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>403 — Forbidden</h1>');
    return;
  }

  log(`GET ${safePath}`);
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  const hostIP = getNetworkIP();
  if (!QUIET) printBanner('Presentations Server');

  log(`Server started on port ${PORT}`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://${hostIP}:${PORT}`);
  console.log(`  Dir:      ${ROOT}`);
  console.log(`  Log:      ${LOG_PATH}`);
  console.log(
    `  QR:       https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=http://${hostIP}:${PORT}`,
  );
  console.log('');

  // Open browser
  if (!NO_BROWSER) {
    const platform = process.platform;
    try {
      if (platform === 'win32') {
        runSyncShell(`start http://localhost:${PORT}`, { stdio: 'ignore' });
      } else if (platform === 'darwin') {
        runSyncShell(`open http://localhost:${PORT}`, { stdio: 'ignore' });
      } else {
        runSyncShell(`xdg-open http://localhost:${PORT}`, { stdio: 'ignore' });
      }
    } catch {
      // Browser open is best-effort
    }
  }

  console.log('  Press Ctrl+C to stop the server');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Server stopping (SIGINT)...');
  console.log('\n  Server stopped.');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  log('Server stopping (SIGTERM)...');
  server.close(() => process.exit(0));
});
