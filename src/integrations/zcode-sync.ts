/**
 * zcode-sync.ts — Sincroniza los agentes del stack (.opencode/agents/*.md) al formato
 * nativo de ZCode (~/.zcode/agents/*.md).
 *
 * Mapeo de frontmatter opencode → ZCode:
 *   description      → description (requerido)
 *   steps            → maxTurns
 *   model            → model: "inherit" (GLM-5.3 primary; los modelos opencode/* no existen aquí)
 *   permission deny  → disallowedTools (WebSearch/WebFetch → WebSearch/WebFetch de ZCode)
 *   mode: subagent   → injectAgentsMd: false (evita re-inyectar el manual en cada subagente)
 *   orchestrator     → injectAgentsMd: true (mantiene contexto del stack, AGENTS.md ahora es slim)
 *   temperature      → nota en el body (ZCode no soporta temperature por agente)
 *
 * Uso:
 *   npx tsx src/zcode-sync.ts --sync          # escribe en ~/.zcode/agents/
 *   npx tsx src/zcode-sync.ts --sync --dry    # muestra el plan sin escribir
 *   npx tsx src/zcode-sync.ts --status        # compara stack vs ~/.zcode/agents
 *
 * Nota ZCode: los cambios de agentes requieren una nueva sesión (no hot-reload).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, cpSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface OpenCodeFrontmatter {
  description?: string;
  mode?: string;
  model?: string;
  temperature?: number;
  steps?: number;
  permission?: Record<string, string>;
  [k: string]: unknown;
}

const STACK_AGENTS_DIR = join(process.cwd(), '.opencode', 'agents');
const ZCODE_AGENTS_DIR = join(homedir(), '.zcode', 'agents');
const ZCODE_CONFIG_PATH = join(homedir(), '.zcode', 'cli', 'config.json');

/**
 * Skills críticas para uso diario en ZCode. Se copian a ~/.zcode/skills/.
 * NO copiar todas (~120): ZCode tiene un presupuesto fijo de metadata compartida
 * (excerpt de 250 chars por skill) — excederlo degrada el auto-trigger de TODAS.
 */
export const CRITICAL_SKILLS: Array<{ dir: string; root: 'opencode' | 'stack' }> = [
  { dir: 'sdd-lifecycle', root: 'stack' },
  { dir: 'nexus-database', root: 'stack' },
  { dir: 'engram-memory', root: 'stack' },
  { dir: 'karpathy-guidelines', root: 'stack' },
  { dir: 'token-budget-tracking-skill', root: 'stack' },
  // Las siguientes existen en .opencode/skills solo como stubs DEPRECATED
  // ("moved to skills/..."); el contenido real vive en skills/.
  { dir: 'code-review-and-quality', root: 'stack' },
  { dir: 'debugging-and-error-recovery', root: 'stack' },
  { dir: 'test-driven-development', root: 'stack' },
  { dir: 'planning-and-task-breakdown', root: 'stack' },
  { dir: 'context-engineering', root: 'stack' },
  { dir: 'web-research', root: 'stack' },
  { dir: 'diagram-design', root: 'opencode' }, // única con contenido real en .opencode
  { dir: 'security-and-hardening', root: 'stack' },
  // Fase 1 adopción externa (2026-08-27) — demanda diseño/docs/marketing.
  // Ver docs/reference/SKILL-UPGRADE-SHORTLIST-2026-08.md para el plan completo.
  { dir: 'frontend-design', root: 'stack' },
  { dir: 'doc-coauthoring', root: 'stack' },
  { dir: 'copywriting', root: 'stack' },
  { dir: 'product-marketing', root: 'stack' },
  // Fase 2 & 3 adopción externa (2026-08-27) — decks editables, taste gate, brand GV
  { dir: 'huashu-design', root: 'stack' },
  { dir: 'ui-taste', root: 'stack' },
  { dir: 'brand-guidelines-gv', root: 'stack' },
  // Fase 4 adopción (2026-09-01) — design skills from GitHub + getdesign.md + ui-skills.com
  { dir: 'impeccable', root: 'opencode' },
  { dir: 'playwright-cli', root: 'opencode' },
  { dir: 'brand-design-systems', root: 'opencode' },
  { dir: 'design-engineering', root: 'opencode' },
  // Fase 5 (2026-09-08) — autoría de cursos GV Academy (contrato nativo)
  { dir: 'academy-course-authoring', root: 'opencode' },
  // Fase 6 (2026-09-26) — triage sistémico (upstream gentle-ai, Apache-2.0).
  { dir: 'systemic-issue-triage', root: 'stack' },
];

