/**
 * check-models — check de alineación de ids de modelo para el prepush-gate.
 *
 * Códigos de salida (meta-auditoría 2026-11-20, backlog #5 — antes era
 * fail-open silencioso: sin red salía 0 y el gate lo contaba como PASS verde):
 *   0 → OK: todos los ids configurados existen upstream.
 *   1 → BLOQUEANTE: hay ids configurados que NO existen upstream.
 *   2 → INDETERMINADO: no se pudo mirar (sin reporte del doctor, sin
 *       conectividad/auth al upstream). NO bloquea el push offline, pero el
 *       gate lo muestra como `warn` — nunca como verde silencioso.
 *
 * Uso: node --import tsx src/git/check-models.ts
 */
import { runNpxTsxSync } from '../core/run-command.js';

interface DoctorProvider {
  id: string;
  catalogOK?: boolean;
  upstreamCatalog?: string[];
  configuredCatalog?: string[];
  missingInUpstream?: string[];
}

interface DoctorJson {
  configPath?: string;
  providers?: DoctorProvider[];
}

function main(): void {
  const doctor = runNpxTsxSync('src/tools/opencode-model-doctor.ts', ['--json'], { timeout: 240_000 });
  let report: DoctorJson;
  try {
    report = JSON.parse(doctor.stdout) as DoctorJson;
  } catch {
    console.log('[models-alignment] ~ INDETERMINADO: no pude leer el reporte del doctor — ids NO verificados contra upstream (sin bloqueo offline)');
    process.exit(2);
  }

  const providers = (report.providers ?? []).filter((p) => p.catalogOK);
  if (providers.length === 0) {
    console.log('[models-alignment] ~ INDETERMINADO: sin conectividad/auth contra el upstream — ids NO verificados (sin bloqueo offline)');
    process.exit(2);
  }

  const problemas: string[] = [];
  for (const p of providers) {
    const stale = p.missingInUpstream ?? [];
    if (stale.length > 0) {
      problemas.push(`  ✗ ${p.id}: ${stale.length} id(s) inexistente(s) → ${stale.slice(0, 6).join(', ')}${stale.length > 6 ? ' …' : ''}`);
    }
  }

  if (problemas.length > 0) {
    console.error('[models-alignment] ✗ BLOQUEADO: hay ids de modelo configurados que no existen upstream');
    console.error(`'Uso: npm run models:sync -- --dry' para ver el plan, o 'npm run models:sync' para alinearlo (backup automático).`);
    console.error(problemas.join('\n'));
    process.exit(1);
  }

  const verificados = providers.reduce((acc, p) => acc + (p.configuredCatalog?.length ?? 0), 0);
  console.log(`[models-alignment] ✓ OK: ${verificados} id(s) configurados en ${providers.length} proveedor(es), todos existen upstream`);
  if (report.configPath) console.log(`  config: ${report.configPath}`);
  process.exit(0);
}

main();
