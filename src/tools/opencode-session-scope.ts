/**
 * opencode-session-scope.ts — NORM-OPENCODE-001: OpenCode opera en scope de sesión.
 *
 * El defecto (GB-2026-11-14 §2.5, ocurrido DOS veces y una tercera el
 * 2026-11-15): al cerrar, OpenCode persiste su selección de modelo en el
 * opencode.json que cargó — dejando la flota entera sobre un modelo sin
 * capability "tools" (sin un solo error: los agentes dejan de ejecutar
 * herramientas y TODA herramienta que lee la config del repo queda rota).
 *
 * El invariante de la norma: el opencode.json del repo es el CANON (commitado,
 * compartido con guards y validadores); OpenCode nunca lo muta. Lo que OpenCode
 * necesita en sesión (selección de modelo, providers) vive en una COPIA de
 * sesión bajo .runtime/opencode/ — gitignored — que se regenera del canon en
 * cada arranque y se descarta al cerrar. Si necesita infraestructura (ollama,
 * daemons), la CONSUME del stack (que la levanta on-demand); nunca deja cosas
 * activas ni configuradas a su conveniencia al salir.
 *
 * Modos (CLI):
 *   --detect         reporta drift sin tocar nada (exit 1 si la flota está rota)
 *   --heal           si la flota está rota (o la config ilegible), snapshot
 *                    forense del drift y restauración desde HEAD; exit 0 si
 *                    quedó sano; NO toca drift legítimo (modelos registrados
 *                    con capability tools — cambio intencional del owner)
 *   --session-start  heal-if-needed + crea la copia de sesión; imprime su path
 *                    (para OPENCODE_CONFIG del wrapper)
 *   --session-end    heal-if-needed + reap de procesos huérfanos (runHygiene
 *                    apply); corre al cerrar OpenCode
 *
 * Uso: node --import tsx src/tools/opencode-session-scope.ts --heal
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';
import { runHygiene } from '../core/process-hygiene.js';
import {
  classifyAgentModels,
  type AgentModelClassification,
} from './opencode-agent-model-guard.js';

type RegistryEntry = { capabilities?: string[] };
type Registry = Record<string, RegistryEntry>;
type AgentConfig = { model?: string; provider?: string };
type OpencodeConfig = { model?: string; agent?: Record<string, AgentConfig> };

export type FleetStatus =
  | { kind: 'clean'; checked: number }
  | { kind: 'drift'; checked: number; problems: AgentModelClassification['problems'] }
  | { kind: 'illegible'; reason: string };

export interface HealReport {
  healed: boolean;
  status: FleetStatus;
  snapshotPath?: string;
  detail: string;
}

/** Clasifica el estado de la flota del canon sin tocar nada. Pura para tests. */
export function classifyFleetStatus(rawConfig: string | null, registry: Registry): FleetStatus {
  if (rawConfig === null) {
    return { kind: 'illegible', reason: 'opencode.json no encontrado' };
  }
  let config: OpencodeConfig;
  try {
    config = JSON.parse(rawConfig) as OpencodeConfig;
  } catch (error) {
    return { kind: 'illegible', reason: (error as Error).message };
  }
  const { ok, problems, checked } = classifyAgentModels(config.agent ?? {}, registry);
  return ok ? { kind: 'clean', checked } : { kind: 'drift', checked, problems };
}

function loadRegistry(root: string): Registry | null {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(root, 'config', 'model-health-registry.json'), 'utf8'),
    ) as Registry & { models?: Registry };
    return raw.models ?? raw;
  } catch {
    return null;
  }
}

/** Path de la copia de sesión (gitignored: .runtime/). */
export function sessionConfigPath(root: string): string {
  return resolve(root, '.runtime', 'opencode', 'session-opencode.json');
}

/** Canon + selección operativa validada, exclusivamente en la copia de sesión. */
export function writeSessionConfig(root: string): string {
  const canonical = readFileSync(resolve(root, 'opencode.json'), 'utf8');
  let session = canonical;
  try {
    const active = JSON.parse(
      readFileSync(resolve(root, '.runtime', 'model-active.json'), 'utf8'),
    ) as { model?: unknown; provider?: unknown };
    const registry = loadRegistry(root);
    if (
      typeof active.model === 'string' &&
      typeof active.provider === 'string' &&
      active.provider.trim() &&
      registry?.[active.model]?.capabilities?.includes('tools')
    ) {
      const config = JSON.parse(canonical) as OpencodeConfig;
      config.model = active.model;
      for (const agent of Object.values(config.agent ?? {})) {
        if (agent.model) {
          agent.model = active.model;
          if (agent.provider) agent.provider = active.provider;
        }
      }
      session = JSON.stringify(config, null, 2) + '\n';
    }
  } catch {
    // Runtime ausente/ilegible: conservar el canon, nunca repararlo desde aquí.
  }
  const target = sessionConfigPath(root);
  mkdirSync(resolve(root, '.runtime', 'opencode'), { recursive: true });
  writeFileSync(target, session);
  return target;
}

/**
 * Restaura el canon si la flota está rota. Guarda snapshot forense del drift
 * antes de tocarlo. NO restaura drift legítimo (flota sana sobre modelos
 * registrados con tools): eso es un cambio intencional del owner.
 */
