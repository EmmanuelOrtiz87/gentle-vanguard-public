#!/usr/bin/env node
/**
 * upstream-watch — watcher autónomo de evolución upstream (mandate owner 2026-10-21:
 * "dejemos todo autónomo, autoaprendido, autorregistrado, autoevolucionado").
 *
 * Que hace: cada corrida (semanal, tarea oculta) hace 1 GET por URL viva declarada en
 * config/upstream-watch.json, calcula la firma sha256 del contenido y compara contra
 * `.runtime/upstream-watch/state.json`. Si un source cambió desde la última corrida
 * REPORTADA:
 *   1. auto-abre un ticket en Nexus backlog (task/gap) con la evidencia (auto-registro)
 *   2. appendea `.runtime/upstream-watch/alerts.md` con las URLs y el doc de absorción
 *   3. actualiza el state (no re-abre el ticket la próxima semana: sólo 1 alerta por drift)
 *
 * Primera corrida: sólo graba state sin alertar (baseline inicial).
 * Sin red / source falla: exit 0 silencioso (la próxima corrida reintenta; nunca bloquea).
 *
 * Egress LOCAL-FIRST (ADR-0017): mínimo, semanal, declarado en el config — es el precio
 * de que el stack se aprenda solo las evoluciones de sus fuentes de verdad.
 *
 * Uso:
 *   npm run upwatch               — corrida única (smoke o manual)
 *   npm run upwatch -- --quiet    — ninguna impresión (para schtasks)
 *   npm run upwatch:register      — registra tarea semanal oculta (Lunes 08:00)
 *
 * procesos-ocultos: registro igual que ctx7-digest (node directo → fallback wscript vbs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runSync } from '../../adapters/command-runner.js';
import { runNpxTsxSync } from '../core/run-command.js';

const TASK_NAME = 'GV-upstream-weekly-watch';

export interface WatchSource { id: string; label: string; urls: string[]; absorptionDoc?: string; format?: 'github-release' }
interface WatchConfig { version: number; sources: WatchSource[] }
export interface SourceState { id: string; sig: string; changedAt: string }
export interface WatchState { version: 1; checkedAt: string; sources: SourceState[] }

// ------------------------------------------------------------- firma + diff (puros, tests)

/** Firma de un source: sha256 del contenido concatenado, normalizado CRLF→LF. */
export function sourceSig(contents: string[]): string {
  const h = createHash('sha256');
  for (const c of contents) h.update(c.replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 16);
}

/** Sources cuyo sig cambió respecto al state previo (sólo los ya conocidos). */
export function changedSources(prev: SourceState[], next: SourceState[]): string[] {
  const map = new Map(prev.map((s) => [s.id, s.sig]));
  return next.filter((n) => { const p = map.get(n.id); return p !== undefined && p !== n.sig; }).map((n) => n.id);
}

export function buildAlertBody(source: WatchSource, prevSig: string, nextSig: string, date: string): string[] {
  return [
    `## ${date} — ${source.id} (${source.label})`,
    `sig previa: ${prevSig} → sig actual: ${nextSig}`,
    ...source.urls.map((u) => `- ${u}`),
    source.absorptionDoc ? `doc de absorción vigente: ${source.absorptionDoc}` : '(sin doc de absorción declarada)',
    'Acción: fetch de las URLs, diff conceptual contra el doc vigente, decidir absorción (parche/docs) y cerrar el ticket con la nota.',
    '',
  ];
}

// ---------------------------------------------------------------- entrega auto-registro

function openBacklogTicket(sourceId: string, body: string, root: string): { ok: boolean; detail: string } {
  const title = `upstream-watch: drift en '${sourceId}' — evaluar absorción`;
  const r = runNpxTsxSync(
    fileURLToPath(new URL('../cli/backlog.ts', import.meta.url)),
    ['add', '--title', title, '--type', 'gap', '--description', body, '--source', 'upstream-watch', '--tags', `upstream,${sourceId}`],
    { timeout: 15000, cwd: root, stdio: 'pipe' },
  );
  const out = `${r.stdout?.toString() ?? ''}${r.stderr?.toString() ?? ''}`;
  const ok = r.status === 0 && /BL-[A-Z0-9]+-[A-Z0-9]+/.test(out);
  return { ok, detail: ok ? out.match(/BL-[A-Z0-9]+-[A-Z0-9]+/)![0] : out.trim().slice(0, 200) || `exit ${r.status}` };
}

