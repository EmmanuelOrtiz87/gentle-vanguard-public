/**
 * cli-agent-substrate — substrate del bucle del harness sobre un CLI headless.
 *
 * Cualquier agente con modo no-interactivo sirve: el prompt via POR STDIN
 * (codex exec lo lee nativamente cuando no se pasa como argumento). Por argv
 * NO va: medido en esta maquina, un prompt de ~3k+ chars en la linea de
 * comando dispara un EPERM de un interceptor de seguridad que analiza el
 * CONTENIDO de la linea (bisectado: depende del texto acumulado, no del
 * largo — 12k de 'x' pasa, 3k del AGENTS.md no). Stdin ademas elimina el
 * limite de largo de la linea de comando.
 *
 * Primer preset: `codex exec --json` (eventos JSONL; la entrega final es el
 * ULTIMO `item.completed` con `item.type: agent_message`). El factory queda
 * generico para otros CLIs headless (kimi, minimax) sin reimplementar el
 * bucle.
 *
 * Procesos-ocultos: spawn DIRECTO del entry JS con windowsHide, sin shell,
 * sin cmd.exe; el stdin se escribe y se CIERRA (es el canal del prompt, no
 * un pipe que se deja abierto — el caso que cuelga a opencode).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  Substrate,
  SubstrateRunRequest,
  SubstrateRunResult,
} from '../core/harness-loop.js';

export interface CliAgentOptions {
  /**
   * argv completo SIN el prompt: el rollout entra por stdin. El primer
   * elemento es el binario (para un CLI de npm, [process.execPath, entry.js]).
   */
  command: string[];
  root: string;
  timeoutMs?: number;
}

interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Ultima entrega del agente en un stream JSONL de codex exec. */
export function finalAgentMessage(stdout: string): string {
  let last = '';
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const e = JSON.parse(trimmed) as CodexEvent;
      if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) {
        last = e.item.text.trim();
      }
    } catch {
      // ruido de hooks/stdout que no es JSONL: se ignora
    }
  }
  return last;
}

export function createCliAgentSubstrate(options: CliAgentOptions): Substrate {
  const label = options.command[0] ?? 'cli';
  return {
    name: `cli-agent:${label}`,
    async run(request: SubstrateRunRequest): Promise<SubstrateRunResult> {
      const started = Date.now();
      const prompt = `${request.systemPrompt}\n\n## Tarea\n\n${request.task}`;
      const argv = [...options.command];

      return await new Promise<SubstrateRunResult>((resolveRun) => {
        const child = spawn(argv[0], argv.slice(1), {
          cwd: options.root,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // El prompt entra por stdin y se cierra: es el canal previsto del CLI.
        child.stdin.on('error', () => {
          // EPIPE si el CLI muere antes de leer: la salida ya lo reporta.
        });
        child.stdin.write(prompt);
        child.stdin.end();
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => child.kill('SIGKILL'), request.timeoutMs ?? 600_000);

        const finish = (result: Omit<SubstrateRunResult, 'sessionId' | 'runId' | 'costUsd'>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolveRun({
            ...result,
            sessionId: `cli-${request.variantName}`,
            runId: createHash('sha1')
              .update(`${request.variantName}|${result.render}`)
              .digest('hex')
              .slice(0, 16),
            costUsd: 0,
          });
        };

        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        child.on('error', (err) => {
          finish({
            ok: false,
            delivered: false,
            render: '',
            completed: false,
            error: `No se pudo ejecutar ${label}: ${err.message}`,
            rollout: `# substrate cli ${label}\nerror: ${err.message}`,
            inputTokens: 0,
            outputTokens: 0,
          });
        });
        child.on('close', (code) => {
          const render = finalAgentMessage(stdout);
          // tokens del ultimo turn.completed (presupuesto declarado aparte)
          let inputTokens = 0;
          let outputTokens = 0;
          for (const line of stdout.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) continue;
            try {
              const e = JSON.parse(trimmed) as CodexEvent;
              if (e.type === 'turn.completed' && e.usage) {
                inputTokens = e.usage.input_tokens ?? 0;
                outputTokens = e.usage.output_tokens ?? 0;
              }
            } catch {
              // ruido no-JSONL
            }
          }
          const trace = [
            `# substrate cli ${label}`,
            `argv=${options.command.join(' ')}`,
            `exit=${code} elapsed_ms=${Date.now() - started}`,
            stderr.trim() ? `stderr: ${stderr.trim().slice(0, 400)}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          if (code === 0 && render) {
            finish({
              ok: true,
              delivered: true,
              render,
              completed: true,
              rollout: `${trace}\nentrega: ${render.slice(0, 400)}`,
              inputTokens,
              outputTokens,
            });
          } else {
            finish({
              ok: false,
              delivered: false,
              render: '',
              completed: false,
              error: render
                ? undefined
                : `${label} no devolvio entrega (exit=${code})${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ''}`,
              rollout: trace,
              inputTokens,
              outputTokens,
            });
          }
        });
      });
    },
  };
}
