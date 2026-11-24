/**
 * engram-recall.ts — RECALL NATIVO: devolver al agente lo que ya se aprendió.
 *
 * POR QUÉ EXISTE (medición del 2026-11-23/24)
 * --------------------------------------------
 * Engram tenía **128 escrituras en 7 días y 7 búsquedas**. El conocimiento se
 * acumulaba y no se recuperaba: cada sesión escribía sus lecciones (que es lo
 * bien hecho) y ninguna las volvía a leer. La instrucción "hacé mem_search al
 * inicio de sesión" estaba escrita en `AGENTS.md`, pero dependía de que el
 * agente se acuerde — y un wiring que depende de la memoria es un wiring roto.
 *
 * LA REGLA: la recuperación tiene que ser un PASO, no una instrucción. Este
 * módulo se invoca desde el hook de pre-respuesta (`pre-process-input.ts`),
 * que corre en TODAS las herramientas (es transversal por construcción), con:
 *   - consulta acotada: los términos salientes del mensaje, no el mensaje entero;
 *   - caché por consulta con TTL (el costo se paga una vez, no en cada turno);
 *   - timeout duro y cero excepciones: si Engram no está, NO pasa nada.
 *
 * Lo que devuelve NO se inyecta en el prompt (contaminaría la entrada): se
 * escribe en stderr como recordatorio visible, igual que las sugerencias del
 * Proactive Intelligence.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';

export interface RecalledLesson {
  id: number;
  title: string;
  type: string;
}

export interface RecalledResult {
  query: string;
  lessons: RecalledLesson[];
  /** De dónde salió: 'cache' (no se consultó Engram) o 'live'. */
  source: 'cache' | 'live';
  /** Por qué no hubo recall (si aplica). */
  reason?: string;
}

/** Palabras vacías que no sirven para buscar una lección relevante. */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'you',
  'not',
  'but',
  'are',
  'was',
  'has',
  'have',
  'when',
  'then',
  'than',
  'its',
  'into',
  'out',
  'about',
  'como',
  'cuando',
  'porque',
  'para',
  'con',
  'por',
  'del',
  'una',
  'uno',
  'unos',
  'unas',
  'los',
  'las',
  'que',
  'debe',
  'deben',
  'tiene',
  'tienen',
  'hay',
  'ser',
  'esta',
  'este',
  'esto',
  'todo',
  'todos',
  'toda',
  'todas',
  'cada',
  'segun',
  'entre',
  'sobre',
  'desde',
  'sin',
  'sus',
  'mas',
  'muy',
  'asi',
  'donde',
  'mientras',
  'puede',
  'pueden',
  'hace',
  'ya',
  'aun',
  'sigue',
  'seguir',
  'hay',
  'cosa',
  'cosas',
  'nada',
  'todo',
  'poder',
  'hacer',
  'decir',
  'decir',
]);

/**
 * Consulta de recall: los términos salientes del mensaje (≥4 letras, sin
 * stopwords, sin repetir), máximo 8. Sin términos útiles NO hay recall: una
 * consulta vacía devolvería cualquier cosa y parecería relevante.
 */
export function buildRecallQuery(input: string, maxTerms = 8): string | null {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const word = raw.replace(/^-+|-+$/g, '');
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= maxTerms) break;
  }
  return terms.length ? terms.join(' ') : null;
}

/** Runner inyectable (para tests): recibe la consulta y devuelve stdout. */
type SearchRunner = (query: string) => string | null;

/** Runner real: el CLI nativo del stack (`mem-cli search`), que habla con Engram. */
const defaultSearchRunner: SearchRunner = (query) => {
  const script = resolve(process.cwd(), 'src', 'knowledge', 'mem-cli.ts');
  // `match-mode any`: con AND y varios términos la búsqueda vuelve vacía
  // (0 de 128 escrituras recuperadas era exactamente eso). `limit` acota.
  const result = runNpxTsxSync(script, ['search', query, '--match-mode', 'any', '--limit', '6'], {
    cwd: process.cwd(),
    timeout: 8000,
  });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  return result.stdout;
};

