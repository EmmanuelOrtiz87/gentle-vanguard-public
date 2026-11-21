/**
 * agent-reachability.ts — ningún agente registrado puede quedar archivado.
 *
 * POR QUÉ (2026-11-20)
 * ---------------------------------------------------------------------------
 * El owner preguntó si el agente de narración estaba "archivado". Medido: de los
 * 21 agentes de `config/agents.json`, 20 estaban en el roster de
 * `config/auto-delegation.json` (`_meta.availableAgents`) y 22 estaban en
 * `opencode.json` — pero el que sobraba era justo el que faltaba:
 * `editorial-agent`. No estaba en ninguno de los dos registros.
 *
 * working: el agente SÍ se despachaba (por `recommend-agent` → `agent-delegator`),
 * pero cualquier ruta que valida contra el roster o contra `opencode.json` —como
 * dice el propio `_meta.enforcement` de la config— no lo encontraba. Un agente
 * que existe, funciona y no se puede alcanzar es un agente archivado a medias.
 *
 * QUÉ CHEQUEA (gate, exit 1 si algo falla)
 * ---------------------------------------------------------------------------
 * 1. Todo agente de `config/agents.json` está en `_meta.availableAgents`.
 * 2. Todo agente de `config/agents.json` está en el registro de `opencode.json`.
 * 3. Todo nombre de `_meta.availableAgents` existe en `config/agents.json`.
 *
 * Uso: node --import tsx src/ops/agent-reachability.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreOpencodeCanon } from '../tools/opencode-canon-restore.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface AgentsFile {
  agents: Record<string, { name?: string }>;
}
interface AutoDelegationFile {
  _meta?: { availableAgents?: string[]; availableCodes?: string[] };
}
interface OpencodeFile {
  agent?: Record<string, unknown>;
}

function readJson<T>(relative: string): T | undefined {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, relative), 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

export interface ReachabilityReport {
  registered: string[];
  inRoster: string[];
  inOpencode: string[];
  missingFromRoster: string[];
  missingFromOpencode: string[];
  rosterWithoutRegistration: string[];
  ok: boolean;
}

export function checkReachability(
  agents: AgentsFile | undefined,
  auto: AutoDelegationFile | undefined,
  opencode: OpencodeFile | undefined,
): ReachabilityReport {
  const registered = Object.keys(agents?.agents ?? {});
  const inRoster = auto?._meta?.availableAgents ?? [];
  const inOpencode = Object.keys(opencode?.agent ?? {});

  const missingFromRoster = registered.filter((name) => !inRoster.includes(name));
  const missingFromOpencode = registered.filter((name) => !inOpencode.includes(name));
  const rosterWithoutRegistration = inRoster.filter((name) => !registered.includes(name));

  return {
    registered,
    inRoster,
    inOpencode,
    missingFromRoster,
    missingFromOpencode,
    rosterWithoutRegistration,
    ok:
      missingFromRoster.length === 0 &&
      missingFromOpencode.length === 0 &&
      rosterWithoutRegistration.length === 0,
  };
}

export function formatReport(report: ReachabilityReport): string {
  const lines: string[] = [];
  lines.push(
    `[agent-reachability] ${report.registered.length} agentes registrados · ` +
      `${report.inRoster.length} en el roster · ${report.inOpencode.length} en opencode.json`,
  );
  if (report.missingFromRoster.length)
    lines.push(
      `  FALLA · no están en el roster (auto-delegation): ${report.missingFromRoster.join(', ')}`,
    );
  if (report.missingFromOpencode.length)
    lines.push(`  FALLA · no están en opencode.json: ${report.missingFromOpencode.join(', ')}`);
  if (report.rosterWithoutRegistration.length)
    lines.push(
      `  FALLA · en el roster pero sin registro en config/agents.json: ${report.rosterWithoutRegistration.join(', ')}`,
    );
  if (report.ok) lines.push('  OK: todo agente registrado es alcanzable.');
  return lines.join('\n');
}

function main(): void {
  // El verificador auto-sanea su entrada (bitácora 2026-11-21): si el
  // working-tree de opencode.json se drift-eó en vivo, verificar contra él
  // sería certificar mentiras. Restaurar desde HEAD antes de leer.
  const canon = restoreOpencodeCanon(resolve(ROOT));
  if (canon.action !== 'clean') console.log(`[agent-reachability] ${canon.detail}`);
  const report = checkReachability(
    readJson<AgentsFile>('config/agents.json'),
    readJson<AutoDelegationFile>('config/auto-delegation.json'),
    readJson<OpencodeFile>('opencode.json'),
  );
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].includes('agent-reachability')) main();
