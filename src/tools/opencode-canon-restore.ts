/**
 * opencode-canon-restore — el canon se VERIFICA contra el árbol que se push-ea.
 *
 * Incidente 2026-11-21 (bitácora de fricción): el working-tree de opencode.json
 * se drift-eó EN VIVO durante la sesión (perdió el agente e2e-agent) y el push
 * cayó en agent-reachability — el verificador leyó un árbol que el propio stack
 * había desviado. El heal del autostart (opencode-session-scope --heal) solo
 * restaura cuando la FLOTA está rota (modelos sin capability tools); este drift era
 * ESTRUCTURAL (un agente desaparecido) con flota "sana" — pasó el heal y reventó
 * en el push.
 *
 * Invariante nuevo (NORM-OPENCODE-001 §canon): en pre-push, el working-tree de
 * opencode.json debe ser IGUAL al canon de HEAD. Si difiere → snapshot forense
 * en .runtime/opencode/drift-prepush-<ts>.json + restauración desde HEAD, antes
 * de que los verificadores (agent-reachability, opencode-agent-model-drift)
 * lean la config.
 *
 * NORM-OPENCODE-001 ya declara que OpenCode nunca muta el canon y que las
 * ediciones legítimas se hacen EN el repo y se COMMITTEAN: un diff sin commit
 * contra HEAD es deriva por definición (la copia de sesión vive en
 * .runtime/opencode/ — gitignored — para lo que OpenCode necesite en sesión).
 *
 * Los verificadores del push llaman a restoreOpencodeCanon() al arrancar, así
 * el orden de lefthook (parallel) no importa: cada uno auto-sanea su entrada.
 *
 * Uso: node --import tsx src/tools/opencode-canon-restore.ts [--detect]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

export interface CanonRestoreReport {
  action: 'clean' | 'restored' | 'failed';
  detail: string;
  snapshotPath?: string;
}

/** Lee el canon de HEAD. null = ilegible/ausente (el llamador decide). */
function readCanonFromHead(root: string): string | null {
  const head = runSync('git', ['-C', root, 'show', 'HEAD:opencode.json'], { timeout: 15000 });
  if (head.status !== 0 || !head.stdout.trim()) return null;
  return head.stdout;
}

/** Normaliza EOL para no confundir autocrlf del checkout con drift real. */
const normalized = (s: string): string => s.replaceAll('\r\n', '\n');

/**
 * Restaura el canon de opencode.json desde HEAD si el working-tree difiere.
 * Snapshot forense ANTES de sobrescribir: nada se pierde sin copia.
 * `readHead` inyectable para tests (default: git show).
 */
export function restoreOpencodeCanon(
  root: string,
  readHead: () => string | null = () => readCanonFromHead(root),
): CanonRestoreReport {
  const head = readHead();
  const treePath = resolve(root, 'opencode.json');
  let raw: string | null = null;
  try {
    raw = readFileSync(treePath, 'utf8');
  } catch {
    raw = null; // archivo ausente en el árbol: restaurable
  }

  if (head === null) {
    if (raw === null) {
      return {
        action: 'clean',
        detail: 'sin opencode.json en HEAD ni en el árbol — nada que verificar',
      };
    }
    return {
      action: 'failed',
      detail:
        'no se pudo leer HEAD:opencode.json (sin commit o sin git) — NO se toca el árbol; restaurar a mano: git checkout -- opencode.json',
    };
  }

  if (raw !== null && normalized(raw) === normalized(head)) {
    return { action: 'clean', detail: 'working-tree idéntico al canon de HEAD' };
  }

  // Snapshot forense del drift antes de sobrescribir (revisable en .runtime/).
  let snapshotPath: string | undefined;
  if (raw !== null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    snapshotPath = resolve(root, '.runtime', 'opencode', `drift-prepush-${ts}.json`);
    mkdirSync(resolve(root, '.runtime', 'opencode'), { recursive: true });
    writeFileSync(snapshotPath, raw);
  }
  // Escritura directa (NO `git checkout --`): el checkout de paths dispara el
  // hook post-checkout de lefthook (health check de ~30s) — un paso del push
  // no puede colgar de eso (misma razón que opencode-session-scope.ts:133).
  writeFileSync(treePath, head);
  return {
    action: 'restored',
    detail:
      raw === null
        ? 'opencode.json AUSENTE en el árbol — recreado desde HEAD'
        : `working-tree en deriva vs HEAD — restaurado; snapshot forense: ${snapshotPath}`,
    snapshotPath,
  };
}

export interface CanonDriftReport {
  action: 'clean' | 'drift' | 'failed';
  detail: string;
  snapshotPath?: string;
}

/**
 * Modo DETECT (solo lectura): compara árbol vs HEAD y, en drift, persiste el
 * snapshot forense `drift-session-<ts>.json` — pero NUNCA toca el árbol. Es la
 * mitad "detectar" del enforcement del canon en cadencia de sesión (watchtower,
 * 2026-11-21): el overwrite ocurre solo en las fronteras (autostart phase 1 /
 * pre-push) — mismo criterio pasivo que uncommitted-actor-inventory (informa,
 * no borra; la edición intencional del owner sin commitear queda en el
 * snapshot, no se pierde).
 */
export function detectOpencodeCanonDrift(
  root: string,
  readHead: () => string | null = () => readCanonFromHead(root),
): CanonDriftReport {
  const head = readHead();
  let raw: string | null = null;
  try {
    raw = readFileSync(resolve(root, 'opencode.json'), 'utf8');
  } catch {
    raw = null;
  }
  if (head === null) {
    return {
      action: 'failed',
      detail: 'HEAD:opencode.json ilegible (sin commit o sin git) — no verificable',
    };
  }
  if (raw !== null && normalized(raw) === normalized(head)) {
    return { action: 'clean', detail: 'working-tree idéntico al canon de HEAD' };
  }
  let snapshotPath: string | undefined;
  if (raw !== null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    snapshotPath = resolve(root, '.runtime', 'opencode', `drift-session-${ts}.json`);
    mkdirSync(resolve(root, '.runtime', 'opencode'), { recursive: true });
    writeFileSync(snapshotPath, raw);
  }
  return {
    action: 'drift',
    detail:
      raw === null
        ? 'opencode.json AUSENTE en el árbol (HEAD lo tiene)'
        : 'working-tree EN DERIVA vs HEAD — snapshot forense en .runtime/opencode/; restaurar con: node --import tsx src/tools/opencode-canon-restore.ts',
    snapshotPath,
  };
}

function main(argv: string[]): number {
  const root = resolve(process.cwd());
  const detect = argv.includes('--detect');
  if (detect) {
    const report = detectOpencodeCanonDrift(root);
    const icon = report.action === 'clean' ? '✓' : report.action === 'drift' ? '✗' : '✗';
    console.log(
      `[canon-restore] ${icon} ${report.detail}${report.snapshotPath ? ` (snapshot: ${report.snapshotPath})` : ''}`,
    );
    return report.action === 'clean' ? 0 : 1;
  }
  const report = restoreOpencodeCanon(root);
  const icon = report.action === 'clean' ? '✓' : report.action === 'restored' ? '🔧' : '✗';
  console.log(`[canon-restore] ${icon} ${report.detail}`);
  return report.action === 'failed' ? 1 : 0;
}

// entrypoint: detecta cuando el script corre directamente (vs importado).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