/** Extrae las lecciones del JSON del CLI de Engram. */
export function parseRecallPayload(stdout: string | null): RecalledLesson[] {
  if (!stdout) return [];
  try {
    const start = stdout.indexOf('{');
    if (start < 0) return [];
    const parsed = JSON.parse(stdout.slice(start)) as {
      results?: Array<{ id?: number; title?: string; type?: string }>;
    };
    return (parsed.results ?? [])
      .filter((r) => typeof r.id === 'number')
      .map((r) => ({
        id: r.id as number,
        title: (r.title ?? '').trim(),
        type: (r.type ?? 'observation').trim(),
      }));
  } catch {
    return [];
  }
}

/** Formato para el recordatorio visible (stderr). */
export function formatRecall(result: RecalledResult, max = 3): string[] {
  if (!result.lessons.length) return [];
  const lines = ['[ENGRAM RECALL] Lecciones previas relevantes (leídas de la memoria del stack):'];
  for (const lesson of result.lessons.slice(0, max)) {
    lines.push(`  • #${lesson.id} (${lesson.type}) ${lesson.title}`);
  }
  lines.push(
    '  (si alguna aplica a lo que estás haciendo, tenela en cuenta antes de repetir el error)',
  );
  return lines;
}

function cachePath(workspaceRoot: string, query: string): string {
  // La clave usa los DOS PRIMEROS términos: el objetivo del recall es "qué
  // lecciones de este tema tengo", no "qué dice exactamente este mensaje".
  // Con la consulta completa como clave, cada mensaje distinto pagaba una
  // búsqueda (~2 s) y el recall se volvía ruido caro.
  const topic = query.split(' ').slice(0, 2).join(' ');
  const key = createHash('sha256')
    .update(`${resolve(workspaceRoot)}|${topic}`)
    .digest('hex')
    .slice(0, 16);
  return resolve(workspaceRoot, '.runtime', 'pre-process', `engram-recall-${key}.json`);
}

export interface RecallOptions {
  workspaceRoot?: string;
  ttlMs?: number;
  limit?: number;
  runner?: SearchRunner;
  /** Desactiva el recall (además de la variable de entorno). */
  disabled?: boolean;
}

/**
 * Recall con caché por consulta. NUNCA lanza: si Engram no está, el resultado
 * es "sin lecciones" y el hook sigue igual.
 */
export function recall(input: string, options: RecallOptions = {}): RecalledResult {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const ttlMs = options.ttlMs ?? Number(process.env.GV_PREPROCESS_ENGRAM_RECALL_TTL_MS ?? 600_000);
  const limit = options.limit ?? 5;
  const disabled = options.disabled === true || process.env.GV_PREPROCESS_ENGRAM_RECALL === '0';

  const query = buildRecallQuery(input);
  if (disabled) return { query: query ?? '', lessons: [], source: 'live', reason: 'desactivado' };
  if (!query) return { query: '', lessons: [], source: 'live', reason: 'sin términos de consulta' };
  if (ttlMs <= 0) return { query, lessons: [], source: 'live', reason: 'ttl 0' };

  const path = cachePath(workspaceRoot, query);
  try {
    if (existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, 'utf8')) as {
        createdAt: number;
        lessons: RecalledLesson[];
      };
      if (Date.now() - cached.createdAt < ttlMs) {
        return { query, lessons: cached.lessons ?? [], source: 'cache' };
      }
    }
  } catch {
    /* caché corrupta: se recalcula */
  }

  let lessons: RecalledLesson[] = [];
  try {
    const runner = options.runner ?? defaultSearchRunner;
    lessons = parseRecallPayload(runner(query)).slice(0, limit);
  } catch {
    lessons = [];
  }

  try {
    mkdirSync(resolve(workspaceRoot, '.runtime', 'pre-process'), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ createdAt: Date.now(), lessons }), 'utf8');
    renameSync(temporary, path);
  } catch {
    /* la caché es best-effort: su ausencia nunca pierde el recall */
  }

  return { query, lessons, source: 'live' };
}