/**
 * Destinos de skills por herramienta. ZCode y Codex usan SKILL.md estándar en su
 * dir de usuario; MiniMax Code (framework pi-agent) usa skills por agente (mavis = orquestador).
 * Copilot y Antigravity consumen skills versionadas en el workspace.
 */
const SKILL_TARGETS: Record<string, string> = {
  zcode: join(homedir(), '.zcode', 'skills'),
  codex: join(homedir(), '.codex', 'skills'),
  minimax: join(homedir(), '.minimax', 'agents', 'mavis', 'skills'),
  copilot: join(process.cwd(), '.github', 'skills'),
  antigravity: join(process.cwd(), '.antigravity', 'skills'),
};

export function copySkillTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

function syncSkills(dry: boolean, tools: string[]): boolean {
  let ok = true;
  for (const tool of tools) {
    const target = SKILL_TARGETS[tool];
    if (!target) {
      console.error(`  ✗ herramienta desconocida: ${tool}`);
      ok = false;
      continue;
    }
    if (!dry) mkdirSync(target, { recursive: true });
    console.log(`Skills → ${tool} (${target}):`);
    for (const s of CRITICAL_SKILLS) {
      const src = join(
        process.cwd(),
        s.root === 'opencode' ? join('.opencode', 'skills') : 'skills',
        s.dir,
      );
      if (!existsSync(join(src, 'SKILL.md'))) {
        console.error(`  ✗ skill sin SKILL.md: ${src}`);
        ok = false;
        continue;
      }
      if (dry) {
        console.log(`  (dry) skill ${s.dir} ← ${src}`);
        continue;
      }
      const dst = join(target, s.dir);
      try {
        copySkillTree(src, dst);
        let content = readFileSync(join(src, 'SKILL.md'), 'utf8');
        // ZCode/Codex requieren name+description en frontmatter; description ≤1024 chars.
        if (!/^---[\s\S]*?\nname:/.test(content)) {
          content = `---\nname: ${s.dir}\ndescription: ${s.dir} skill (Gentle-Vanguard stack)\n---\n${content}`;
        } else {
          content = content.replace(
            /^(description:\s*)([\s\S]*?)$/m,
            (_, p1: string, p2: string) => `${p1}${p2.length > 1000 ? p2.slice(0, 1000) : p2}`,
          );
        }
        writeFileAtomic(join(dst, 'SKILL.md'), content);
        console.log(`  ✓ skill ${s.dir}`);
      } catch (err) {
        // Un skill lockeado (EPERM transitorio de Windows) no tumba el sync entero.
        console.error(
          `  ✗ skill ${s.dir} (${tool}): ${err instanceof Error ? err.message : err}`,
        );
        ok = false;
      }
    }
  }
  return ok;
}

type JsonObject = Record<string, unknown>;

/**
 * Detector de comentarios JSONC (// y /* *​/), string-aware para no confundir
 * "https://..." con un comentario. Fail-closed: un falso positivo solo
 * detiene el sync; un falso negativo destruiría comentarios del usuario.
 * Patrón upstream gentle-ai 96bed1c: nunca re-encodear un JSONC que perdería
 * comentarios — se niega con mensaje accionable.
 */
export function containsJsonComments(text: string): boolean {
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) return true;
  }
  return false;
}

/**
 * Escritura atómica: tmp en el mismo volumen + rename (reemplaza el destino).
 * Patrón upstream gentle-ai befd337: un kill a mitad de writeFileSync deja el
 * config truncado (ZCode CLI roto); el rename es atomico en el mismo volumen.
 * Windows: el rename-replace falla con EPERM/EACCES/EBUSY si el destino tiene
 * un handle abierto (antivirus/indexer/editor escaneando el archivo recién
 * copiado) — es transitorio, se reintenta con backoff corto.
 */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, 'utf8');
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      if (!transient || attempt === maxAttempts) {
        try {
          unlinkSync(tmp);
        } catch {
          /* el tmp residual es menos grave que el error original */
        }
        throw err;
      }
      // Sleep sincrónico (Atomics.wait) para el backoff sin async.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * attempt);
    }
  }
}

