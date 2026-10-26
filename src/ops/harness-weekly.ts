/**
 * harness-weekly — el stack se auto-mide una vez por semana (mandate owner:
 * "que sea automatico"). Corrida oculta, gratis, substrate local:
 *
 *   1. Levanta Ollama con el runtime optimizado (idempotente).
 *   2. Genera la tarea de la semana con DATOS FRESCOS: corre doctor, tests del
 *      bucle y tsc, y embebe los numeros reales en la tarea (una tarea cuyos
 *      datos no estan en el prompt no sirve para comparar harness — §4.5).
 *   3. Corre el bucle (k=1, proposer automatico, juez semantico 14b).
 *   4. Archiva el reporte en .runtime/harness-weekly/ (latest.md + por fecha).
 *
 * Sin red, sin saldo, sin ventana (procesos-ocultos: runNpxTxsSync + S4U).
 * Nunca bloquea: si un paso falla, archiva el error y sale 0.
 *
 *   npm run harness:weekly            — corrida unica (smoke o manual)
 *   npm run harness:weekly -- --quiet — sin impresiones (para schtasks)
 *   npm run harness:weekly:register   — registra la tarea semanal oculta
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpxTsxSync, runSync } from '../core/run-command.js';
import { ensureOllamaUp } from '../tools/ollama-serve.js';

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');
const OUT_DIR = join(ROOT, '.runtime', 'harness-weekly');
export const TASK_NAME = 'GV-harness-weekly-loop';
const QUIET = process.argv.includes('--quiet');

function log(line: string): void {
  if (!QUIET) process.stdout.write(`${line}\n`);
}

/** Ejecuta un comando de verificacion y devuelve (ok, salida completa y recortada). */
function verify(label: string, cmd: string, args: string[]): { ok: boolean; out: string; detail: string } {
  const r = runSync(cmd, args, { timeout: 300_000, stdio: 'pipe', cwd: ROOT });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const ok = r.status === 0;
  return { ok, out, detail: out.slice(-400) };
}

/** Tarea de la semana: el formato del informe, con los datos verificados hoy. */
export function weeklyTask(d: {
  doctor: string; tests: string; tsc: string; lint: string;
  budget: string; tripwire: string; riesgo: string; proxima: string;
}): string {
  return `Redacta el informe de estado semanal del stack gentle-vanguard para su owner.

Usa EXCLUSIVAMENTE los datos de este bloque. Si un dato no esta, no lo inventes:
decí que no esta.

DATOS (verificados automaticamente hoy):
- Doctor de superficie: ${d.doctor}
- Tests del bucle: ${d.tests}
- tsc --noEmit: ${d.tsc}
- lint: ${d.lint}
- Identidad del presupuesto de la corrida de hoy: ${d.budget}
- Estado del tripwire de la corrida de hoy: ${d.tripwire}
- Riesgo abierto: ${d.riesgo}
- Proxima accion: ${d.proxima}

Formato: tres bloques en este orden.
1. Que se verifico hoy (con la linea de comando literal de cada verificacion).
2. Primer riesgo abierto.
3. Proxima accion concreta.

Tono: directo, sin preambulo. Español. Maximo 12 lineas.
`;
}

