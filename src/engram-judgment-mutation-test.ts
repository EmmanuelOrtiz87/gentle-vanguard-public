#!/usr/bin/env node
/**
 * Mutation Testing for Memory Judgments (Engram)
 *
 * Valida la robustez de juicios de memoria (mem_judge) mediante mutación
 * controlada de observaciones. Un juicio válido debe permanecer estable
 * ante pequeñas variaciones en las observaciones originales.
 *
 * Usage:
 *   npx tsx src/engram-judgment-mutation-test.ts --judgment-id <id>
 *   npx tsx src/engram-judgment-mutation-test.ts --memory-id-a <id> --memory-id-b <id>
 *   npx tsx src/engram-judgment-mutation-test.ts --validate-all
 */

import { spawn } from 'child_process';

const MUTATIONS = [
  {
    name: 'content_truncate',
    apply: (content: string) => content.slice(0, Math.floor(content.length * 0.9)),
    description: 'Remueve último 10% del contenido',
  },
  {
    name: 'content_noise',
    apply: (content: string) => {
      // Reemplaza palabras clave con sinónimos comunes
      const noise = content
        .replace(/fixed/gi, 'resolved')
        .replace(/bug/gi, 'issue')
        .replace(/added/gi, 'implemented')
        .replace(/removed/gi, 'deleted');
      return noise;
    },
    description: 'Sinonimiza términos técnicos comunes',
  },
  {
    name: 'timestamp_shift',
    apply: (content: string) => {
      // Desplaza timestamps ISO +1 día
      const shifted = new Date(Date.now() + 86400000).toISOString();
      return content.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, shifted);
    },
    description: 'Desplaza timestamps +1 día',
  },
  {
    name: 'scope_reduction',
    apply: (content: string) => {
      // Busca y elimina secciones específicas
      const sections = ['**Why**', '**Learned**', '**Where**'];
      let reduced = content;
      sections.forEach((section) => {
        const regex = new RegExp(`\\n${section}:.*?(?=\\n\\*\\*|\\n## |$)`, 's');
        reduced = reduced.replace(regex, '');
      });
      return reduced;
    },
    description: 'Elimina secciones secundarias (Why/Learned/Where)',
  },
  {
    name: 'path_generalization',
    apply: (content: string) => {
      // Generaliza paths específicos
      return content
        .replace(/src\/[a-z-]+\/[a-z-]+\.ts/g, 'src/**/*.ts')
        .replace(/config\/[\w-]+\.json/g, 'config/*.json');
    },
    description: 'Generaliza paths de archivos a wildcards',
  },
];

interface JudgmentResult {
  judgmentId: string;
  original: {
    memoryIdA: number;
    memoryIdB: number;
    relation: string;
  };
  mutations: Array<{
    mutationName: string;
    mutatedContentA?: string;
    mutatedContentB?: string;
    verdict: string;
    confidence: number;
    unstable: boolean;
  }>;
  stability: number; // % de mutaciones que mantuvieron el mismo veredicto
  verdict: 'stable' | 'unstable' | 'fragile';
}

async function runMutation(
  originalA: string,
  originalB: string,
  mutation: (typeof MUTATIONS)[0],
): Promise<{ mutatedA: string; mutatedB: string }> {
  return {
    mutatedA: mutation.apply(originalA),
    mutatedB: mutation.apply(originalB),
  };
}

async function validateJudgment(judgmentId: string): Promise<JudgmentResult | null> {
  console.log(`[MUTATION-TEST] Validating judgment: ${judgmentId}`);

  // Obtener observación completa del judgment
  const judgmentData = await getJudgmentData(judgmentId);
  if (!judgmentData) {
    console.log(`[MUTATION-TEST] Judgment not found: ${judgmentId}`);
    return null;
  }

  const { memoryA, memoryB } = judgmentData;
  const originalRelation = judgmentData.relation;
  const originalConfidence = judgmentData.confidence;

  const mutations = [];

  for (const mutation of MUTATIONS) {
    const { mutatedA, mutatedB } = await runMutation(memoryA.content, memoryB.content, mutation);

    // Ejecutar juicio con contenido mutado
    const verdict = await executeJudgment({
      contentA: mutatedA,
      contentB: mutatedB,
      titleA: memoryA.title,
      titleB: memoryB.title,
    });

    const stable =
      verdict.relation === originalRelation && verdict.confidence >= originalConfidence * 0.8;

    mutations.push({
      mutationName: mutation.name,
      mutatedContentA: mutatedA.slice(0, 100) + '...',
      mutatedContentB: mutatedB.slice(0, 100) + '...',
      verdict: verdict.relation,
      confidence: verdict.confidence,
      unstable: !stable,
    });

    console.log(
      `  [${mutation.name}]` +
        ` Original: ${originalRelation}` +
        ` → Mutated: ${verdict.relation}` +
        ` (${stable ? 'STABLE' : 'CHANGED'})`,
    );
  }

  const stableCount = mutations.filter((m) => !m.unstable).length;
  const stability = stableCount / mutations.length;

  let verdict: 'stable' | 'unstable' | 'fragile';
  if (stability >= 0.8) verdict = 'stable';
  else if (stability >= 0.5) verdict = 'unstable';
  else verdict = 'fragile';

  const result: JudgmentResult = {
    judgmentId,
    original: {
      memoryIdA: memoryA.id,
      memoryIdB: memoryB.id,
      relation: originalRelation,
    },
    mutations,
    stability,
    verdict,
  };

  console.log(
    `[MUTATION-TEST] Stability: ${(stability * 100).toFixed(1)}% → ${verdict.toUpperCase()}`,
  );

  return result;
}

