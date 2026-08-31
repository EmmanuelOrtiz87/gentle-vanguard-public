#!/usr/bin/env node
/**
 * profiles-build — Generador de tool-profiles desde fuente única YAML.
 *
 * Lee config/tool-profiles/profiles.yaml (contenido compartido canónico) y
 * emite los archivos por herramienta:
 *   - CLAUDE.md            (Claude Code / OpenCode — Markdown)
 *   - CLAUDE.compressed.md (variante comprimida)
 *   - .cursorrules         (Cursor — Markdown)
 *   - .clinerules          (Cline — YAML con secciones tool-specific)
 *
 * Flags:
 *   --check   Verifica que los archivos generados coinciden con los commiteados
 *             (CI gate). Exit 0 si sincronizados, 1 si hay drift.
 *   --write   (default) Regenera los archivos.
 *
 * Uso:
 *   npx tsx src/orchestration/profiles-build.ts            # regenerar
 *   npx tsx src/orchestration/profiles-build.ts --check    # CI gate
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { load as loadYaml } from 'js-yaml';
import prettier from 'prettier';
import { pathToFileURL } from 'url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PROFILES_DIR = join(ROOT, 'config', 'tool-profiles');
const YAML_FILE = join(PROFILES_DIR, 'profiles.yaml');

interface CanonicalProfile {
  metadata: {
    name: string;
    version: string;
    description: string;
    canonicalEntry: string;
    fullReference: string;
  };
  core_rules: Array<{ id: string; text: string }>;
  response_profile: {
    profile: string;
    detail: string;
    chat: string;
    max_lines_text: number;
    rules: string[];
  };
  settings: {
    temperature: number;
    max_tokens: number;
    cache: boolean;
    cache_key: boolean;
    language: string;
    engram_project: string;
  };
  break_glass: { trigger: string; command: string; override_to: string; notify: string };
  key_refs: string[];
}

function loadProfile(): CanonicalProfile {
  return loadYaml(readFileSync(YAML_FILE, 'utf-8')) as CanonicalProfile;
}

// ─── Templates ──────────────────────────────────────────────────────────────

function renderClaudeMd(p: CanonicalProfile): string {
  const rules = p.core_rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n');
  const resp = p.response_profile.rules.map((r) => `${r}`).join('\n');
  const refs = p.key_refs.map((r) => `- ${r}`).join('\n');
  return `# gentle-vanguard — Entry Point

Canonical entry: \`${p.metadata.canonicalEntry}\` (comprimido) · Manual completo: \`${p.metadata.fullReference}\`

## Tool Detection (turn 1)

All tool detection is handled automatically by the agent's built-in tool routing. No manual \`pwsh\`
commands needed.

## Pre-response Hook (every turn)

Pre-processing is handled automatically by the stack pipeline (\`session-autostart.ts\`). No manual
hook execution needed.

## Core Rules

${rules}

## Break Glass

If ${p.break_glass.trigger}:
\`${p.break_glass.command}\` Override to
\`${p.break_glass.override_to}\`. Notify: \`${p.break_glass.notify}\`

## Response Profile

Profile: **${p.response_profile.profile}** | Detail: **${p.response_profile.detail}** | Chat: **${p.response_profile.chat}** (max ${p.response_profile.max_lines_text} lines text)

${resp}

## Settings

Temp: ${p.settings.temperature} | Max tokens: ${p.settings.max_tokens} | Cache: ${p.settings.cache ? 'enabled' : 'disabled'} (setCacheKey: ${p.settings.cache_key}) | Lang: ${p.settings.language} | Engram:
${p.settings.engram_project}

## Refs

${refs}
`;
}

function renderClaudeCompressed(p: CanonicalProfile): string {
  const rules = p.core_rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n');
  const resp = p.response_profile.rules.map((r) => `${r}`).join('\n');
  return `# gentle-vanguard — Entry Point for Claude-Compatible Tools

**Loaded by**: OpenCode, Claude Code, Windsurf, Claude | Canonical entry: \`${p.metadata.canonicalEntry}\` (completo: \`${p.metadata.fullReference}\`)

## CRITICAL: First Action — Tool Detection

Run BEFORE any action:

\`\`\`bash
# Tool detection via TypeScript
npx tsx src/detect-tool.ts --json | jq -r '.name'  # opencode|claude-code|cline|cursor|windsurf|unknown
npx tsx src/detect-tool.ts --json | jq -r '.os.platform'  # windows|linux|macos
npx tsx src/detect-tool.ts --json | jq -r '.os.shell'  # powershell|bash|zsh
\`\`\`

Load config from \`config/orchestrator.json#toolProfiles.<name>\`.

**Why**: Correct routing + OS detection prevents wasted tokens from wrong-platform commands.

## Startup Sequence

Run \`${p.metadata.canonicalEntry}\` — no shortcuts.

## Core Rules (condensed)

${rules}

## Break Glass — Auto-Override Harmful Config

If ${p.break_glass.trigger}:

\`\`\`powershell
${p.break_glass.command}
\`\`\`

Override to \`${p.break_glass.override_to}\`, notify: \`${p.break_glass.notify}\`

## Response Profile

Profile: **${p.response_profile.profile}** | Detail: **${p.response_profile.detail}** | Chat: **${p.response_profile.chat}** (max ${p.response_profile.max_lines_text} lines text)

${resp}

## Settings

Temperature: ${p.settings.temperature} | Max tokens: ${p.settings.max_tokens} | Cache: ${p.settings.cache ? 'enabled' : 'disabled'} (setCacheKey: ${p.settings.cache_key}) Lang: ${p.settings.language} | Engram project:
${p.settings.engram_project}

## Key Refs

See \`${p.metadata.canonicalEntry}\` for full resource table.
`;
}

function renderCursorRules(p: CanonicalProfile): string {
  const rules = p.core_rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n');
  const resp = p.response_profile.rules.map((r) => `- ${r}`).join('\n');
  return `# Cursor Rules - Gentle-Vanguard

Las reglas de este proyecto estan modularizadas en \`.cursor/rules/\` para mejor mantenibilidad.

## Fase 0: Tool Detection (PRIMERA accion)

Ejecutar ANTES de cualquier accion:
\`\`\`bash
npx tsx src/core/detect-tool.ts --json
# name: opencode|claude-code|cline|cursor|windsurf|unknown
# os.platform: windows|linux|macos
\`\`\`
Cargar config desde \`config/orchestrator.json#toolProfiles.<name>\`.

## Startup Sequence

1. \`npx tsx src/tools/pre-process-input.ts --user-input "<msg>" --workspace-root "."\` BEFORE primera respuesta
2. \`npx tsx src/session/session-start-optimized.ts\` (autostart pipeline con lazy loading)
3. \`${p.metadata.canonicalEntry}\` — sin atajos (completo: \`${p.metadata.fullReference}\`)

## Reglas activas

- \`.cursor/rules/core-workflow.md\` — Pre-processing, SDD flow, session management
- \`.cursor/rules/commands.md\` — Build, test, lint, typecheck
- \`.cursor/rules/code-style.md\` — Code conventions

## Core Rules

${rules}

## Configuracion del modelo
- **Temperature**: ${p.settings.temperature} | **Profile**: ${p.response_profile.profile} | **Chat**: ${p.response_profile.chat}
- **Idioma**: ${p.settings.language} (terminos tecnicos en ingles)
- **websearch/webfetch**: DENY
- **external_directory**: ask

## System Prompt Optimization

### Token Reduction
- Target: 2000 tokens max
- Compression: semantic abbreviations
- Cache: enabled in .session/prompt-cache

### Response Profile
${resp}

### Security
- Scan on load: enabled
- Block secrets: enabled
- Block XSS: enabled

### Monitoring
- Track tokens: yes
- Alert at: 3000 tokens
- Critical at: 5000 tokens
`;
}

function renderClineRules(p: CanonicalProfile): string {
  const rules = p.core_rules.map((r) => `    - "${r.text.replace(/"/g, '\\"')}"`).join('\n');
  return `# Cline Rules - Context-Optimized Configuration
# BASED ON: https://github.com/cline/cline (official best practices)
# Purpose: Minimal rules file with external references to avoid context bloat
# GENERATED from profiles.yaml — do not edit directly (npx tsx src/orchestration/profiles-build.ts)

---
name: ${p.metadata.name}
version: "${p.metadata.version}"
description: ${p.metadata.description} — optimized context loading

# ============================================================================
# PHASE 1: CONTEXT BOUNDARIES (Critical for performance)
# ============================================================================
# @include: Only load these patterns by default
# @exclude: Never load these (prevents context bloat)

context:
  # Default include patterns (loaded on every prompt)
  include:
    - "rules/**/*.md"           # All rules (small files)
    - "config/*.json"           # Config files (indexed)
    - "skills/*/SKILL.md"       # Skill definitions only
    - "src/tools/pre-process-input.ts"  # Core router
    - "${p.metadata.canonicalEntry}"       # Canonical entry (completo: ${p.metadata.fullReference})
    - ".clinerules"             # This file

  # Exclude patterns (CRITICAL: prevents giant context)
  exclude:
    - "node_modules/**"
    - ".git/**"
    - ".engram-data/**"
    - "dist/**"
    - "build/**"
    - "*.lock.json"             # Don't load lock files
    - ".vscode/**"
    - "tmp-session-debug/**"
    - "logs/**"
    - "session/**"
    - "**/node_modules/**"
    - "**/.next/**"
    - "**/dist/**"
    - "**/build/**"

  # Memory hints for cache optimization
  memory:
    persist:
      - "config/orchestrator.json"  # Always cache this
      - "config/auto-delegation.json"  # Always cache this
      - "rules/AI-NORMATIVES.md"  # Cache normatives
    expire: 300  # Cache invalidation (seconds)
    strategy: "reference"  # Use IDs/references instead of full content