// ------------------------------------------------------------------------ main

export function releaseContent(raw: string): string {
  const release = JSON.parse(raw);
  if (typeof release.tag_name !== 'string' || !release.tag_name) throw new Error('Invalid release metadata');
  return JSON.stringify({ tag: release.tag_name, target: release.target_commitish,
    publishedAt: release.published_at, body: release.body, url: release.html_url });
}

export async function runUpstreamWatch(argv: readonly string[], dependencies: {
  root?: string; fetch?: typeof fetch; deliver?: (source: string, body: string) => { ok: boolean; detail: string };
} = {}): Promise<number> {
  const ROOT = resolve(dependencies.root ?? process.cwd());
  const CONFIG_PATH = join(ROOT, 'config', 'upstream-watch.json');
  const STATE_PATH = join(ROOT, '.runtime', 'upstream-watch', 'state.json');
  const ALERTS_PATH = join(ROOT, '.runtime', 'upstream-watch', 'alerts.md');
  const fetchSource = dependencies.fetch ?? fetch;
  const deliver = dependencies.deliver ?? ((id, body) => openBacklogTicket(id, body, ROOT));
  const quiet = argv.includes('--quiet');
  const log = (m: string) => { if (!quiet) console.error(m); };

  if (!existsSync(CONFIG_PATH)) { log('[upwatch] sin config/upstream-watch.json — nada'); return 0; }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as WatchConfig;
  if (!Array.isArray(cfg.sources) || cfg.sources.length === 0) { log('[upwatch] config sin sources'); return 0; }

  const state: WatchState = existsSync(STATE_PATH)
    ? (JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as WatchState)
    : { version: 1, checkedAt: '', sources: [] };
  const now = new Date().toISOString();

  const nextStates: SourceState[] = [];
  const drifts: Array<{ source: WatchSource; prevSig: string; nextSig: string }> = [];
  let fetched = 0;
  let failedFetches = 0;
  let failedDeliveries = 0;

  for (const source of cfg.sources) {
    const contents: string[] = [];
    let failed = false;
    for (const url of source.urls) {
      try {
        const res = await fetchSource(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'gv-upstream-watch/1' } });
        if (!res.ok) { failed = true; break; }
        const text = await res.text();
        contents.push(source.format === 'github-release' ? releaseContent(text) : text);
        fetched++;
      } catch {
        failed = true;
        break;
      }
    }
    if (failed || contents.length < source.urls.length) {
      failedFetches++;
      log(`[upwatch] ⚠️ ${source.id}: fetch incompleto (${contents.length}/${source.urls.length}) — reintentará la próxima corrida`);
      const keep = state.sources.find((s) => s.id === source.id);
      if (keep) nextStates.push(keep); // conserva el state previo (sin alerta falsa)
      continue;
    }
    const sig = sourceSig(contents);
    const prev = state.sources.find((s) => s.id === source.id);
    nextStates.push({ id: source.id, sig, changedAt: now });
    log(`[upwatch] ${prev && prev.sig !== sig ? '🔁' : '·'} ${source.id}: ${prev?.sig ?? 'baseline'} → ${sig}`);
    if (prev && prev.sig !== sig) drifts.push({ source, prevSig: prev.sig, nextSig: sig });
  }

  // auto-registro: 1 backlog ticket por drift (sólo los del state previo; baseline no alerta)
  for (const d of drifts) {
    const body = buildAlertBody(d.source, d.prevSig, d.nextSig, now.slice(0, 10)).join('\n');
    mkdirSync(join(ROOT, '.runtime', 'upstream-watch'), { recursive: true });
    appendFileSync(ALERTS_PATH, body, 'utf-8');
    let t: { ok: boolean; detail: string };
    try { t = deliver(d.source.id, body); } catch (error) { t = { ok: false, detail: String(error) }; }
    if (!t.ok) {
      failedDeliveries++;
      const old = state.sources.find(s => s.id === d.source.id);
      const at = nextStates.findIndex(s => s.id === d.source.id);
      if (old && at >= 0) nextStates[at] = old; // Only acknowledged delivery advances the baseline.
    }
    log(`[upwatch] ${t.ok ? 'registrado' : 'pendiente; se reintentará'} (${d.source.id}): ${t.detail}`);
  }

  state.checkedAt = now;
  state.sources = nextStates;
  mkdirSync(join(ROOT, '.runtime', 'upstream-watch'), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  writeFileSync(join(ROOT, '.runtime', 'upstream-watch', 'last-run.json'), JSON.stringify({
    checkedAt: now, status: failedFetches || failedDeliveries ? 'degraded' : 'pass',
    fetched, drifts: drifts.length, failedFetches, failedDeliveries,
  }, null, 2));
  log(`[upwatch] state actualizado (${fetched} fetches, ${drifts.length} drift(s))`);
  return drifts.length > 0 ? 0 : 0; // siempre 0: el watcher nunca rompe el pipeline; el drift vive en Nexus
}