async function getJudgmentData(judgmentId: string): Promise<{
  memoryA: { id: number; title: string; content: string };
  memoryB: { id: number; title: string; content: string };
  relation: string;
  confidence: number;
} | null> {
  // Usar mem_get_observation para obtener datos
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['tsx', 'src/engram-tools-wrapper.ts', 'get-observation', '--id', judgmentId],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      },
    );

    let output = '';
    let error = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      error += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[MUTATION-TEST] Error getting judgment: ${error}`);
        resolve(null);
        return;
      }

      try {
        const data = JSON.parse(output);
        resolve({
          memoryA: { id: data.memory_id_a, title: data.title || '', content: data.content || '' },
          memoryB: { id: data.memory_id_b, title: data.title || '', content: data.content || '' },
          relation: data.relation,
          confidence: data.confidence,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

async function executeJudgment({
  contentA,
  contentB,
  titleA: _titleA,
  titleB: _titleB,
}: {
  contentA: string;
  contentB: string;
  titleA: string;
  titleB: string;
}): Promise<{ relation: string; confidence: number }> {
  // Simulación de juicio - en producción esto llamaría a una API de LLM
  // o reutilizaría la lógica de mem_judge

  // Heurísticas simples para determinar similitud
  const similarity = calculateSimilarity(contentA, contentB);

  let relation: string;
  let confidence: number;

  if (similarity > 0.9) {
    relation = 'supersedes';
    confidence = 0.85;
  } else if (similarity > 0.7) {
    relation = 'related';
    confidence = 0.75;
  } else if (similarity > 0.5) {
    relation = 'compatible';
    confidence = 0.65;
  } else {
    relation = 'not_conflict';
    confidence = 0.9;
  }

  return { relation, confidence };
}

function calculateSimilarity(a: string, b: string): number {
  // Implementación simplificada de similitud de coseno
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

async function validateAllJudgments(): Promise<JudgmentResult[]> {
  console.log('[MUTATION-TEST] Validating all recent judgments...');
  // Ejemplo de judgment IDs de prueba (estos vendrían de mem_search o similar)
  const testJudgmentIds = ['rel-abc123', 'rel-def456', 'rel-ghi789'];

  const results: JudgmentResult[] = [];
  for (const id of testJudgmentIds) {
    const result = await validateJudgment(id);
    if (result) results.push(result);
  }

  return results;
}

function printReport(results: JudgmentResult[]) {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          MUTATION TEST REPORT - Memory Judgments            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const stable = results.filter((r) => r.verdict === 'stable');
  const unstable = results.filter((r) => r.verdict === 'unstable');
  const fragile = results.filter((r) => r.verdict === 'fragile');

  console.log(`Total judgments tested: ${results.length}`);
  console.log(
    `  🟢 Stable:   ${stable.length} (${((stable.length / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  🟡 Unstable: ${unstable.length} (${((unstable.length / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  🔴 Fragile:  ${fragile.length} (${((fragile.length / results.length) * 100).toFixed(1)}%)`,
  );

  console.log('\n--- Detailed Results ---');
  results.forEach((r) => {
    console.log(`\nJudgment: ${r.judgmentId}`);
    console.log(`  Stability: ${(r.stability * 100).toFixed(1)}%`);
    console.log(`  Verdict: ${r.verdict.toUpperCase()}`);
    console.log(
      `  Failed mutations: ${
        r.mutations
          .filter((m) => m.unstable)
          .map((m) => m.mutationName)
          .join(', ') || 'none'
      }`,
    );
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Recommendation: Review fragile judgments for re-validation   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const judgmentId = args.find((a) => a.startsWith('--judgment-id='))?.split('=')[1];
  const validateAll = args.includes('--validate-all');

  if (judgmentId) {
    const result = await validateJudgment(judgmentId);
    if (result) {
      printReport([result]);
    } else {
      console.error(`[MUTATION-TEST] Failed to validate judgment: ${judgmentId}`);
      process.exit(1);
    }
  } else if (validateAll) {
    const results = await validateAllJudgments();
    printReport(results);
    const hasFragile = results.some((r) => r.verdict === 'fragile');
    process.exit(hasFragile ? 1 : 0);
  } else {
    console.log(`
Mutation Testing for Memory Judgments

Validates robustness of Engram judgments through controlled mutation.

Usage:
  npx tsx src/engram-judgment-mutation-test.ts --judgment-id=<id>
  npx tsx src/engram-judgment-mutation-test.ts --validate-all

Mutations applied:
${MUTATIONS.map((m) => `  - ${m.name}: ${m.description}`).join('\n')}

Exit codes:
  0 - All judgments stable
  1 - Some judgments fragile (needs review)
`);
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[MUTATION-TEST] Fatal error:', err);
    process.exit(1);
  });
}

export { validateJudgment, MUTATIONS };