export function healOpencodeDrift(root: string): HealReport {
  const registry = loadRegistry(root);
  if (!registry) {
    return {
      healed: false,
      status: { kind: 'illegible', reason: 'registry ilegible' },
      detail:
        'config/model-health-registry.json ilegible — no se puede clasificar la flota; NO se restaura automáticamente',
    };
  }
  let raw: string | null = null;
  try {
    raw = readFileSync(resolve(root, 'opencode.json'), 'utf8');
  } catch {
    raw = null;
  }
  const status = classifyFleetStatus(raw, registry);
  if (status.kind !== 'drift' && status.kind !== 'illegible') {
    return { healed: false, status, detail: 'canon sano — nada que restaurar' };
  }

  // Snapshot forense del drift antes de sobrescribir (revisable en .runtime/).
  let snapshotPath: string | undefined;
  if (raw !== null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    snapshotPath = resolve(root, '.runtime', 'opencode', `drift-${ts}.json`);
    mkdirSync(resolve(root, '.runtime', 'opencode'), { recursive: true });
    writeFileSync(snapshotPath, raw);
  }

  // Restaurar el contenido de HEAD DIRECTO (git show + write), NO vía
  // `git checkout --`: checkout de paths dispara el hook post-checkout de
  // lefthook (health check de ~33s) — un heal en el autostart no puede
  // esperar eso ni colgar de él.
  const head = runSync('git', ['-C', root, 'show', 'HEAD:opencode.json'], { timeout: 15000 });
  if (head.status !== 0 || !head.stdout.trim()) {
    return {
      healed: false,
      status,
      snapshotPath,
      detail: `no se pudo leer HEAD:opencode.json (status ${head.status}) — restaurar a mano: git checkout -- opencode.json`,
    };
  }
  writeFileSync(resolve(root, 'opencode.json'), head.stdout);

  // Re-verificar: el canon restaurado DEBE estar sano.
  const after = classifyFleetStatus(readFileSync(resolve(root, 'opencode.json'), 'utf8'), registry);
  if (after.kind === 'drift' || after.kind === 'illegible') {
    return {
      healed: false,
      status: after,
      snapshotPath,
      detail:
        'canon en HEAD también está en deriva — registrar el modelo en el registry o corregir HEAD',
    };
  }
  return {
    healed: true,
    status: after,
    snapshotPath,
    detail:
      status.kind === 'drift'
        ? `flota restaurada desde HEAD (${status.problems.length} asignación(es) en deriva); snapshot forense: ${snapshotPath}`
        : `canon ilegible restaurado desde HEAD (${status.reason}); snapshot forense: ${snapshotPath}`,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

function printProblems(problems: AgentModelClassification['problems']): void {
  for (const problem of problems) {
    console.log(`   · ${problem.agent} → ${problem.model}: ${problem.reason}`);
  }
}

async function sessionEnd(): Promise<number> {
  const root = resolve(process.cwd());
  const report = healOpencodeDrift(root);
  console.log(`[opencode-session-end] ${report.detail}`);
  if (report.snapshotPath) console.log(`   snapshot: ${report.snapshotPath}`);
  // Reap de lo que OpenCode pudo dejar activo (duplicados, envejecidos,
  // pidfiles stale). Reciclaje de daemons envejecidos habilitado en cierre.
  const hygiene = await runHygiene({ apply: true, recycleAged: true });
  console.log(
    `[opencode-session-end] hygiene: ${hygiene.scanned} proceso(s) escaneados, ${hygiene.killed.length} reap(s), ${hygiene.cleanedFiles.length} pidfile(s) limpio(s)`,
  );
  return report.healed || report.status.kind === 'clean' ? 0 : 1;
}

function main(argv: string[]): number | undefined {
  const mode = argv.find((a) => a.startsWith('--'));
  const root = resolve(process.cwd());
  switch (mode) {
    case '--detect': {
      const registry = loadRegistry(root);
      if (!registry) {
        console.error('✗ registry ilegible — no se puede clasificar la flota');
        return 2;
      }
      let raw: string | null = null;
      try {
        raw = readFileSync(resolve(root, 'opencode.json'), 'utf8');
      } catch {
        raw = null;
      }
      const status = classifyFleetStatus(raw, registry);
      if (status.kind === 'clean') {
        console.log(`✓ flota sana: ${status.checked} agente(s) sobre modelos con capability tools`);
        return 0;
      }
      if (status.kind === 'drift') {
        console.log(
          `✗ flota en deriva: ${status.problems.length}/${status.checked} asignación(es):`,
        );
        printProblems(status.problems);
        return 1;
      }
      console.error(`✗ canon ilegible: ${status.reason}`);
      return 2;
    }
    case '--heal': {
      const report = healOpencodeDrift(root);
      console.log(`[opencode-heal] ${report.detail}`);
      return report.healed || report.status.kind === 'clean' ? 0 : 1;
    }
    case '--session-start': {
      const report = healOpencodeDrift(root);
      if (report.detail) console.log(`[opencode-session-start] ${report.detail}`);
      const target = writeSessionConfig(root);
      console.log(`[opencode-session-start] copia de sesión lista: ${target}`);
      console.log('[opencode-session-start] lanzar con: OPENCODE_CONFIG=<path> opencode');
      return 0;
    }
    case '--session-end':
      // Asíncrono: el exit real lo hace sessionEnd al terminar el reap.
      void sessionEnd()
        .then((code) => process.exit(code))
        .catch((error: unknown) => {
          console.error(`✗ session-end falló: ${(error as Error).message}`);
          process.exit(1);
        });
      return undefined;
    default:
      console.error(
        'Uso: opencode-session-scope.ts --detect | --heal | --session-start | --session-end',
      );
      return 2;
  }
}

// entrypoint: detecta cuando el script corre directamente (vs importado por tests).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const code = main(process.argv.slice(2));
  // undefined = modo asíncrono (session-end): el exit lo hace su promesa.
  if (code !== undefined) process.exit(code);
}
