#!/usr/bin/env node
/**
 * mcp-healthcheck.ts — probe REAL de salud del servidor MCP de skills.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * "El contenedor arranca" no es "el servidor funciona". El healthcheck del
 * Docker hacia `statSync('dist/scripts/mcp/skill-server.js')`: verificaba que
 * el archivo EXISTIA, no que el server arrancara ni que encontrara el
 * catalogo de skills. Peor: la imagen no copiaba `skills/` ni `.atl/`, asi que
 * el server arrancaba y respondia "0 skills" — sano para el healthcheck,
 * muerto para el usuario.
 *
 * QUE MIDE (todo por MCP, como un cliente real)
 *   1. handshake `initialize` -> `serverInfo`;
 *   2. `tools/list` -> las tools expuestas;
 *   3. `tools/call list_skills` -> cuantas skills ve el server de verdad;
 *   4. el catalogo que el server tiene delante (.atl/skill-registry.md y
 *      skills/) — la causa raiz cuando el conteo es 0.
 *
 * USO
 *   node --import tsx src/tools/mcp-healthcheck.ts                       # fuente TS
 *   node --import tsx src/tools/mcp-healthcheck.ts --json                # reporte
 *   node --import tsx src/tools/mcp-healthcheck.ts --command node --args dist/scripts/mcp/skill-server.js
 *   node dist/src/tools/mcp-healthcheck.js                               # artefacto compilado
 *
 * SALIDA: exit 0 = sano · exit 1 = no sano (con el motivo).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../core/repo-root.js';

export interface HealthReport {
  ok: boolean;
  command: string;
  args: string[];
  serverInfo?: { name?: string; version?: string };
  tools: string[];
  skillsFiltered?: number;
  skillsTotal?: number;
  catalog: {
    registry: string;
    registryExists: boolean;
    skillsDir: string;
    skillsDirExists: boolean;
  };
  error?: string;
}

interface JsonRpcResponse {
  id?: number;
  result?: {
    serverInfo?: { name?: string; version?: string };
    tools?: Array<{ name?: string }>;
    content?: Array<{ text?: string }>;
  };
  error?: { message?: string };
}

function parseArgs(argv: string[]): { command: string; args: string[]; json: boolean } {
  let command = 'node';
  let args: string[] = ['--import', 'tsx', 'scripts/mcp/skill-server.ts'];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--command' && argv[i + 1]) command = argv[++i];
    else if (arg === '--args' && argv[i + 1]) args = argv[++i].split(' ').filter(Boolean);
  }
  return { command, args, json };
}

/** Corre el probe MCP completo contra el comando indicado. */
export function probeMcp(
  command: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<HealthReport> {
  return new Promise((resolvePromise) => {
    const report: HealthReport = {
      ok: false,
      command,
      args,
      tools: [],
      catalog: {
        registry: join(ROOT, '.atl', 'skill-registry.md'),
        registryExists: existsSync(join(ROOT, '.atl', 'skill-registry.md')),
        skillsDir: join(ROOT, 'skills'),
        skillsDirExists: existsSync(join(ROOT, 'skills')),
      },
    };

    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let buffer = '';
    let stderr = '';
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* el proceso puede haber muerto ya */
      }
      resolvePromise(report);
    };

    const timer = setTimeout(() => {
      report.error = `timeout: el server no respondio en ${Math.round(timeoutMs / 1000)}s. stderr=${stderr.slice(0, 400)}`;
      finish();
    }, timeoutMs);

    const send = (msg: unknown): void => {
      try {
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      } catch {
        /* el server puede haber cerrado el stdin */
      }
    };

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
    });

    child.on('error', (err) => {
      report.error = `no se pudo lanzar el server: ${err.message}`;
      finish();
    });

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += String(chunk);
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }
        if (msg.id === 1) {
          report.serverInfo = msg.result?.serverInfo;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (msg.id === 2) {
          report.tools = (msg.result?.tools ?? []).map((t) => t.name ?? '').filter(Boolean);
          send({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'list_skills', arguments: {} },
          });
        } else if (msg.id === 3) {
          if (msg.error) {
            report.error = `list_skills fallo: ${msg.error.message ?? 'error desconocido'}`;
          } else {
            const text = (msg.result?.content ?? []).map((c) => c.text ?? '').join('\n');
            const match = /\*\*Skills\*\*:\s*(\d+)\s*\/\s*(\d+)/.exec(text);
            if (match) {
              report.skillsFiltered = Number(match[1]);
              report.skillsTotal = Number(match[2]);
            } else {
              report.error = `list_skills respondio sin conteo de skills: ${text.slice(0, 200)}`;
            }
          }
          finish();
        }
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'gv-mcp-healthcheck', version: '1.0.0' },
      },
    });
  });
}

/** Decide si el reporte describe un servidor sano. */
export function evaluate(report: HealthReport): { ok: boolean; reason?: string } {
  if (report.error) return { ok: false, reason: report.error };
  if (!report.serverInfo?.name) return { ok: false, reason: 'sin serverInfo (no hubo handshake)' };
  if (report.tools.length === 0) return { ok: false, reason: 'tools/list vacio' };
  if (report.skillsTotal === undefined)
    return { ok: false, reason: 'no se pudo leer el conteo de skills' };
  if (report.skillsTotal === 0) {
    return {
      ok: false,
      reason: `el server ve 0 skills (registry=${report.catalog.registryExists}, skillsDir=${report.catalog.skillsDirExists}) — el catalogo no esta donde el server lo busca`,
    };
  }
  return { ok: true };
}

async function main(): Promise<void> {
  const { command, args, json } = parseArgs(process.argv.slice(2));
  const report = await probeMcp(command, args);
  const verdict = evaluate(report);
  report.ok = verdict.ok;
  if (!verdict.ok && !report.error) report.error = verdict.reason;

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(
      `[mcp-healthcheck] OK · ${report.serverInfo?.name} ${report.serverInfo?.version} · ` +
        `${report.tools.length} tools · ${report.skillsTotal} skills`,
    );
  } else {
    console.error(`[mcp-healthcheck] FAIL · ${report.error}`);
    console.error(`  comando: ${command} ${args.join(' ')}`);
    console.error(
      `  catalogo: registry=${report.catalog.registryExists} skillsDir=${report.catalog.skillsDirExists}`,
    );
  }
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void main();
}
