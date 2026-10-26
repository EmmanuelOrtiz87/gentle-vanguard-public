/** Evidence inventory, not a performance ranking. File presence never proves execution. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type EvidenceLevel = 'unverified' | 'declared' | 'connected' | 'executed' | 'reproduced';
export interface Row { dimension: string; level: EvidenceLevel; evidence: string; source: string }
const surfaces = [
  ['Agentes', 'config/agents.json'],
  ['Quality gates', 'config/universal-quality-gate.json'],
  ['Revisión RDD', 'src/rdd/receipt-contract.ts'],
  ['Aprendizaje', 'src/tools/auto-norm-learner.ts'],
  ['Vigilancia upstream', 'src/ops/upstream-watch.ts'],
  ['Integración de clientes', 'src/integrations/tool-interoperability-audit.ts'],
  ['Seguridad', 'rules/NORMATIVAS-AUTONOMOUS-EVOLUTION.md'],
  ['SDD opt-in', 'skills/sdd-lifecycle/SKILL.md'],
] as const;

export function buildRows(root: string): Row[] {
  return surfaces.map(([dimension, source]) => {
    const present = existsSync(join(root, source));
    let evidence = present ? 'Archivo presente; no prueba conexión ni ejecución.' : 'Sin evidencia local en esta ruta.';
    if (dimension === 'Agentes' && present) {
      try {
        const agents = JSON.parse(readFileSync(join(root, source), 'utf8')).agents;
        if (!agents || typeof agents !== 'object') throw new Error('agents inválido');
        evidence = `${Object.keys(agents).length} agentes declarados; no acredita ejecución de sus modelos.`;
      } catch { return { dimension, source, level: 'unverified', evidence: 'Configuración ilegible o sin agents.' }; }
    }
    return { dimension, source, level: present ? 'declared' : 'unverified', evidence };
  });
}

// Existing consumers can still import rows; no synthetic scores.
export const rows = buildRows(process.cwd());

export function render(inventory = rows): string {
  const declared = inventory.filter(row => row.level === 'declared').length;
  return `# Comparativa por evidencia — Gentle-Vanguard y Gentle-AI

No establece paridad ni superioridad de capacidad o rendimiento.
Inventario local: ${declared}/${inventory.length} superficies declaradas. El denominador es el inventario consultado, no una puntuación de calidad.

Niveles: unverified = sin evidencia suficiente; declared = configuración/código presente;
connected = conexión observada; executed = operación real observada;
reproduced = operación repetida con controles y resultados conservados.
Este generador inspecciona archivos: su máximo automático es declared.
Las ejecuciones y regresiones específicas se documentan por separado con comandos, resultados y commits.

| Superficie GV | Nivel observado | Fuente local | Evidencia |
|---|---|---|---|
${inventory.map(row => `| ${row.dimension} | ${row.level} | ${row.source} | ${row.evidence} |`).join('\n')}

## Referencia externa

Gentle-AI estable: v4.2.0, publicado 2026-10-15.
Fuente: https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v4.2.0
Contratos fijados: https://github.com/Gentleman-Programming/gentle-ai/tree/v4.2.0/docs
El seguimiento de main se informa como desarrollo no publicado y no sustituye esta referencia estable.
Las afirmaciones públicas de terceros no se puntúan como ejecución local ni como ausencia de capacidades.

## Rendimiento

El resultado upstream de 77 segundos y 10 turnos es una afirmación pública de su experimento.
El registro GV en .runtime/odd-bench/cases.json contiene observaciones de trabajos locales.
Filtrar por número de turnos no iguala tarea, modelo, hardware, contexto inicial,
herramientas ni criterio de aceptación. No hay experimento controlado equivalente:
no se calcula ratio, ganador ni umbral de homologación a partir de esos tiempos.
Para comparar: fijar el mismo fixture y aceptación, registrar modelo/configuración,
condiciones iniciales y mediciones completas de varias repeticiones en ambos sistemas.

Repetición del inventario: node --import tsx src/tools/comparative-benchmark.ts
La salida predeterminada es un archivo nuevo en .runtime/comparisons; una ruta existente se rechaza.
`;
}

export function writeReport(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
}

if (['comparative-benchmark.ts', 'comparative-benchmark.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '')) {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex !== -1 && !process.argv[outputIndex + 1]) throw new Error('--output requiere ruta');
  const output = outputIndex === -1
    ? join(process.cwd(), '.runtime/comparisons', `evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
    : resolve(process.argv[outputIndex + 1]);
  writeReport(output, render());
  console.log(`[COMPARISON] Inventario declarado; sin ranking de rendimiento. Report: ${output}`);
}