# ============================================================================
# PHASE 2: TRIGGER ROUTING (Route to correct agent/skill)
# ============================================================================
# Execute src/tools/pre-process-input.ts BEFORE responding
# Format: "trigger_keyword" → "agent_code" → "skill_path"

triggers:
  # Session management (external reference)
  session:
    keywords: ["inicia sesion", "iniciar sesion", "start session", "begin session"]
    reference: "skills/session-workflow-skill/SKILL.md"
    rule: "Load only session-specific context"

  # SDD Lifecycle (external reference)
  sdd:
    keywords: ["implement", "code", "feature", "design", "architecture", "test", "deploy"]
    reference: "skills/sdd-lifecycle/SKILL.md"
    rule: "Follow EXPLORE → SPEC → APPLY → VERIFY phases"

  # Security (external reference)
  security:
    keywords: ["security", "auth", "vulnerability", "penetration", "audit"]
    reference: "skills/security-skill/SKILL.md"
    rule: "Load security context only if triggered"

  # DevOps (external reference)
  devops:
    keywords: ["deploy", "docker", "kubernetes", "ci/cd", "helm"]
    reference: "skills/docker-devops-skill/SKILL.md"
    rule: "Load infra context only if triggered"

  # Git/Workflow (external reference)
  git:
    keywords: ["branch", "pr", "merge", "commit", "conflict", "rebase"]
    reference: "skills/git-workflow-skill/SKILL.md"
    rule: "Load git context only if triggered"

