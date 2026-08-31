#!/usr/bin/env node
/**
 * SDD Research Lane — external-evidence artifact bound to an SDD change
 *
 * Native adoption of the "sdd-research" pattern: an optional, auditable lane
 * selectable right after EXPLORE that records WHAT was asked, WHAT was found,
 * WHERE each answer came from and HOW confident it is — before PROPOSE freezes
 * scope. Inspired by gentle-ai v2.5.0-rc.1's research artifact, implemented
 * 100% natively on the stack's own web-crawler + CRAG BM25 grader.
 *
 * Design constraints (deliberate):
 *   - DETERMINISTIC auto mode: search + BM25 grading only, no LLM calls —
 *     results are reproducible and cheap. The claim→source mapping and
 *     contradiction sections are scaffolded in the artifact for the agent
 *     layer (sdd-lifecycle skill) to fill during interactive research.
 *   - FAIL-CLOSED grant: research requires an EXISTING SDD case
 *     (`.sdd/<feature>/` created by INIT/EXPLORE). No case, no research.
 *   - VERSIONED artifact: `gentle-vanguard.sdd-research/v1` header — future
 *     format changes bump the version, parsers refuse unknown versions.
 *
 * Artifacts (consistent with sdd-pipeline's `<PHASE>/artifact.md` layout):
 *   .sdd/<feature>/RESEARCH/artifact.md   — human/agent-readable evidence
 *   .sdd/<feature>/RESEARCH/research.json — machine-readable, versioned
 *
 * CLI:
 *   npx tsx src/sdd/sdd-research.ts run  -f <feature> -q "q1;q2" [--deep] [--limit 5] [--threshold 0.4]
 *   npx tsx src/sdd/sdd-research.ts show -f <feature>
 */

import { pathToFileURL } from 'url';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { runSync } from '../core/run-command.js';
import { createWebCrawler, type SearchResult } from '../web/web-crawler.js';
import { gradeRetrieval } from '../retrieval/retrieval-grader.js';
import { cached } from '../resilience/response-cache/cached.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ARTIFACT_VERSION = 'gentle-vanguard.sdd-research/v1';

export interface ResearchSource {
  url: string;
  title: string;
  description: string;
  score: number;
  relevant: boolean;
  deepScore?: number;
  fetchedAt: string;
}

export interface ResearchQuestion {
  question: string;
  verdict: 'relevant' | 'corrective';
  confidence: number;
  uncertain: boolean;
  sources: ResearchSource[];
  /** filled by the agent layer during interactive research (auto mode: []) */
  claims: { claim: string; sourceUrl: string }[];
}

export interface ResearchArtifact {
  artifact: typeof ARTIFACT_VERSION;
  feature: string;
  generated: string;
  mode: 'auto-deterministic';
  grant: { sources: string[]; tool: string };
  questions: ResearchQuestion[];
  stats: {
    questions: number;
    sources: number;
    relevantSources: number;
    lowConfidence: number;
  };
  /** filled by the agent layer; auto mode records none (no semantic analysis) */
  contradictions: string[];
  notes: string;
}

export interface RunOptions {
  deep: boolean;
  limit: number;
  threshold: number;
  deepLimit: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  deep: false,
  limit: 5,
  threshold: 0.4,
  deepLimit: 3,
};

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Parse the --questions value: `;` or newline separated, trimmed, deduped,
 * empty entries dropped. Never returns an empty array silently — the caller
 * validates length > 0.
 */