// ------------------------------------------------------------------ scheduling

function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildVbs(taskName: string, scriptPath: string, root: string): string {
  const command = `${quoteWindowsArg(process.execPath)} --import tsx ${quoteWindowsArg(scriptPath)} --quiet`;
  const esc = (v: string): string => v.replace(/"/g, '""');
  return (
    `' Hidden launcher for ${taskName} (pattern: src/infrastructure/bootstrap.ts)\r\n` +
    `Set shell = CreateObject("Wscript.Shell")\r\n` +
    `shell.CurrentDirectory = "${esc(root)}"\r\n` +
    `shell.Run "${esc(command)}", 0, False\r\n`
  );
}

export function registerWeekly(root: string, runCommand: typeof runSync = runSync): boolean {
  const scriptPath = fileURLToPath(import.meta.url);
  mkdirSync(join(root, '.runtime'), { recursive: true });
  const ps = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const registration = `$ErrorActionPreference='Stop'; ` +
    `$action=New-ScheduledTaskAction -Execute ${ps(process.execPath)} -Argument ${ps(`--import tsx "${scriptPath}" --quiet`)} -WorkingDirectory ${ps(root)}; ` +
    `$trigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '08:00'; ` +
    `$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U; ` +
    `$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5); ` +
    `Register-ScheduledTask -TaskName ${ps(TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`;
  const native = runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', registration], { timeout: 15000, stdio: 'pipe' });
  if (native.status === 0) {
    console.log(`[upwatch] tarea semanal oculta registrada (node directo, S4U): ${TASK_NAME} — Lunes 08:00`);
    return true;
  }
  const vbsPath = join(root, '.runtime', 'gv-upstream-weekly-watch.vbs');
  writeFileSync(vbsPath, buildVbs(TASK_NAME, scriptPath, root), 'utf-8');
  const wrapper = runCommand('schtasks', ['/Create', '/TN', TASK_NAME, '/TR', `${quoteWindowsArg('wscript.exe')} ${quoteWindowsArg(vbsPath)}`, '/SC', 'WEEKLY', '/D', 'MON', '/ST', '08:00', '/F'], { timeout: 15000, stdio: 'pipe' });
  console.log(wrapper.status === 0
    ? `[upwatch] tarea semanal oculta registrada (wrapper wscript): ${TASK_NAME} — Lunes 08:00`
    : `[upwatch] ERROR registrando tarea (native + wrapper fallaron) — correr manual: npm run upwatch`);
  return wrapper.status === 0;
}

const invoked = ['upstream-watch.ts', 'upstream-watch.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '');
if (invoked) {
  const argv = process.argv.slice(2);
  if (argv.includes('--register-weekly')) {
    process.exitCode = registerWeekly(resolve(process.cwd())) ? 0 : 1;
  } else {
    runUpstreamWatch(argv)
      .then((c) => { process.exitCode = c; })
      .catch((e: unknown) => {
        console.error(`[upwatch] fatal: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
      });
  }
}
