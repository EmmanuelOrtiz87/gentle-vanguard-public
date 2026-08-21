import { spawn, ChildProcess } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { getExternalApiTimeouts } from '@gentle-vanguard/core/timeout-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');
const SERVER_SCRIPT = resolve(ROOT, 'scripts/mcp/skill-server.ts');
const PACKAGE_ROOT = resolve(__dirname, '..');

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCPBridge extends EventEmitter {
  private proc: ChildProcess | null = null;
  private reqId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = '';
  private _connected = false;
  private _tools: ToolDefinition[] = [];
  private retryCount = 0;
  private maxRetries = 5;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;

  get connected(): boolean {
    return this._connected;
  }

  get tools(): ToolDefinition[] {
    return this._tools;
  }

  private getBackoffDelay(): number {
    const base = 1000;
    const delay = base * Math.pow(2, this.retryCount);
    return Math.min(delay, 30000);
  }

  async start(): Promise<void> {
    // Find tsx CLI entry point dynamically (pnpm uses versioned paths like tsx@4.23.1)
    const pnpmDir = resolve(PACKAGE_ROOT, 'node_modules/.pnpm');
    let tsxBin: string | null = null;
    try {
      if (existsSync(pnpmDir)) {
        const tsxDirs = readdirSync(pnpmDir).filter((d: string) => d.startsWith('tsx@'));
        if (tsxDirs.length > 0) {
          // Use the latest installed version
          tsxDirs.sort().reverse();
          const candidate = resolve(pnpmDir, tsxDirs[0], 'node_modules/tsx/dist/cli.mjs');
          if (existsSync(candidate)) tsxBin = candidate;
        }
      }
    } catch {
      /* fallback to null */
    }
    if (!tsxBin) {
      // Fallback: try standard node_modules
      const fallback = resolve(PACKAGE_ROOT, 'node_modules/tsx/dist/cli.mjs');
      if (existsSync(fallback)) tsxBin = fallback;
    }
    const cwd = existsSync(SERVER_SCRIPT) ? ROOT : undefined;
    if (!cwd || !tsxBin) {
      this._tools = [];
      this._connected = false;
      return;
    }

    return new Promise((resolve, reject) => {
      this.proc = spawn(process.execPath, [tsxBin, SERVER_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        windowsHide: true,
      });

      let started = false;
      const timeout = setTimeout(() => {
        if (!started) reject(new Error('MCP bridge start timeout'));
      }, getExternalApiTimeouts()?.mcp_bridge_start_ms ?? 15000);

      this.proc.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
        if (!started) {
          started = true;
          clearTimeout(timeout);
          this.retryCount = 0;
          this._connected = true;
          this.emit('connected');
          // Await tools discovery before resolving so bridgeToolCount is populated
          void this.discoverToolsWithTimeout().then(() => resolve());
        }
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        this.emit('stderr', data.toString());
        if (!started) {
          started = true;
          clearTimeout(timeout);
          this.retryCount = 0;
          this._connected = true;
          this.emit('connected');
          // Await tools discovery before resolving so bridgeToolCount is populated
          void this.discoverToolsWithTimeout().then(() => resolve());
        }
      });

      this.proc.on('exit', (code) => {
        this._connected = false;
        this.proc = null;
        this.rejectAll(new Error(`MCP process exited with code ${code}`));
        this.emit('disconnected', code);
        this.scheduleRestart();
      });

      this.proc.on('error', (err) => {
        this._connected = false;
        this.proc = null;
        if (!started) {
          clearTimeout(timeout);
          reject(err);
        }
        this.emit('error', err);
        this.scheduleRestart();
      });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg: MCPResponse = JSON.parse(line);
        this.handleResponse(msg);
      } catch {
        this.emit('stderr', line);
      }
    }
  }

  private handleResponse(msg: MCPResponse): void {
    const pending = this.pending.get(msg.id);
    if (pending) {
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  private async discoverTools(): Promise<void> {
    try {
      const result = (await this.request('tools/list')) as { tools: ToolDefinition[] };
      this._tools = result.tools || [];
      this.emit('tools_discovered', this._tools);
    } catch {
      this._tools = [];
    }
  }

  /** discoverTools with 5s timeout to prevent hanging start() */
  private async discoverToolsWithTimeout(): Promise<void> {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('discoverTools timeout')), 5000),
    );
    try {
      await Promise.race([this.discoverTools(), timeout]);
    } catch {
      this._tools = [];
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.reqId;
    const req: MCPRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc?.stdin?.write(JSON.stringify(req) + '\n');
    });
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args });
  }

  private scheduleRestart(): void {
    if (this._stopped) return;
    if (this.retryCount >= this.maxRetries) {
      console.warn(`[MCP] Max retries (${this.maxRetries}) reached, giving up`);
      this.emit('max_retries_exceeded');
      return;
    }
    const delay = this.getBackoffDelay();
    this.retryCount++;
    console.log(`[MCP] Restarting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
    this.retryTimeout = setTimeout(() => {
      this.start().catch((err) => {
        console.warn('[MCP] Restart failed:', (err as Error).message);
      });
    }, delay);
  }

  async stop(): Promise<void> {
    this._stopped = true;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this._connected = false;
    }
  }
}

let instance: MCPBridge | null = null;

export function getBridge(): MCPBridge {
  if (!instance) {
    instance = new MCPBridge();
  }
  return instance;
}
