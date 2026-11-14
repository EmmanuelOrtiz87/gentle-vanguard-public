#!/usr/bin/env node
/**
 * ollama-doctor.ts — Diagnostico del substrato local Ollama <-> OpenCode.
 *
 * Por que existe: la app de Ollama se auto-actualiza y su relacion con el
 * stack es fragil en cinco puntos que ya rompieron sesiones (2026-11-13):
 *   1. El ICD de Vulkan del driver Intel puede no estar registrado en
 *      HKLM\SOFTWARE\Khronos\Vulkan\Drivers: Ollama encuentra la GPU, el loader
 *      devuelve 0 dispositivos y todo cae a CPU (3-5x mas lento) sin error.
 *   2. Ollama 0.40 ignora OLLAMA_CONTEXT_LENGTH en la app y carga el contexto
 *      MAXIMO del modelo (40960 en qwen3:14b), que no entra comodo en VRAM: el
 *      runner hace offload parcial o crashea a mitad de una peticion larga.
 *      La unica palanca real es un modelo derivado con `PARAMETER num_ctx`.
 *   3. Los modelos "coder" (qwen2.5-coder) NO emiten tool_calls por /v1: el
 *      agente responde JSON como texto y OpenCode nunca ejecuta la tool. El
 *      sintoma es "no lee mis archivos", no un error.
 *   4. Qwen3 "piensa" por defecto y quema 150-300 tokens por turno en iGPU
 *      (4 tok/s => +1 min por turno). En /v1 la unica palanca es
 *      `reasoning_effort: "none"`; `think` y `chat_template_kwargs` se ignoran.
 *   5. Flash Attention en Vulkan/iGPU crashea el runner (exit 0xe06d7363)
 *      durante generaciones largas.
 *
 * No duplica: `local-capability-probe` mide capacidad COGNITIVA del modelo,
 * `ollama-substrate` corre rollouts del bucle, `local-provider-discovery`
 * encuentra endpoints. Esto mide el SUBSTRATO: que el hierro, la config de
 * Ollama y la config de OpenCode sean coherentes entre si.
 *
 * Es read-only sobre la config (mide, no arregla); la unica escritura es la
 * inferencia sintetica de prueba. Lo consume el CLI y el maintenance-watchtower
 * (`checkOllamaSubstrate`, sin inferencia, para detectar deriva cada sesion).
 *
 * Uso:
 *   node --import tsx src/tools/ollama-doctor.ts                 # reporte
 *   node --import tsx src/tools/ollama-doctor.ts --json          # machine-readable
 *   node --import tsx src/tools/ollama-doctor.ts --strict        # exit 1 si hay fallos
 *   node --import tsx src/tools/ollama-doctor.ts --skip-inference
 *   node --import tsx src/tools/ollama-doctor.ts --model=qwen3:14b
 *   node --import tsx src/tools/ollama-doctor.ts --base-url=http://127.0.0.1:11434
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSync } from '../core/run-command.js';

export type Status = 'pass' | 'warn' | 'fail' | 'skip';

export interface Check {
  id: string;
  status: Status;
  detail: string;
  fix?: string;
}

export interface Report {
  ok: boolean;
  baseUrl: string;
  model: string;
  checks: Check[];
  passed: number;
  warnings: number;
  failures: number;
  skipped: number;
}

export interface DiagnoseOptions {
  /** Base del server de Ollama (default http://127.0.0.1:11434). */
  baseUrl?: string;
  /** Modelo a verificar; si se omite se infiere de opencode.json. */
  model?: string;
  /** Directorio del proyecto (default process.cwd()). */
  cwd?: string;
  /** false = solo checks baratos (watchtower); true = incluye la inferencia real. */
  inference?: boolean;
  /** Timeout por request HTTP. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3-14b-32k';

/** Ollama agrega `:latest` en /api/tags y acepta el nombre corto: normalizar para comparar. */
const normalize = (name: string): string => name.replace(/:latest$/, '');

function projectAgents(cwd: string): Record<string, { model?: string }> | undefined {
  const configPath = join(cwd, 'opencode.json');
  if (!existsSync(configPath)) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agent?: Record<string, { model?: string }>;
    };
    return cfg.agent;
  } catch {
    return undefined;
  }
}

