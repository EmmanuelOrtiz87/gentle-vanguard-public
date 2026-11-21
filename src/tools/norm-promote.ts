/**
 * norm-promote — promoción clase-B CODIFICADA (ronda 19, meta-auditoría).
 *
 * El veredicto del benchmark honesto (2026-11-20): "la promoción clase-B está
 * descrita pero no codificada" — el agente aterriza la norma y edita
 * PROMOTED-NORMS.json A MANO, sin evidencia de que el aterrizaje existió.
 * Este CLI convierte la promoción en un acto auditable:
 *
 *   1. la norma EXISTE en el índice (.session/learned-norms.json);
 *   2. el ARTEFACTO existe en el repo (skill/automation/helper/norma de
 *      ingeniería — `--artifact` es obligatorio y se verifica con existsSync):
 *      sin aterrizaje real NO hay promoción — ese es el gate anti-"descrita
 *      pero no codificada";
 *   3. el ID + historial (landedAs/landedAt/occ/conf al momento) quedan
 *      registrados en rules/adaptive/PROMOTED-NORMS.json;
 *   4. el próximo corrida de auto-norm-learner la marca active
 *      (applyPromotions, ya codificado) y sale de PROMOTION-QUEUE.md.
 *
 * Idempotente: promover algo ya promovido es exit 0 con aviso, no error.
 *
 * Uso: npm run norms:promote -- <norm-id> --artifact rules/adaptive/ENGINEERING-NORMS.md#ENG-017
 *      (paths con #ancla se verifican sobre la parte antes del #)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const NORMS_DB_PATH = join(ROOT, '.session', 'learned-norms.json');
const PROMOTED_PATH = join(ROOT, 'rules', 'adaptive', 'PROMOTED-NORMS.json');

interface Norm {
  id: string;
  status: string;
  occurrences: number;
  confidence: number;
  description?: string;
}
interface PromotedDoc {
  $schema?: string;
  promoted: string[];
  history?: Array<{
    id: string;
    landedAs: string;
    landedAt: string;
    occurrencesAtPromotion?: number;
    confidenceAtPromotion?: number;
  }>;
}

export interface PromotionVerdict {
  ok: boolean;
  outcome: 'promoted' | 'already' | 'refused';
  reason: string;
}

/** Núcleo puro: toda decisión es explícita y testeable. */
export function promoteNorm(
  norms: Norm[],
  promoted: PromotedDoc,
  id: string,
  artifact: string,
  existsArtifact: (path: string) => boolean,
  today = new Date().toISOString().slice(0, 10),
): { verdict: PromotionVerdict; promoted: PromotedDoc } {
  const norm = norms.find((n) => n.id === id);
  if (!norm) {
    return {
      verdict: {
        ok: false,
        outcome: 'refused',
        reason: `norma "${id}" no existe en .session/learned-norms.json`,
      },
      promoted,
    };
  }
  if (promoted.promoted.includes(id)) {
    return {
      verdict: {
        ok: true,
        outcome: 'already',
        reason: `"${id}" ya está en PROMOTED-NORMS.json (idempotente, nada que hacer)`,
      },
      promoted,
    };
  }
  if (norm.status === 'active') {
    return {
      verdict: { ok: true, outcome: 'already', reason: `"${id}" ya está active en el índice` },
      promoted,
    };
  }
  // El gate anti-"descrita pero no codificada": el aterrizaje es un archivo
  // real. #ancla se verifica sobre el archivo antes del #.
  const filePath = artifact.split('#')[0] ?? artifact;
  if (!artifact.trim() || !existsArtifact(filePath)) {
    return {
      verdict: {
        ok: false,
        outcome: 'refused',
        reason: `artefacto "${filePath}" NO existe en el repo — aterriza la norma primero (skill/automation/helper/norma) y después promueve`,
      },
      promoted,
    };
  }
  promoted.promoted.push(id);
  promoted.history = promoted.history ?? [];
  promoted.history.push({
    id,
    landedAs: artifact,
    landedAt: today,
    occurrencesAtPromotion: norm.occurrences,
    confidenceAtPromotion: norm.confidence,
  });
  return {
    verdict: {
      ok: true,
      outcome: 'promoted',
      reason: `"${id}" promovida — activará con la próxima corrida del learner; artefacto: ${artifact}`,
    },
    promoted,
  };
}

function main(argv: string[]): number {
  const id = argv.find((a) => !a.startsWith('--'));
  const artifactIdx = argv.indexOf('--artifact');
  const artifact = artifactIdx >= 0 ? argv[artifactIdx + 1] : undefined;
  if (!id || !artifact) {
    console.error('Uso: npm run norms:promote -- <norm-id> --artifact <path-en-repo[#ancla]>');
    console.error('  El artefacto debe EXISTIR: sin aterrizaje real no hay promoción.');
    return 2;
  }

  let norms: Norm[];
  let promoted: PromotedDoc;
  try {
    norms = JSON.parse(readFileSync(NORMS_DB_PATH, 'utf8')) as Norm[];
    promoted = JSON.parse(readFileSync(PROMOTED_PATH, 'utf8')) as PromotedDoc;
  } catch (error) {
    console.error(`✗ no pude leer el índice o el registro: ${(error as Error).message}`);
    return 2;
  }

  const { verdict, promoted: next } = promoteNorm(norms, promoted, id, artifact, (p) =>
    existsSync(join(ROOT, p)),
  );
  if (!verdict.ok) {
    console.error(`✗ ${verdict.reason}`);
    return 1;
  }
  if (verdict.outcome === 'promoted') {
    writeFileSync(PROMOTED_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    console.log(`✓ [norms:promote] ${verdict.reason}`);
    console.log('  El commit de rules/adaptive/PROMOTED-NORMS.json es el recibo visible al owner.');
  } else {
    console.log(`= [norms:promote] ${verdict.reason}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