export function parseQuestions(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw.split(/[;\n]/)) {
    const t = q.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Assemble the versioned artifact from per-question research results.
 * Pure: given the same inputs it produces the same artifact (except
 * `generated`, which is injected for testability).
 */
export function buildArtifact(
  feature: string,
  questions: string[],
  results: { verdict: 'relevant' | 'corrective'; confidence: number; sources: ResearchSource[] }[],
  now = new Date().toISOString(),
): ResearchArtifact {
  if (questions.length !== results.length) {
    throw new Error(`questions/results length mismatch: ${questions.length} vs ${results.length}`);
  }
  const qs: ResearchQuestion[] = questions.map((q, i) => ({
    question: q,
    verdict: results[i].verdict,
    confidence: round2(results[i].confidence),
    // low-confidence flag: below threshold or corrective verdict
    uncertain:
      results[i].confidence < DEFAULT_RUN_OPTIONS.threshold || results[i].verdict === 'corrective',
    sources: results[i].sources,
    claims: [],
  }));
  const allSources = qs.flatMap((q) => q.sources);
  return {
    artifact: ARTIFACT_VERSION,
    feature,
    generated: now,
    mode: 'auto-deterministic',
    grant: { sources: ['documentation', 'open-web'], tool: 'src/sdd/sdd-research.ts' },
    questions: qs,
    stats: {
      questions: qs.length,
      sources: allSources.length,
      relevantSources: allSources.filter((s) => s.relevant).length,
      lowConfidence: qs.filter((q) => q.uncertain).length,
    },
    contradictions: [],
    notes:
      'Auto mode is deterministic (search + BM25 grading, no LLM): claims and ' +
      'contradictions are scaffolded for the agent layer to fill in artifact.md.',
  };
}

/** Render the human/agent-readable artifact.md with claim-mapping scaffolds. */
export function renderMarkdown(a: ResearchArtifact): string {
  const lines: string[] = [];
  lines.push(`# SDD Research — ${a.feature}`);
  lines.push('');
  lines.push(`> artifact: \`${a.artifact}\` | mode: ${a.mode} | generated: ${a.generated}`);
  lines.push(`> grant: ${a.grant.sources.join(' + ')} vía ${a.grant.tool}`);
  lines.push(
    `> preguntas: ${a.stats.questions} | fuentes: ${a.stats.sources} (${a.stats.relevantSources} relevantes) | baja confianza: ${a.stats.lowConfidence}`,
  );
  lines.push('');
  for (const q of a.questions) {
    const flag = q.uncertain ? '⚠️ baja confianza' : '✓';
    lines.push(`## ${q.question}`);
    lines.push('');
    lines.push(`veredicto: ==${q.verdict}== (confianza ${q.confidence}) ${flag}`);
    lines.push('');
    if (q.sources.length === 0) {
      lines.push('_Sin fuentes relevantes — tratar como vacío de evidencia antes de proponer._');
      lines.push('');
      continue;
    }
    lines.push('| Fuente | Score | |');
    lines.push('|---|---|---|');
    for (const s of q.sources) {
      const score = s.deepScore !== undefined ? `${s.score} → deep ${s.deepScore}` : `${s.score}`;
      const mark = s.relevant ? '✓' : '✗';
      lines.push(`| [${s.title}](${s.url}) | ${score} | ${mark} |`);
    }
    lines.push('');
  }
  lines.push('## Mapeo claim → fuente');
  lines.push('');
  lines.push(
    '_(Capa agente) Cada afirmación que la propuesta usará debe mapear a una fuente de arriba._',
  );
  lines.push('');
  lines.push('| Claim | Fuente | Confianza |');
  lines.push('|---|---|---|');
  lines.push('| _pendiente_ | _pendiente_ | _pendiente_ |');
  lines.push('');
  lines.push('## Contradicciones');
  lines.push('');
  lines.push(
    a.contradictions.length === 0
      ? '_(Capa agente) Registrar aquí fuentes que se contradicen y cómo se resuelve._'
      : a.contradictions.map((c) => `- ${c}`).join('\n'),
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`_Nota: ${a.notes}_`);
  return lines.join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Research execution ───────────────────────────────────────────────────────

function toResearchSource(r: SearchResult, score: number, relevant: boolean): ResearchSource {
  return {
    url: r.url,
    title: r.title,
    description: r.description ?? '',
    score: round2(score),
    relevant,
    fetchedAt: new Date().toISOString(),
  };
}

async function researchQuestion(
  question: string,
  opts: RunOptions,
): Promise<{
  verdict: 'relevant' | 'corrective';
  confidence: number;
  sources: ResearchSource[];
}> {
  // Response cache: same (question, opts) recurs across sessions/re-runs; the
  // search + BM25 grade pipeline is deterministic and network-bound, so the
  // 24h exact cache skips the search (and deep scrapes) entirely. Note: cached
  // sources keep their original fetchedAt — that IS the fetch time of evidence.
  const { value } = await cached(
    {
      context: 'sdd-research',
      input: JSON.stringify({ question, ...opts }),
    },
    async () => {
      const crawler = createWebCrawler();
      const search = await crawler.search(question, opts.limit);
      const texts = search.map((r) => `${r.title}\n${r.description ?? ''}`);
      const graded = gradeRetrieval(question, texts, { threshold: opts.threshold });

      let sources: ResearchSource[] = search.map((r, i) =>
        toResearchSource(r, graded.chunks[i]?.score ?? 0, graded.chunks[i]?.relevant ?? false),
      );

      if (opts.deep && search.length > 0) {
        const deepTargets = sources
          .slice()
          .sort((a, b) => b.score - a.score)
          .slice(0, opts.deepLimit);
        for (const target of deepTargets) {
          try {
            const scraped = await crawler.scrape(target.url);
            const deepGraded = gradeRetrieval(
              question,
              [(scraped.markdown ?? '').slice(0, 20_000)],
              { threshold: opts.threshold },
            );
            target.deepScore = round2(deepGraded.chunks[0]?.score ?? 0);
          } catch {
            // deep scrape is best-effort — snippet score stands
          }
        }
        sources = sources.sort((a, b) => (b.deepScore ?? b.score) - (a.deepScore ?? a.score));
      } else {
        sources = sources.sort((a, b) => b.score - a.score);
      }

      return {
        verdict: (graded.verdict === 'relevant' ? 'relevant' : 'corrective') as
          | 'relevant'
          | 'corrective',
        confidence: graded.averageScore ?? 0,
        sources,
      };
    },
  );
  return value;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function researchDir(feature: string): string {
  return join(ROOT, '.sdd', feature, 'RESEARCH');
}

export function loadArtifact(feature: string): ResearchArtifact | null {
  const file = join(researchDir(feature), 'research.json');
  try {
    if (!existsSync(file)) return null;
    const a = JSON.parse(readFileSync(file, 'utf-8')) as ResearchArtifact;
    // versioned contract: refuse unknown formats instead of guessing
    if (a.artifact !== ARTIFACT_VERSION) {
      throw new Error(`unknown artifact version: ${a.artifact} (expected ${ARTIFACT_VERSION})`);
    }
    return a;
  } catch {
    return null;
  }
}

function saveArtifact(a: ResearchArtifact): string {
  const dir = researchDir(a.feature);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'research.json'), JSON.stringify(a, null, 2), 'utf-8');
  const md = renderMarkdown(a);
  writeFileSync(join(dir, 'artifact.md'), md, 'utf-8');
  return dir;
}

/** Best-effort engram observation (learning-engine pattern — never blocks). */
function engramSave(a: ResearchArtifact): void {
  try {
    const cmd = process.platform === 'win32' ? 'engram.cmd' : 'engram';
    const content =
      `SDD research para **${a.feature}**: ${a.stats.questions} pregunta(s), ` +
      `${a.stats.sources} fuente(s) (${a.stats.relevantSources} relevantes), ` +
      `${a.stats.lowConfidence} de baja confianza. Artefacto: ${ARTIFACT_VERSION}.`;
    runSync(cmd, ['save', `SDD research ${a.feature}`, 'discovery', '--content', content], {
      stdio: 'ignore',
    });
  } catch {
    /* engram is optional infrastructure */
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
SDD Research Lane — evidencia externa versionada ligada a un caso SDD.

Uso:
  run   -f <feature> -q "pregunta1;pregunta2" [opciones]   ejecuta la research
  show  -f <feature>                                         muestra el artefacto

Opciones (run):
  --deep            scrape profundo de las top fuentes (lento, más preciso)
  --limit <n>       resultados de búsqueda por pregunta (default 5)
  --threshold <f>   score mínimo para considerar relevante (default 0.4)
  --deep-limit <n>  cuántas fuentes scrapear en --deep (default 3)

Requiere un caso SDD existente (.sdd/<feature>/ creado por INIT/EXPLORE):
fail-closed — sin caso no hay research, sin research declarada la propuesta
no puede citar evidencia que no existe.

Ejemplos:
  npx tsx src/sdd/sdd-research.ts run -f health-check -q "cómo medir latencia de health checks;patrones de circuit breaker" --deep
  npx tsx src/sdd/sdd-research.ts show -f health-check
`);
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return command ? 0 : 1;
  }
  const flag = (name: string): string | undefined =>
    rest.find((a) => a.startsWith(`-${name}=`))?.split('=')[1] ??
    (rest.includes(`-${name}`) ? rest[rest.indexOf(`-${name}`) + 1] : undefined);

  const feature = flag('f') ?? flag('feature');

  if (command === 'show') {
    if (!feature) {
      console.error('show requiere -f <feature>');
      return 1;
    }
    const a = loadArtifact(feature);
    if (!a) {
      console.error(`No hay artefacto de research para "${feature}" (o versión desconocida).`);
      return 1;
    }
    console.log(renderMarkdown(a));
    return 0;
  }

  if (command !== 'run') {
    console.error(`Comando desconocido: ${command}`);
    printUsage();
    return 1;
  }

  const questionsRaw = flag('q') ?? flag('questions');
  if (!feature || !questionsRaw) {
    console.error('run requiere -f <feature> y -q "<preguntas separadas por ;>"');
    printUsage();
    return 1;
  }
  // FAIL-CLOSED: the SDD case must exist — research is bound to a change.
  if (!existsSync(join(ROOT, '.sdd', feature))) {
    console.error(
      `El caso SDD ".sdd/${feature}" no existe. Corre INIT/EXPLORE primero (sdd-pipeline -f ${feature}).`,
    );
    return 1;
  }
  const questions = parseQuestions(questionsRaw);
  if (questions.length === 0) {
    console.error('No quedó ninguna pregunta válida tras el parseo.');
    return 1;
  }

  const opts: RunOptions = {
    deep: rest.includes('--deep'),
    limit: parseInt(flag('limit') ?? '5', 10) || 5,
    threshold: parseFloat(flag('threshold') ?? '0.4') || 0.4,
    deepLimit: parseInt(flag('deep-limit') ?? '3', 10) || 3,
  };

  console.log(
    `[sdd-research] ${questions.length} pregunta(s) para "${feature}" (deep=${opts.deep}, limit=${opts.limit})`,
  );
  const results = [];
  for (const q of questions) {
    console.log(`[sdd-research] → ${q}`);
    results.push(await researchQuestion(q, opts));
  }

  const artifact = buildArtifact(feature, questions, results);
  const dir = saveArtifact(artifact);
  engramSave(artifact);
  console.log(`[sdd-research] artefacto ${ARTIFACT_VERSION} guardado en ${dir}`);
  console.log(
    `[sdd-research] fuentes: ${artifact.stats.sources} (${artifact.stats.relevantSources} relevantes), baja confianza: ${artifact.stats.lowConfidence}`,
  );
  if (artifact.stats.lowConfidence > 0) {
    console.log(
      '[sdd-research] ⚠️ preguntas de baja confianza — la capa agente debe resolverlas antes de PROPOSE',
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`[sdd-research] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    });
}