/**
 * El modelo NO se hardcodea: se infiere de la config real del proyecto. Si los
 * agentes apuntan a un modelo y el doctor verifica otro, el reporte miente en
 * verde (deriva silenciosa, ya paso el 2026-11-13 con 16k vs 32k).
 */
export function modelFromProjectConfig(cwd: string): string | undefined {
  const agents = projectAgents(cwd);
  const counts = new Map<string, number>();
  for (const agent of Object.values(agents ?? {})) {
    const model = agent.model ?? '';
    if (!model.startsWith('ollama/')) continue;
    const name = model.slice('ollama/'.length);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // El modelo mas usado por los agentes es el que define el substrato local.
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  timeoutMs = 240_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface ShowResponse {
  parameters?: string;
  model_info?: Record<string, unknown>;
  capabilities?: string[];
}
interface TagsResponse {
  models?: Array<{ name: string; size?: number }>;
}

/** El proyecto declara agentes con modelo `ollama/<modelo>`: si el modelo no esta instalado, el agente no arranca. */
function checkAgentModels(installed: Set<string>, cwd: string): Check {
  const agents = projectAgents(cwd);
  if (!agents) {
    return { id: 'opencode-agents', status: 'skip', detail: 'sin opencode.json en el cwd' };
  }
  const models = Object.values(agents)
    .map((a) => a.model ?? '')
    .filter((m) => m.startsWith('ollama/'));
  if (models.length === 0) {
    return {
      id: 'opencode-agents',
      status: 'skip',
      detail: 'ningun agente usa el provider ollama',
    };
  }
  const unique = [...new Set(models.map((m) => normalize(m.slice('ollama/'.length))))];
  const missing = unique.filter((m) => !installed.has(m));
  if (missing.length > 0) {
    return {
      id: 'opencode-agents',
      status: 'fail',
      detail: `${missing.length}/${unique.length} modelos referenciados por agentes no estan instalados: ${missing.join(', ')}`,
      fix: `ollama pull ${missing[0]}`,
    };
  }
  return {
    id: 'opencode-agents',
    status: 'pass',
    detail: `${unique.length} modelo(s) de agentes instalados (${models.length} agentes)`,
  };
}

/** En Windows, un ICD sin registrar deja a Vulkan sin dispositivos: Ollama cae a CPU en silencio. */
function checkVulkanIcd(): Check {
  if (process.platform !== 'win32') {
    return { id: 'vulkan-icd', status: 'skip', detail: 'solo aplica a Windows' };
  }
  const res = runSync('reg', ['query', 'HKLM\\SOFTWARE\\Khronos\\Vulkan\\Drivers'], {
    timeout: 15_000,
  });
  // Cada entrada es "<ruta>.json  REG_DWORD  0x0". El loader deshabilita un ICD
  // cuando el valor es distinto de cero: 0x0 es lo que lo mantiene habilitado.
  const entries = String(res.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\.json\b/i.test(l) && /\bREG_/i.test(l));
  if (res.status !== 0 || entries.length === 0) {
    return {
      id: 'vulkan-icd',
      status: 'fail',
      detail: 'ningun ICD de Vulkan registrado: Ollama vera 0 VRAM y correra en CPU',
      fix: 'registrar el ICD del driver (HKLM\\SOFTWARE\\Khronos\\Vulkan\\Drivers, DWORD 0 = habilitado) o reinstalar el driver Intel',
    };
  }
  const disabled = entries.filter((l) => /REG_DWORD\s+0x0*[1-9a-f]/i.test(l));
  if (disabled.length > 0) {
    return {
      id: 'vulkan-icd',
      status: 'fail',
      detail: `${disabled.length}/${entries.length} ICD deshabilitado(s) con valor distinto de 0`,
      fix: 'reponer el valor a 0 o borrar el valor deshabilitado (reg add ... /t REG_DWORD /d 0 /f)',
    };
  }
  return { id: 'vulkan-icd', status: 'pass', detail: `${entries.length} ICD habilitado(s)` };
}

/** num_ctx del modelo cargado debe coincidir con el `limit.context` que declara OpenCode. */
function checkContext(show: ShowResponse): Check {
  const numCtx = /num_ctx\s+(\d+)/.exec(show.parameters ?? '')?.[1];
  const train =
    show.model_info?.['qwen3.context_length'] ?? show.model_info?.['llama.context_length'];
  if (!numCtx) {
    return {
      id: 'context',
      status: 'warn',
      detail: `sin num_ctx en el Modelfile; Ollama usara el maximo (${String(train ?? '?')}) y puede no entrar en VRAM`,
      fix: 'crear un modelo derivado con PARAMETER num_ctx <n> (ver docs/reference/OLLAMA-LOCAL-SUBSTRATE.md)',
    };
  }
  return {
    id: 'context',
    status: 'pass',
    detail: `num_ctx=${numCtx} (contexto nativo del modelo: ${String(train ?? 'n/d')})`,
  };
}

/** Flash Attention en Vulkan/iGPU provoco crashes del runner (0xe06d7363) durante generaciones largas. */
function checkFlashAttention(): Check {
  // El shell que ejecuta el doctor hereda el env del arranque: leer el valor
  // PERSISTIDO del usuario es lo unico que dice que pasara en el proximo boot.
  let value = process.env.OLLAMA_FLASH_ATTENTION;
  let source = 'entorno del proceso';
  if (process.platform === 'win32') {
    const res = runSync('reg', ['query', 'HKCU\\Environment', '/v', 'OLLAMA_FLASH_ATTENTION'], {
      timeout: 15_000,
    });
    const hit = /OLLAMA_FLASH_ATTENTION\s+REG_\w+\s+(\S+)/i.exec(String(res.stdout ?? ''));
    if (res.status === 0 && hit) {
      value = hit[1];
      source = 'entorno de usuario persistido';
    }
  }
  if (value === '0' || value === 'false') {
    return {
      id: 'flash-attention',
      status: 'pass',
      detail: `desactivada (${source}); reiniciar Ollama si el server arranco antes del cambio`,
    };
  }
  return {
    id: 'flash-attention',
    status: 'warn',
    detail: `OLLAMA_FLASH_ATTENTION=${value ?? 'sin definir'} (${source}); en iGPU Vulkan puede crashear el runner`,
    fix: 'set OLLAMA_FLASH_ATTENTION=0 a nivel usuario y reiniciar Ollama',
  };
}

/** El contrato que importa: /v1 + tools + reasoning_effort none => tool_calls estructurado, sin thinking. */
async function checkToolCalling(baseUrl: string, model: string, timeoutMs: number): Promise<Check> {
  const started = Date.now();
  try {
    const body = {
      model,
      messages: [{ role: 'user', content: 'Lee package.json y reporta el campo name.' }],
      reasoning_effort: 'none',
      stream: false,
      tools: [
        {
          type: 'function',
          function: {
            name: 'read',
            description: 'Read a file from disk',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
      ],
    };
    const res = await request<{
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string; reasoning?: string; tool_calls?: unknown[] };
      }>;
    }>(
      baseUrl,
      '/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const choice = res.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        id: 'tool-calling',
        status: 'fail',
        detail: `sin tool_calls (finish_reason=${choice?.finish_reason ?? '?'}) en ${elapsed}s: el agente no puede ejecutar herramientas`,
        fix: `usar un modelo con capability "tools" (ollama show ${model})`,
      };
    }
    const reasoning = choice?.message?.reasoning ?? '';
    if (reasoning.length > 0) {
      return {
        id: 'tool-calling',
        status: 'warn',
        detail: `tool_calls OK en ${elapsed}s, pero el modelo razono ${reasoning.length} chars pese a reasoning_effort=none`,
        fix: 'verificar que el proveedor envie reasoning_effort=none (options.reasoningEffort en opencode.json)',
      };
    }
    return {
      id: 'tool-calling',
      status: 'pass',
      detail: `tool_calls OK en ${elapsed}s, sin thinking`,
    };
  } catch (err) {
    return { id: 'tool-calling', status: 'fail', detail: `probe fallo: ${String(err)}` };
  }
}

/**
 * Corre todos los checks del substrato local. `inference: false` omite la unica
 * peticion de inferencia (lo usa el watchtower, que debe ser barato).
 */
export async function diagnoseOllama(options: DiagnoseOptions = {}): Promise<Report> {
  const cwd = options.cwd ?? process.cwd();
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = options.model ?? modelFromProjectConfig(cwd) ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 240_000;
  const withInference = options.inference !== false;

  const checks: Check[] = [];
  let installed = new Set<string>();

  let online = false;
  try {
    const version = await request<{ version?: string }>(baseUrl, '/api/version', undefined, 10_000);
    online = true;
    checks.push({
      id: 'server',
      status: 'pass',
      detail: `Ollama ${version.version ?? '?'} en ${baseUrl}`,
    });
  } catch (err) {
    checks.push({
      id: 'server',
      status: 'fail',
      detail: `sin servidor en ${baseUrl}: ${String(err)}`,
      fix: 'arrancar Ollama (app de Windows o `ollama serve`)',
    });
  }

  if (online) {
    try {
      const tags = await request<TagsResponse>(baseUrl, '/api/tags', undefined, 15_000);
      installed = new Set((tags.models ?? []).map((m) => normalize(m.name)));
      if (installed.has(normalize(model))) {
        checks.push({
          id: 'model',
          status: 'pass',
          detail: `${model} instalado (${installed.size} en total)`,
        });
        const show = await request<ShowResponse>(
          baseUrl,
          '/api/show',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
          },
          30_000,
        );
        const caps = show.capabilities ?? [];
        checks.push(
          caps.includes('tools')
            ? {
                id: 'capability-tools',
                status: 'pass',
                detail: 'el modelo declara capability tools',
              }
            : {
                id: 'capability-tools',
                status: 'fail',
                detail: `el modelo no declara capability tools (${caps.join(', ') || 'ninguna'})`,
                fix: `elegir un modelo con tools; capacidades actuales: ${caps.join(', ') || 'ninguna'}`,
              },
        );
        checks.push(checkContext(show));
      } else {
        checks.push({
          id: 'model',
          status: 'fail',
          detail: `${model} no esta instalado`,
          fix: `ollama pull ${model}`,
        });
      }
    } catch (err) {
      checks.push({
        id: 'model',
        status: 'fail',
        detail: `no se pudo listar modelos: ${String(err)}`,
      });
    }

    checks.push(checkVulkanIcd());
    checks.push(checkFlashAttention());
    checks.push(checkAgentModels(installed, cwd));
    if (withInference) {
      checks.push(await checkToolCalling(baseUrl, model, timeoutMs));
    } else {
      checks.push({ id: 'tool-calling', status: 'skip', detail: 'omitido (sin inferencia)' });
    }
  }

  const count = (s: Status): number => checks.filter((c) => c.status === s).length;
  return {
    ok: count('fail') === 0,
    baseUrl,
    model,
    checks,
    passed: count('pass'),
    warnings: count('warn'),
    failures: count('fail'),
    skipped: count('skip'),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const report = await diagnoseOllama({
    baseUrl: arg('base-url'),
    model: arg('model'),
    inference: !flag('skip-inference'),
    timeoutMs: Number(arg('timeout-ms') ?? 240_000),
  });

  if (flag('json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const icon: Record<Status, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };
    console.log(`\nOllama doctor — ${report.baseUrl} · modelo ${report.model}\n`);
    for (const c of report.checks) {
      console.log(`[${icon[c.status]}] ${c.id}: ${c.detail}`);
      if (c.fix && c.status !== 'pass') console.log(`        fix: ${c.fix}`);
    }
    console.log(
      `\n${report.passed} pass, ${report.warnings} warn, ${report.failures} fail, ${report.skipped} skip — ${report.ok ? 'OK' : 'ATENCION'}\n`,
    );
  }

  if (flag('strict') && !report.ok) process.exit(1);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('ollama-doctor.ts') ?? false;
if (invokedDirectly) {
  void main().catch((err) => {
    console.error(`ollama-doctor: ${String(err)}`);
    process.exit(1);
  });
}
