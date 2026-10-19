/**
 * models-sync — alinea el catálogo de modelos de la configuración de opencode con
 * el upstream REAL (`GET /v1/models`), tomando como fuente al opencode-model-doctor.
 *
 * Motivo: la config global (`~/.config/opencode/opencode.json`) tenía 69 modelos
 * listados por proveedor zen de los cuales 42 NO existen upstream; pedir cualquiera
 * de esos devuelve `Bad Request: {"model":"<fantasma>"}`.
 *
 * Uso:
 *   npx tsx src/tools/models-sync.ts                 # backupea y poda los stale
 *   npx tsx src/tools/models-sync.ts --dry           # sólo muestra qué haría
 *   npx tsx src/tools/models-sync.ts --add-missing   # además agrega los del upstream
 *   npx tsx src/tools/models-sync.ts --fix-active-model  # si `model` es stale, lo corrige
 *   npx tsx src/tools/models-sync.ts --config <ruta> --active opencode-zen-C/big-pickle
 *
 * Nunca toca archivos del repo: actúa sobre la config de opencode (con backup).
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runNpxTsxSync } from '../core/run-command.js';

interface DoctorProvider {
  id: string;
  upstreamCatalog?: string[];
  configuredCatalog?: string[];
  missingInUpstream?: string[];
  extrasInUpstream?: string[];
  catalogOK?: boolean;
}

interface DoctorJson {
  configPath: string;
  providers: DoctorProvider[];
}

interface ModelEntry {
  name?: string;
  [k: string]: unknown;
}

interface OpencodeConfig {
  model?: string;
  small_model?: string;
  provider?: Record<string, { models?: Record<string, ModelEntry>; [k: string]: unknown }>;
  [k: string]: unknown;
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const addMissing = args.includes('--add-missing');
const fixActive = args.includes('--fix-active-model');
const argValue = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const CANONICAL = argValue('--active') ?? 'opencode-zen-C/big-pickle';

function fail(msg: string): never {
  console.error(`[models-sync] ${msg}`);
  process.exit(1);
}

function main(): void {
  console.log('[models-sync] consultando el doctor de modelos…');
  const doctor = runNpxTsxSync('src/tools/opencode-model-doctor.ts', ['--json'], { timeout: 240_000 });
  // El doctor sale con código 1 justamente cuando encuentra modelos stale en la
  // config (que es el caso a reparar): sólo es error si no hay JSON en stdout.
  let report: DoctorJson;
  try {
    report = JSON.parse(doctor.stdout) as DoctorJson;
  } catch {
    fail(`el doctor no devolvió JSON (status ${doctor.status}): ${(doctor.stderr ?? doctor.stdout ?? '').slice(0, 300)}`);
  }

  const configPath = argValue('--config') ?? report.configPath;
  if (!configPath || !existsSync(configPath)) fail(`no encuentro la config: ${configPath}`);

  const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as OpencodeConfig;
  const providers = cfg.provider ?? {};

  let removedTotal = 0;
  let addedTotal = 0;
  const lines: string[] = [];

  for (const p of report.providers) {
    const local = providers[p.id];
    if (!local?.models) continue;
    if (!p.catalogOK) {
      lines.push(`  · ${p.id}: catálogo upstream no disponible → sin cambios`);
      continue;
    }
    const upstream = new Set(p.upstreamCatalog ?? []);
    const configured = Object.keys(local.models);
    const stale = configured.filter((m) => !upstream.has(m));
    const missing = (p.upstreamCatalog ?? []).filter((m) => !configured.includes(m));

    if (stale.length > 0) {
      for (const m of stale) delete local.models[m];
      removedTotal += stale.length;
    }
    if (addMissing) {
      for (const m of missing) {
        local.models[m] = { name: m };
        addedTotal++;
      }
    }
    lines.push(
      `  · ${p.id}: ${configured.length} configurados → ${Object.keys(local.models).length}` +
        ` (stale removidos: ${stale.length}${stale.length ? ' [' + stale.slice(0, 4).join(', ') + (stale.length > 4 ? '…' : '') + ']' : ''})` +
        (addMissing ? ` | agregados: ${missing.length}` : ` | faltantes en config: ${missing.length} (usá --add-missing)`),
    );
  }

  // Modelo activo (¿existe upstream en su proveedor?)
  const active = cfg.model;
  const activeProvider = active ? report.providers.find((p) => active.startsWith(p.id + '/')) : undefined;
  const activeModel = active && activeProvider ? active.slice(activeProvider.id.length + 1) : undefined;
  const activeIsStale = Boolean(
    active && activeProvider && activeModel && !(activeProvider.upstreamCatalog ?? []).includes(activeModel),
  );

  console.log('\n[models-sync] plan:');
  console.log(lines.join('\n') || '  (sin proveedores locales que sincronizar)');
  console.log(`\n[models-sync] config: ${configPath}`);
  if (active) console.log(`[models-sync] model activo: ${active}${activeIsStale ? '  ← STALE' : activeProvider ? '  ✔' : '  (proveedor sin catálogo)'}`);

  if (activeIsStale) {
    if (fixActive) {
      cfg.model = CANONICAL;
      console.log(`[models-sync] model activo → ${CANONICAL}`);
    } else {
      console.log('[models-sync] ⚠ el model activo es stale: usá --fix-active-model para pasarlo a ' + CANONICAL);
    }
  }

  if (removedTotal === 0 && addedTotal === 0 && !(activeIsStale && fixActive)) {
    console.log('\n[models-sync] nada que hacer: catálogo ya alineado ✔');
    return;
  }

  if (dry) {
    console.log(`\n[models-sync] (dry-run) se habrían quitado ${removedTotal} y agregado ${addedTotal}`);
    return;
  }

  const backup = `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(configPath, backup);
  JSON.parse(JSON.stringify(cfg)); // valida el objeto antes de serializar
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`\n[models-sync] ✔ aplicado — quitados: ${removedTotal}, agregados: ${addedTotal}`);
  console.log(`[models-sync] backup: ${backup}`);
}

main();
