/**
 * check-models — check de alineación de ids de modelo para el prepush-gate.
 *
 * Falla (exit 1) SOLO si hay ids configurados que no existen upstream (la causa
 * del `Bad Request: {"model": "..."}`). Es fail-open: si no hay conectividad al
 * upstream (o auth), avisa y sale 0 para no bloquear pushes offline.
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
    console.log('[models-alignment] ⚠ no pude leer el reporte del doctor — verificación omitida (fail-open)');
    process.exit(0);
  }

  const providers = (report.providers ?? []).filter((p) => p.catalogOK);
  if (providers.length === 0) {
    console.log('[models-alignment] ⚠ sin conectividad/auth contra el upstream — verificación omitida (fail-open)');
    process.exit(0);
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
