import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createCliAgentSubstrate } from '../eval/cli-agent-substrate.js';
import { createOpencodeSubstrate } from '../core/harness-loop.js';

/** Consulta al proveedor editorial: Codex CLI (modelos gpt-*), sustrato opencode para
 * el resto y Ollama local para `ollama/*`. Extraído verbatim de editorial-agent.ts
 * (2026-11-19) para compartirlo con el verificador de afirmaciones (GB-20261119);
 * cambiar el comportamiento de uno implica revisar el otro.
 *
 * GB-20261120 (S3): `timeoutMs` es parametrizable. El cap fijo de 90 s medido
 * producía la mayor parte de los fallos de la ruta editorial: la generación de
 * síntesis (multi-fuente) vencía el cap en nube Y en el fallback local, y la
 * revisión de 2ª llamada heredaba el mismo cap corto → `model-review-unavailable`.
 * La política por operación × tipo de modelo vive en `editorialTimeoutMs`. */
export async function complete(
  model: string,
  effort: string | undefined,
  temperature: number,
  systemPrompt: string,
  task: string,
  format: 'json' | Record<string, unknown> = 'json',
  timeoutMs: number = 90_000,
): Promise<string> {
  if (!model.startsWith('ollama/')) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const codex = /^gpt-/.test(model);
    const entry = codex
      ? (process.env.PATH ?? '')
          .split(delimiter)
          .map((dir) => join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'))
          .find(existsSync)
      : undefined;
    if (codex && !entry) throw new Error('Codex CLI no disponible.');
    const options =
      effort && /^(low|medium|high|xhigh|max|ultra)$/.test(effort)
        ? ['-c', 'model_reasoning_effort="' + effort + '"']
        : [];
    const backend = entry
      ? createCliAgentSubstrate({
          root,
          command: [
            process.execPath,
            entry,
            'exec',
            '--json',
            '--ephemeral',
            '--sandbox',
            'read-only',
            '--model',
            model,
            ...options,
            '-',
          ],
        })
      : createOpencodeSubstrate({
          agent: 'doc-agent',
          model,
          projectDir: root,
          configPath: join(root, 'opencode.json'),
        });
    const result = await backend.run({
      variantName: 'editorial-text',
      workDir: root,
      timeoutMs,
      systemPrompt: codex ? systemPrompt : systemPrompt + '\n\n$ARGUMENTS',
      task,
    });
    if (!result.ok || !result.completed || !result.delivered)
      throw new Error('Proveedor sin entrega completa.');
    return result.render;
  }
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: model.slice('ollama/'.length),
      stream: false,
      think: false,
      format,
      options: {
        num_ctx: 32768,
        temperature: temperature,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ],
    }),
  });
  if (!response.ok) throw new Error('Ollama respondió con HTTP ' + response.status);
  const result = await response.json();
  if (!result.done || result.done_reason !== 'stop' || typeof result.message?.content !== 'string')
    throw new Error('Ollama no entregó una respuesta completa.');
  return result.message.content;
}

/** Timeout editorial por operación × tipo de modelo (GB-20261120 S3).
 *
 * Medición 2026-11-19/20 (99 recibos): el cap fijo de 90 s explicaba la mayor
 * parte del 52% de fallo registrado — síntesis multi-fuente (la operación más
 * pesada) vencía el cap en nube y en el fallback local, y las fases de revisión
 * heredaban el mismo cap. La semántica de veredictos (GB-20261119) NO cambia:
 * solo se ajusta el presupuesto de tiempo por fase.
 *
 * Política (ms), sobreescrita por env EDITORIAL_TIMEOUT_MS (break-glass):
 * - síntesis (multi-fuente + evidencia): nube 240s / local 300s
 * - draft/rewrite/summary: nube 150s / local 180s
 * - operaciones menores y revisión ligera: cap clásico 90s
 */
export function editorialTimeoutMs(operation: string, model: string): number {
  const envOverride = Number(process.env.EDITORIAL_TIMEOUT_MS);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;
  const local = model.startsWith('ollama/');
  if (operation === 'synthesis') return local ? 300_000 : 240_000;
  if (['draft', 'rewrite', 'summary'].includes(operation)) return local ? 180_000 : 150_000;
  return 90_000;
}