# ============================================================================
# PHASE 3: AGENT RULES (Behavior & constraints)
# ============================================================================
# Tells Cline HOW to behave (not WHERE to look)

agent:
  # Operational mode
  mode: "plan-and-act"  # User approves before execution
  approval: "all-actions"  # Require approval for file edits + terminal commands

  # Context management
  contextStrategy: "selective"  # Load context on-demand, not everything

  # Prevent context bloat
  rules:
${rules}
    - "Never grep/search on node_modules or dist/"
    - "Use local-first approach: project knowledge before external search"
    - "Reference external docs, don't embed them"
    - "Use @include/@exclude directives for @-mentions"
    - "Keep reasoning steps explicit but concise"
    - "Batch independent tool calls in parallel"
    - "Cache query results using engram memory"

  # Error handling
  errorHandling:
    reference: "rules/NORMATIVAS-ERROR-HANDLING.md"
    strategy: "escalate-on-pattern-match"

# ============================================================================
# PHASE 4: SKILL CONTEXT SEGMENTATION
# ============================================================================
# Load skill-specific rules only when triggered (prevents context bloat)

skills:
  # Example: When triggered by "implement", load ONLY DEV context
  dev-context:
    trigger: ["implement", "code", "feature", "refactor"]
    load:
      - "skills/sdd-lifecycle/SKILL.md"
      - "skills/typescript-skill/SKILL.md"
      - "rules/DEVELOPMENT-STANDARDS.md"
`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const TARGETS: Array<{ file: string; render: (p: CanonicalProfile) => string }> = [
  { file: 'CLAUDE.md', render: renderClaudeMd },
  { file: 'CLAUDE.compressed.md', render: renderClaudeCompressed },
  { file: '.cursorrules', render: renderCursorRules },
  { file: '.clinerules', render: renderClineRules },
];

async function formatGenerated(file: string, content: string): Promise<string> {
  if (!file.endsWith('.md')) return content;
  const filepath = join(PROFILES_DIR, file);
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(content, { ...config, filepath, parser: 'markdown' });
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const profile = loadProfile();
  let drift = false;

  for (const target of TARGETS) {
    const generated = await formatGenerated(target.file, target.render(profile));
    const outPath = join(PROFILES_DIR, target.file);

    if (check) {
      const current = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';
      if (current !== generated) {
        console.error(`[DRIFT] ${target.file} no coincide con profiles.yaml`);
        drift = true;
      } else {
        console.log(`[OK] ${target.file} sincronizado`);
      }
    } else {
      writeFileSync(outPath, generated, 'utf-8');
      console.log(`[WROTE] ${target.file}`);
    }
  }

  if (check) {
    if (drift) {
      console.error(
        '[FAIL] Drift detectado — ejecutar: npx tsx src/orchestration/profiles-build.ts',
      );
      process.exit(1);
    }
    console.log('[OK] Todos los tool-profiles sincronizados con profiles.yaml');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