export function buildZCodeHookConfig(current: JsonObject, repoRoot: string): JsonObject {
  const script = (relativePath: string) => join(repoRoot, relativePath).replace(/\\/g, '/');
  return {
    ...current,
    hooks: {
      enabled: true,
      events: {
        SessionStart: [
          {
            matcher: 'startup|resume',
            hooks: [
              {
                type: 'process',
                command: process.execPath.replace(/\\/g, '/'),
                args: ['--import', 'tsx', script('src/zcode-hooks/session-start.ts')],
                timeoutMs: 30000,
                statusMessage: 'Gentle-Vanguard: session autostart',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Write|Edit',
            hooks: [
              {
                type: 'process',
                command: process.execPath.replace(/\\/g, '/'),
                args: ['--import', 'tsx', script('src/zcode-hooks/post-edit-graphify.ts')],
                timeoutMs: 150000,
                statusMessage: 'Gentle-Vanguard: graphify update',
              },
            ],
          },
        ],
      },
    },
  };
}

function syncZCodeHooks(dry: boolean): boolean {
  let current: JsonObject = {};
  if (existsSync(ZCODE_CONFIG_PATH)) {
    const raw = readFileSync(ZCODE_CONFIG_PATH, 'utf8');
    if (containsJsonComments(raw)) {
      console.error(`  ✗ ${ZCODE_CONFIG_PATH} contiene comentarios (JSONC) — NO se reescribe para no perderlos.`);
      console.error('    Accion: mergea el bloque hooks a mano, o quitá los comentarios y re-corré --sync.');
      return false;
    }
    try {
      current = JSON.parse(raw) as JsonObject;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${ZCODE_CONFIG_PATH} es JSON inválido (${msg}). NO se sobreescribe.`);
      console.error(`    Si tenés un backup en ${ZCODE_CONFIG_PATH}.bak, restauralo y revisá el archivo.`);
      return false;
    }
  }
  const next = buildZCodeHookConfig(current, process.cwd());
  if (dry) {
    console.log(`(dry) hooks ZCode -> ${ZCODE_CONFIG_PATH} (node --import tsx)`);
    return true;
  }
  mkdirSync(join(homedir(), '.zcode', 'cli'), { recursive: true });
  // Backup del config previo antes de reescribir (recuperable ante un bug nuestro).
  if (existsSync(ZCODE_CONFIG_PATH)) {
    copyFileSync(ZCODE_CONFIG_PATH, `${ZCODE_CONFIG_PATH}.bak`);
  }
  writeFileAtomic(ZCODE_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✓ hooks ZCode sincronizados en ${ZCODE_CONFIG_PATH}`);
  return true;
}

/** Parsea frontmatter YAML simple (clave: valor, anidación de 1 nivel con guiones no soportada). */
function parseFrontmatter(raw: string): { fm: OpenCodeFrontmatter; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: OpenCodeFrontmatter = {};
  const permission: Record<string, string> = {};
  let inPermission = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s{2,}\w+:/.test(line) && inPermission) {
      const pm = line.trim().match(/^(\w+):\s*(.+)$/);
      if (pm) permission[pm[1]] = pm[2].trim();
      continue;
    }
    inPermission = false;
    const km = line.match(/^(\w+):\s*(.*)$/);
    if (!km) continue;
    const [, key, valRaw] = km;
    const val = valRaw.trim().replace(/^['"]|['"]$/g, '');
    if (key === 'permission') {
      inPermission = true;
      fm.permission = permission;
      continue;
    }
    if (val === '' || val === 'true' || val === 'false') {
      (fm as Record<string, unknown>)[key] = val === '' ? undefined : val === 'true';
    } else if (val !== '' && Number.isFinite(Number(val))) {
      // Number() handles the scalar frontmatter values we support without an
      // unbounded regex that static security analysis can reject as ReDoS-prone.
      (fm as Record<string, unknown>)[key] = Number(val);
    } else {
      (fm as Record<string, unknown>)[key] = val;
    }
  }
  if (Object.keys(permission).length > 0) fm.permission = permission;
  return { fm, body: m[2] };
}

const TOOL_DENY_MAP: Record<string, string> = {
  websearch: 'WebSearch',
  webfetch: 'WebFetch',
  bash: 'Bash',
  edit: 'Edit',
  write: 'Write',
};

function convertAgent(name: string, raw: string): string {
  const { fm, body } = parseFrontmatter(raw);
  const isOrchestrator = fm.mode !== 'subagent';
  const lines: string[] = ['---'];
  lines.push(`name: ${name}`);
  lines.push(`description: ${fm.description ?? `${name} agent (Gentle-Vanguard stack)`}`);
  lines.push('model: inherit');
  if (fm.steps && Number.isFinite(fm.steps)) lines.push(`maxTurns: ${Math.max(1, fm.steps)}`);
  const denied = Object.entries(fm.permission ?? {})
    .filter(([, v]) => String(v).toLowerCase() === 'deny')
    .map(([k]) => TOOL_DENY_MAP[k.toLowerCase()])
    .filter(Boolean);
  if (denied.length > 0) lines.push(`disallowedTools: [${denied.join(', ')}]`);
  // Subagentes: sin AGENTS.md (ahorro de contexto). Orchestrator: lo mantiene (manual slim).
  lines.push(`injectAgentsMd: ${isOrchestrator}`);
  lines.push('---', '');

  let outBody = body.trim();
  if (fm.temperature !== undefined) {
    outBody += `\n\n<!-- stack-profile: temperature ${fm.temperature} (opencode) — aplicar vía config/model-router.json profiles si se delega con route-and-delegate -->`;
  }
  return outBody ? `${lines.join('\n')}\n${outBody}\n` : `${lines.join('\n')}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry') || args.includes('--dry-run');
  const status = args.includes('--status');
  const toolsIdx = args.indexOf('--tools');
  const tools =
    toolsIdx >= 0 && args[toolsIdx + 1]
      ? args[toolsIdx + 1].split(',').map((t) => t.trim())
      : Object.keys(SKILL_TARGETS);

  if (!existsSync(STACK_AGENTS_DIR)) {
    console.error(`No existe ${STACK_AGENTS_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(STACK_AGENTS_DIR).filter((f) => f.endsWith('.md'));

  if (status) {
    console.log(`Stack agents: ${files.length} (${STACK_AGENTS_DIR})`);
    const synced = existsSync(ZCODE_AGENTS_DIR)
      ? new Set(readdirSync(ZCODE_AGENTS_DIR).filter((f) => f.endsWith('.md')))
      : new Set<string>();
    for (const f of files) {
      const n = f.replace(/\.md$/, '');
      console.log(`  ${synced.has(f) ? '✓ synced' : '✗ missing'}  ${n}`);
    }
    return;
  }

  if (!dry) mkdirSync(ZCODE_AGENTS_DIR, { recursive: true });
  let count = 0;
  let failures = 0;
  for (const f of files) {
    const name = f.replace(/\.md$/, '');
    let converted: string;
    try {
      converted = convertAgent(name, readFileSync(join(STACK_AGENTS_DIR, f), 'utf8'));
    } catch (err) {
      console.error(`  ✗ agente ${name}: ${err instanceof Error ? err.message : err}`);
      failures++;
      continue;
    }
    if (dry) {
      console.log(`--- ${name} (dry run) ---`);
      console.log(converted.split('\n').slice(0, 14).join('\n'));
    } else {
      // Escritura atomica por agente (un kill a mitad no deja el .md truncado).
      writeFileAtomic(join(ZCODE_AGENTS_DIR, f), converted);
      count++;
    }
  }
  if (!dry) {
    console.log(`✓ ${count} agentes sincronizados a ${ZCODE_AGENTS_DIR}`);
  }
  console.log(`Sincronizando skills críticas a: ${tools.join(', ')}`);
  if (!syncSkills(dry, tools)) failures++;
  if (tools.includes('zcode') && !syncZCodeHooks(dry)) failures++;
  if (!dry) {
    console.log(
      'Nota: abre una nueva sesión en cada herramienta para que carguen (no hot-reload).',
    );
    if (failures > 0) {
      // Patrón upstream befd337: el sync parcial es VISIBLE y falla el exit code.
      console.error(`✗ ${failures} fase(s) con error — sync PARCIAL (revisar ✗ arriba).`);
      process.exit(1);
    }
  }
}

// CLI Guard pattern (normalizado para rutas Windows — ver src/tools/auto-url-fix.ts)
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
) {
  main();
}