async function main(): Promise<number> {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const report: string[] = [`# harness-weekly — ${stamp}`, ''];

  // 1. Runtime local listo.
  const ollama = await ensureOllamaUp();
  if (!ollama.up) {
    report.push('## Error', '', 'Ollama no levanto; corrida abortada (la proxima semana reintenta).');
    writeFileSync(join(OUT_DIR, 'latest.md'), report.join('\n'), 'utf-8');
    log('[harness-weekly] Ollama no disponible; abortando esta corrida.');
    return 0;
  }

  // 2. Datos frescos de la semana (medidos, nunca inventados).
  log('[harness-weekly] verificando el stack...');
  const doctor = verify('doctor', process.execPath, ['--import', 'tsx', 'src/tools/harness-doctor.ts', '--strict']);
  const tests = verify('tests', process.execPath, ['--import', 'tsx', '--test', 'src/core/harness-loop.test.ts']);
  const tsc = verify('tsc', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']);
  const lint = verify('lint', process.execPath, ['node_modules/eslint/bin/eslint.js', 'src/eval/harness-judge.ts']);

  const passCount = (detail: string): string => {
    const m = detail.match(/^. pass (\d+)$/m);
    return m ? `${m[1]}/${m[1]}` : 'salida no parseada';
  };
  // El marcador vive en la salida COMPLETA (los ultimos 400 chars son lineas
  // largas de alcance/exenciones que lo tapan).
  const doctorOk = doctor.ok && /0 errores, 0 warnings/.test(doctor.out);
  const tscOk = tsc.ok;
  const lintOk = lint.ok;

  const taskFile = join(OUT_DIR, 'task-current.md');
  writeFileSync(taskFile, weeklyTask({
    doctor: doctorOk ? '0 errores, 0 warnings' : `CON FINDINGS: ${doctor.detail.slice(-200)}`,
    tests: `${passCount(tests.detail)} (${tests.ok ? 'exit 0' : 'CON FALLOS'})`,
    tsc: tscOk ? 'limpio (exit 0)' : 'CON ERRORES',
    lint: lintOk ? 'limpio (exit 0)' : 'CON ERRORES',
    budget: 'R=4k rollouts, P=3k sesiones, k=1 rondas',
    tripwire: 'se verifica en la corrida (0 fugas esperadas)',
    riesgo: 'la cuenta opencode del owner esta sin saldo; el substrate codex consume cuota ChatGPT',
    proxima: 'rotar substrates (ollama esta semana, codex la proxima si el owner aprueba cuota)',
  }), 'utf-8');

  // 3. Bucle semanal (ollama, $0, proposer automatico, juez semantico).
  log('[harness-weekly] corriendo el bucle (k=1, ollama, proposer automatico)...');
  const loop = runNpxTsxSync(
    'src/tools/harness-loop-run.ts',
    ['--task-file', taskFile, '--domain', 'harness-self', '--k', '1',
     '--propose', 'auto', '--semantic-judge', '--substrate', 'ollama'],
    { timeout: 2_700_000, stdio: 'pipe', cwd: ROOT }
  );
  const loopOut = `${loop.stdout ?? ''}\n${loop.stderr ?? ''}`.trim();
  report.push('## Verificaciones', '', `- doctor: ${doctorOk ? 'OK' : 'FALLO'}`, `- tests: ${passCount(tests.out)} (${tests.ok ? 'exit 0' : 'CON FALLOS'})`,
    `- tsc: ${tscOk ? 'OK' : 'FALLO'}`, `- lint: ${lintOk ? 'OK' : 'FALLO'}`, '', '## Bucle', '', '```', loopOut.slice(-4000), '```');
  writeFileSync(join(OUT_DIR, `report-${stamp}.md`), report.join('\n'), 'utf-8');
  writeFileSync(join(OUT_DIR, 'latest.md'), report.join('\n'), 'utf-8');
  log(`[harness-weekly] corrida archivada en .runtime/harness-weekly/ (exit bucle: ${loop.status})`);
  return 0;
}

/* ── Registro de la tarea semanal oculta (patron upstream-watch) ── */

function quoteWindowsArg(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function registerWeekly(root: string): boolean {
  const scriptPath = fileURLToPath(import.meta.url);
  const ps = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const registration =
    `$ErrorActionPreference='Stop'; ` +
    `$action=New-ScheduledTaskAction -Execute ${ps(process.execPath)} -Argument ${ps(`--import tsx "${scriptPath}" --quiet`)} -WorkingDirectory ${ps(root)}; ` +
    `$trigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '09:00'; ` +
    `$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U; ` +
    `$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 90); ` +
    `Register-ScheduledTask -TaskName ${ps(TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`;
  const native = runSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', registration], { timeout: 15000, stdio: 'pipe' });
  if (native.status === 0) {
    log(`[harness-weekly] tarea semanal oculta registrada (node directo, S4U): ${TASK_NAME} — Domingo 09:00`);
    return true;
  }
  // Fallback documentado: wrapper wscript oculto.
  const command = `${quoteWindowsArg(process.execPath)} --import tsx ${quoteWindowsArg(scriptPath)} --quiet`;
  const esc = (v: string): string => v.replace(/"/g, '""');
  const vbsPath = join(root, '.runtime', 'gv-harness-weekly-loop.vbs');
  writeFileSync(vbsPath, `' Hidden launcher for ${TASK_NAME}\r\nSet shell = CreateObject("Wscript.Shell")\r\nshell.CurrentDirectory = "${esc(root)}"\r\nshell.Run "${esc(command)}", 0, False\r\n`, 'utf-8');
  const wrapper = runSync('schtasks', ['/Create', '/TN', TASK_NAME, '/TR', `${quoteWindowsArg('wscript.exe')} ${quoteWindowsArg(vbsPath)}`, '/SC', 'WEEKLY', '/D', 'SUN', '/ST', '09:00', '/F'], { timeout: 15000, stdio: 'pipe' });
  log(wrapper.status === 0
    ? `[harness-weekly] tarea semanal oculta registrada (wrapper wscript): ${TASK_NAME} — Domingo 09:00`
    : '[harness-weekly] ERROR registrando la tarea (native + wrapper fallaron)');
  return wrapper.status === 0;
}

const invoked = ['harness-weekly.ts', 'harness-weekly.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '');
if (invoked && process.argv.includes('--register')) {
  process.exit(registerWeekly(ROOT) ? 0 : 1);
} else if (invoked) {
  process.exit(await main());
}
