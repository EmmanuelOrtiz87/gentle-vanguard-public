# Changelog

<p align="center">
  <b>All notable changes to this project will be documented in this file.</b>
</p>

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.21.0] - 2026-05-23 - Context Optimization & Token Efficiency

### Added

- **Context compression pipeline**: CLAUDE.md −79%, AGENTS.md −75%, NORMATIVES.md −92%, INTER-AGENT-COMMUNICATION.md −68%, behavior-prompts.json −70%
- **10 compressed SKILL.md files**: ui-mobile, cross-workspace-sync, monitoring-aggregator, parallel-execution-limits, fireworks-tech-graph, flutter, android-kotlin, android-architecture, android-jetpack-compose, backup-orchestrator (~5,200→~1,420 lines total)
- **8 new files**: docs/QUICK-COMMANDS.md, 6 NORMATIVAS-*.md (architecture, config, devops, docs, enforcement, git), 10 skills/*/references/patterns.md
- **SHA256-based pre-process cache**: `.session/preprocess-trigger-cache.json` eliminates rescan of 132 skills + 1.8K auto-delegation.json per invocation
- **Input guard thresholds**: softThresholdPct 70%, hardThresholdPct 90% in context-efficiency.json
- **Output token guard**: max 200 tokens non-code, tool output truncation rules in CLAUDE.md
- **Behavior prompt compression**: JSON schema examples replaced with config file references

### Changed

- **pre-compact-hook.ps1**: Compression ratio 0.90→0.60 for aggressive context preservation
- **auto-delegation.json**: Deduplicated BA keywords 105→80 (−24%)
- **token-display-config.json**: showAfterEachResponse false, turnInterval 5
- **opencode.json**: sliding-window 10 turns, threshold 8000, summarization enabled
- **Subagent delegation**: minimal context constraint (CLAUDE.md rule #9)

### Documentation

- **CONTEXT-ENGINEERING.md**: v1.3.0 with compaction params, SHA256 cache, input guard
- **NORMATIVAS-SESSION.md**: v1.2.0 with compression and context efficiency sections
- **AGENTS.md**: Key References table updated with all new files
- **NORMATIVES.md**: Converted to index with links to 6 new NORMATIVAS-*.md files

## [2.20.0] - 2026-05-21 - Core Autonomy & Deprecation Cleanup

### Added

- **CLAUDE.md Phase B step 10**: `mem_search "lessons learned"` — mandatory startup knowledge
  loading. Sessions now inherit learnings from previous sessions.
- **rules/AUTO-CONTRIBUTION.md**: Protocol for agent self-modification — what changes are permitted
  vs forbidden, with before/after validation workflow.
- **Skill registry auto-rebuild**: `scripts/utilities/build-skill-registry.ps1` — auto-maintains
  `.atl/skill-registry.md` (134 skills, 17 agent groups).
- **CodeGraph integration**: Index freshness check at startup, post-modification sync, CI
  validation, metrics tracker.

### Changed

- **Deprecation strategy**: Gateway (Telegram/Discord/WhatsApp), RPC server, plugin system, and
  multi-platform-gateway skill moved to `deprecated/`. 25+ files preserved for reference, zero
  functional loss.
- **NORMATIVAS-SESSION.md**: Gateway inbox steps removed from close protocol. Self-improving
  pipeline (usage-tracker → skill-nudge → skill-auto-patch) retained as core.
- **session-autostart.config.json**: Gateway-inbox-check step removed.
- **session-manager.ps1**: Invoke-GatewayCleanup removed from End-Session.
- **config/auto-delegation.json**: GATEWAY agent routing removed.
- **config/gateway.json** → `config/deprecated/` (contains secrets, gitignored).
- **README badges**: Version bumped to 2.20.0.

### Fixed

- **Karpathy enforcer**: Missing `param()` block caused silent delegation failure. Added
  `[ValidateSet]` parameter block + proper routing to `scripts/adaptive/`.
- **pre-process-input stub**: `WORKFLOW-ORCHESTRATION/pre-process-input.ps1` was a 31-line stub.
  Replaced with wrapper that delegates to `utilities/pre-process-input.ps1` (418 lines).

### Deprecated

- **Gateway multi-platform**: `scripts/gateway/`, `scripts/rpc/`, `plugins/`,
  `skills/multi-platform-gateway/` — moved to `deprecated/`. The gateway serves a different use case
  (external agent for multi-platform messaging) and does not contribute to core agent autonomy.
- **Plugin system**: Async ESM plugin loader (`plugin-loader.js`), dynamic tool routing, demo plugin
  (system-info). Implemented, tested, then deprecated — premature before core autonomy is solid.
- **Feedback loop**: JSONL feedback store, API endpoints, trend analysis. Deprecated with plugin
  system since it was designed for the gateway agent, not the core orchestrator.

## [2.19.0] - 2026-05-18 - Brand Identity & Visual System

### Added

- **MANIFESTO.md**: 5 founding principles of Gentle-Vanguard — AI as Engine, Business-Driven Code,
  Persistent Memory Architecture, Skill-Based Modularity, Elegance in CLI
- **config/brand.json**: Source of truth for visual identity — colors, gradients, typography, social
  dimensions
- **docs/brand/BRAND-GUIDELINES.md**: Usage rules, logo variants, clear space, color palette,
  forbidden uses
- **docs/brand/assets/logo-primary.svg**: Primary SVG logo with gradient arc + vector V
- **docs/brand/assets/logo-icon.svg**: Icon-only variant for favicons and small contexts
- **docs/brand/assets/favicon.svg**: 32x32 optimized favicon
- **docs/brand/assets/banner-docs.svg**: Documentation header banner (1200x280)
- **docs/brand/assets/banner-github.svg**: GitHub README hero banner (1280x320)
- **docs/brand/assets/banner-og.svg**: Open Graph social image (1200x630)
- **docs/brand/assets/banner-linkedin.svg**: LinkedIn company header (1584x396)
- **docs/brand/assets/banner-twitter.svg**: Twitter/X header banner (1500x500)
- **README.md**: Header updated with banner-github.svg, brand-colored badges, manifesto quote, skill
  count corrected to 134
- **model-router-tui**: TUI colors updated to official brand palette (`#00BFFF` primary, `#4DCFFF`
  selected, `#1A2035` surface)
- **Dist**: `Gentle-Vanguard.exe` rebuilt to 3.15 MB including all brand changes

### Changed

- **VERSION**: `2.16.0` → `2.19.0` (corrects inconsistency between VERSION file and CHANGELOG)
- **README badges**: Color scheme updated to brand palette (`#00BFFF`, `#4DCFFF`, `#A855F7`)
- **session-autostart.cmd/.ps1**, **gv.ps1**, **gentle-vanguard-installer-tui.ps1**: ASCII banner
  color set to `#00BFFF`

### Fixed

- **CHANGELOG.md**: Removed corrupted encoding characters (`??`) from all entries, normalized header

---

## [2.18.0] - 2026-05-18 - Cross-Tool Nivelación + README Governance

### Added

- **Cross-tool skill/mem emulation**: Cline, Cursor, Windsurf, Codex, Copilot, Antigravity,
  Continue.dev now emulate skill and memory tools via adaptive profiles
- **Antigravity adaptive profile**: Dedicated profile for Antigravity tool with session lifecycle
  hooks
- **Tool detection improvements**: Phase 0.5 exports `GENTLE_VANGUARD_TOOL`, `_CONFIG`, `_PROMPT`,
  `_CONFIDENCE` as env vars
- **Plugin system**: Phase 7 with `Initialize-Plugins`, `example-hello-world` enabled
- **Enhanced detection**: Phase 8 with `enhanced-detect.ps1`
- **Adaptive profiles**: 5 profiles for 10 tools (cursor, continue-dev, copilot, antigravity, codex
  added)
- **Orchestrator**: 10 tool profiles in `orchestrator.json`
- **SDD cleanup**: 300 zombie features removed from SDD state
- **README governance policy**: `rules/README-GOVERNANCE.md` — mandatory sections, prohibited
  actions, modification protocol, baseline tracking
- **README validation script**: `scripts/utilities/validate-readme.ps1` — automated governance
  checks
- **README pre-commit hook**: `hooks/validate-readme-hook.ps1` — blocks commits that fail validation
- **README restoration**: Both private and public READMEs restored to comprehensive format with
  Mermaid diagrams, architecture, agent ecosystem, skill catalog, CI/CD pipeline

### Fixed

- **MCP Bridge TypeScript**: `gentle-vanguardRoot` → `gentleVanguardRoot` (hyphen syntax error)
- **README version badges**: Updated to v2.18.0
- **Public README**: Added `sync-public.yml` to CI/CD pipeline table
- **Agent count consistency**: READMEs now correctly state 16 agents (Orchestrator + 15 sub-agents)

---

## [2.17.0] - 2026-05-18 - Cursor + Continue.dev Integration Sprint

### Added

- **Cursor Agent Best Practices**: `.cursor/rules/` (3 modulos: core-workflow, commands,
  code-style), `.cursor/commands/` (7 comandos: pr, review, status, test, fix-issue, update-deps,
  continue-check), `.cursor/hooks.json` + `hooks/grind.ts` (stop hook), `.cursor/plans/` directory,
  `.cursor/config.json` v2.0.0
- **Continue.dev Checks**: `.continue/checks/` (5 checks: security-review, test-coverage,
  documentation-freshness, dependency-audit, migration-safety), `.continue/config.json` v2.0.0 con
  `checks.paths` + `autoRunOnPR`
- **Tool Detection**: Phase 0.5 exporta `GENTLE_VANGUARD_TOOL`, `_CONFIG`, `_PROMPT`, `_CONFIDENCE`
  como env vars
- **Plugin System**: Phase 7 con `Initialize-Plugins`, `example-hello-world` habilitado
- **Enhanced Detection**: Phase 8 con `enhanced-detect.ps1`
- **Adaptive Profiles**: 5 perfiles para 10 herramientas (cursor, continue-dev, copilot,
  antigravity, codex agregados)
- **Orchestrator**: 10 tool profiles en `orchestrator.json` (added: codex, continue-dev, copilot,
  antigravity)
- **SDD Cleanup**: 300 features zombie removidas del SDD state

### Fixed

- **MCP Bridge TypeScript**: `gentle-vanguardRoot` → `gentleVanguardRoot` (hyphen syntax error)
- **README**: Version badges actualizados a v2.17.0

## [2.16.0] - 2026-05-16 - Phase 3: Orchestration & Intelligence Sprint

### Added

- **Phase 3.1 — Inter-agent Communication** (`scripts/adaptive/agent-message-bus.ps1`): File-based
  mailbox system with structured message schema (id, type, sender, recipient,
  conversation/correlation ids), priority queue, TTL expiry, request/response protocol, and JSONL
  audit log. Integrated into `dispatch-agent.ps1` with auto-send of agent.completed messages. New
  `gv dispatch message` sub-command.
- **Phase 3.2 — Cost-aware Model Routing** (`scripts/utilities/MODEL-ROUTER/cost-optimizer.ps1`,
  `config/provider-costs.json`): Cost database for 4 providers / 12 models with
  free/standard/premium tiers. Provider routing by cheapest available, cost comparison, token cost
  projection, session spend tracking (`.session/token-spend.json`). Commands: `route`, `compare`,
  `estimate`, `session-spend`, `status`.
- **Phase 3.3 — Memory Reconciliation** (`dispatch-memory-manager.ps1`): `Detect-ContextConflicts`
  (key-level value conflict detection across dispatches), `Merge-Contexts` (deterministic merge:
  latest scalar wins, array union, nested deep-merge), `Invoke-Handoff` (cross-session context
  transfer). Commands: `reconcile`, `handoff`.
- **Tab Completion** (`scripts/utilities/register-gentle-vanguard-completion.ps1`):
  `Register-ArgumentCompleter` for `gentle-vanguard` command with 70+ commands + subcommands.
  Auto-loaded via `install-gentle-vanguard-cli.ps1`.
- Parallel batch dispatch via `Start-BatchOrchestrator` in `auto-delegate-orchestrator.ps1` with
  `-AgentTypes` parameter and dependency queue processing.

### Changed

- **gv.ps1 modularization** (Phase 2.3): Extracted 48 functions (1622 lines) into 3 command modules
  (`commands/common.ps1`, `commands/git.ps1`, `commands/context.ps1`). gv.ps1 reduced from 3393 to
  ~1765 lines. Uses `dot-source` approach with `$global:scriptDir`/`$global:repoRoot` exports.
- `dispatch-agent.ps1`: Migrated from `Start-Job` (process-based) to Runspace pool (thread-based)
  for ~10x faster parallel dispatch.
- `provider-failover.ps1`: Provider availability checker with failover chain (OpenRouter → Anthropic
  → OpenAI → Ollama), 5-min cache in `.session/provider-state.json`.
- Rewrote tests: `engram-memory-manager.tests.ps1` (10 real engram.exe tests) and
  `engram-performance.perf.tests.ps1` (4 latency tests).
- VERSION file corrected from stale 1.2.0 to 2.15.0 to match README and git tags.

### Fixed

- `dispatch-agent.ps1`: Fixed `$jobs` → `$psInstances` variable name bug that silently dropped
  results in parallel batches.
- `Write-Error` naming consistency across gv.ps1 command modules.

### Backlog

- Future sessions: expand declared real coverage to additional operational scripts beyond the
  session and post-session-learning workflows.

---

## [1.2.0] - 2026-05-15 - Security, Compliance & Performance Sprint#

### ✨ Added#

- **`gv secret` CLI** (`scripts/security/secret-vault.ps1`): Full enterprise-grade secrets
  management with DPAPI-encrypted local vault (`~/.gentle-vanguard/vault/`), 7 commands (`create`,
  `get`, `rotate`, `list`, `validate-compliance`, `audit-report`, `breach-response`), immutable
  JSONL audit trail, rotation-due tracking, and P1 breach response with incident reports.
- **SIEM Audit Bridge** (`scripts/security/siem-audit-bridge.ps1`): Routes `logs/secret-audit.jsonl`
  to structured ECS-compatible output with anomaly detection (mass access, repeated failures, breach
  events). Supports Splunk HEC, Datadog, ELK, and generic webhook. Checkpoint-based incremental
  processing for scheduled runs.
- **Intelligent Cache Manager** (`scripts/adaptive/cache-manager.ps1`): Multi-tier L1 (memory 2min)
  → L2 (file 30min) → L3 (persistent 4hr) → Archive caching with read-through promotion, auto-tier
  selection, tag-based invalidation, and GC. Zero external dependencies.
- **GDPR Compliance Framework** (`rules/NORMATIVAS-GDPR.md`): 413-line normative covering 7
  principles, user rights (Art.15-21), data retention schedules, 72-hour breach protocol, DPIA,
  third-party processors, and agent compliance checklist.
- **SOC2 Type II Framework** (`rules/NORMATIVAS-SOC2.md`): 540-line normative covering 5 Trust
  Service principles (CC, A, PI, C, PR), P1-P4 incident SLAs (15min/1hr/24hr/1wk), 99.5% uptime
  target, and annual attestation framework.
- **Secrets Governance Policy** (`config/secrets-governance.json`): 8 secret classifications with
  rotation frequencies, 4 authorized vault types, zero-trust RBAC, automated rotation schedule
  (cron), and pre-commit/pre-deployment enforcement gates.

### 🔧 Fixed#

- **AI-NORMATIVES.md Section 15**: Integrated all 3 compliance frameworks with mandatory agent
  checklist and enforcement gates.
- **`config/observability-config.json`**: Added `siem` section (provider config, alert thresholds,
  compliance refs SOC2 CC7.2 / GDPR Art.33); bumped `audit_logs_days` 365 to 730 (2-year SOC2
  retention).
- **`.gitignore`**: Added `logs/*.jsonl` pattern to exclude runtime audit logs from version control.

### 📚 Changed#

- **`bin/gv.ps1`**: Added `gv secret` and `gv cache` command routing with full help text.
- **VERSION**: Bumped to `1.2.0`.
- **`build/gentle-vanguard-installer-auto.nsi`**: Updated installer version to `1.2.0`.

### 🔐 Compliance#

- **Mandatory deadline**: GDPR + SOC2 + Secrets enforcement active from 2026-06-01.
- **References**: GDPR Art.32/33, SOC2 CC6.1/CC7.2, `config/secrets-governance.json`.
- **Validation**: `gv secret validate-compliance` scans workspace for hardcoded secrets and rotation
  overdue.

---

## [1.1.0] - 2026-05-15 - Compliance Frameworks (merged to main)#

> Note: 1.1.0 compliance frameworks (GDPR, SOC2, Secrets Governance) are included in full in 1.2.0
> above.

---

## [1.0.1] - 2026-05-13 - Live Dashboard Stabilization#

### ✨ Added#

- **Dynamic observability dashboard**: Preserved active tab state, stabilized live metric hooks, and
  documented the `gv dashboard live` flow for the current release.
- **Public release alignment**: Prepared synchronized publication for both `gentle-vanguard` and
  `gentle-vanguard-public`, including the refreshed `Gentle-Vanguard.exe` artifact.

### 🔧 Fixed#

- **Live dashboard server**: Switched the default live port to `8090` to avoid local conflicts
  observed on `8080`.
- **SSE delivery**: Refactored `/events` to emit one update per request so the single-listener
  server no longer blocks `/health` and `/dashboard.html`.
- **Dashboard refresh UX**: Removed destructive refresh behavior in served mode and kept timed
  refresh only as a fallback when push mode is unavailable.

### 📚 Changed#

- **CLI guidance**: Updated core docs to promote `gentle-vanguard` as the canonical command while
  keeping compatibility wrappers in place.
- **Release artifacts**: Bumped patch version to `1.0.1` across repo metadata and release notes.

---

## [1.0.0] - 2026-05-13 - Initial Production Release#

### ✨ Added#

- **Gentle-Vanguard Stack Update Strategy**: Documented three update scenarios (lightweight CLI
  updates, core .exe builds, dev synchronization)
- **sync-stack.ps1**: New synchronization script for updating installed Gentle-Vanguard without
  reinstalling
- **Comprehensive validation hardening**: Made LESSONS-LEARNED-HOOKS-INCIDENT.md optional, added
  safe property checks for opencode.json
- **Gentle-Vanguard-Setup.exe**: Generated with complete hardening (v1.0.0)

### 🔧 Fixed#

- **Autonomous Validation**: Fixed exit code handling for optional documentation and missing JSON
  properties (commit a224090)
- **cross-platform-tests.yml**: Corrected shellcheck SC2129 and SC2086 warnings in bash redirect
  blocks (commit 33e5cc5)
- **Agent-verify**: Fixed domain parsing to use array syntax instead of CSV (commit 6e88e01)
- **Gitleaks allowlist**: Added sanctioned sync references (PAT_SYNC, PRIVATE_REPO, x-access-token)
  for both repos

### 📚 Changed#

- **VERSION**: Set to 1.0.0 across all repos and build artifacts
- **README badges**: Updated to reflect production 1.0.0 version
- **package.json**: Added version field (1.0.0) for consistency
- **Workflow standardization**: Unified line endings and formatting across all 13+ GitHub workflows

### 📋 Known Limitations#

- Auto-update feature (remote version checking) marked for future release
- Docker validator skipped in pre-push hooks (not yet implemented)
- Links validator skipped in pre-push hooks (not yet implemented)

---

## [2.12.0] - 2026-05-14 - Self-Healing Stack + Watchtower + Proposal Executor#

### ✨ Added#

- **Self-Healing Stack**: New `scripts/utilities/self-heal.ps1` with 5 modular healers — Config
  (JSON validation, trailing comma fix), Hooks (git hook presence & freshness), Session (corrupt
  JSON recovery), Skills (SKILL.md integrity, auto-delegation reference validation), Engram (process
  health, auto-restart). Supports `-AutoFix`, `-Scope`, `-Quiet`.
- **`gv heal` command**: New CLI command to run self-healing checks. `gv heal fix` auto-repairs
  issues. Scoped mode: `gv heal config|hooks|session|skills|engram`.
- **Watchtower Agent**: New `scripts/utilities/watchtower.ps1` with 6 proactive health checks — git
  state, token budget, context pressure, session age, pending proposals, error patterns. Integrated
  as `gv watchtower fix|quiet|all|heal`. Added to session-autostart Phase 10.
- **Proposal Executor**: New `scripts/utilities/proposal-executor.ps1` that reads
  `.local/improvement-proposals/*.json` and dispatches to category-specific executors
  (`missing-skill`, `config-gap`, `pattern-opportunity`). Integrated as
  `gv learning apply|auto|auto-pr`.
- **Watchtower→Heal integration**: `gv watchtower heal` runs self-heal first (avoids stash race),
  then watchtower with auto-fix.

### 🔧 Fixed#

- **PS5.1 variable interpolation**: Fixed `$Healer:` → `${Healer}:` in self-heal.ps1 (PowerShell 5.1
  compat)
- **Watchtower stash ordering**: Heal runs before watchtower stash to prevent self-heal.ps1 from
  being stashed before execution

### 📚 Changed#

- **NORMATIVAS-SESSION.md**: Added checkpoint 13 (self-healing check post-watchtower)
- **GV.ps1**: Added 'heal' to ValidateSet, added heal dispatch block with scope support
- **VERSION**: Bumped to 1.1.0 (minor: new features)

---

## [2.18.0] - 2026-05-18 - Cross-Tool Nivelación Sprint#

### Added#

- **Antigravity v2.0**: Config completo con emulación de skills, engram memory, session management.
  Adaptive profile dedicado (`adaptive-antigravity-profile.ps1`).
- **Detección de Antigravity**: `detect-tool.ps1` ahora detecta `.antigravity/` directory
  (confidence 80).
- **Skill Emulación cross-tool**: 7 configs actualizados con `skillEmulation`, `criticalSkills`,
  `engramPaths`, `skillRegistry` para tools sin skill/mem nativos (cline, cursor, windsurf, codex,
  copilot, antigravity).
- **Memoria entre sesiones**: Todas las tools ahora referencian `.engram-data/`,
  `scripts/.session/startup-summary.json`, y `engram_mem_context.ps1` para persistencia
  cross-session.
- **Nivelación de toolProfiles**: Antigravity tiene adaptive profile propio. Todas las tools tienen
  emulación funcional equivalente.

### Changed#

- **VERSION**: 2.16.0 → 2.18.0 (fix + bump)
- **.windsurf/config.json**: project name corregido de "foundation" a "gentle-vanguard"
- **.clinerules**: references extendidas con skillRegistry + engram + sessionContext
- **.cursor/rules/core-workflow.md**: secciones de skill loading y memoria emulada

---

## [2.11.0] - 2026-05-14 - Post-Session Learning System + Business Skills#

### ✨ Added#

- **Post-Session Learning System**: New `skills/post-session-learning-skill/` with 5-step learning
  workflow. New `scripts/utilities/post-session-learning.ps1` that analyzes session artifacts
  (startup-summary, git log, engram) to detect gaps — missing skills, repeated errors, token waste,
  config gaps. Generates structured improvement proposals saved to `.local/improvement-proposals/`.
- **`gv learning` command**: New CLI command to run post-session learning analysis.
  `gv learning auto` auto-applies low-severity proposals.
- **Session close integration**: Step 10 in NORMATIVAS-SESSION.md close checklist — `gv learning`
  before session end.
- **12 business skills**: Created real SKILL.md files for accounting, compliance, CRM, ERP,
  insurance, logistics, payroll, procurement, real-estate, recruitment, supply-chain, tax — each
  with domain-specific instructions, key metrics, triggers in ES/EN, and response patterns.
- **Business skills index**: Updated `skills/business/SKILL.md` with active skills table and trigger
  keywords.

---

## [2.10.0] - 2026-05-14 - Stack Hardening: OS Detection, Project Root, Modification Protocol#

### ✨ Added#

- **OS detection integrado al startup flow**: detect-tool.ps1 ahora devuelve `$detected.os` con
  `platform/shell/pathSeparator/isWindows`. post-autostart-summary.ps1 incluye
  `platform/shell/pathSeparator` en startup-summary.json. CLAUDE.md y AGENTS.md instruyen al agente
  a leer `$detected.os.platform` antes de ejecutar comandos, eliminando tokens desperdiciados en
  scripts de plataforma equivocada.
- **projectRoot en orchestrator.json**: Nueva sección `workspace` con `projectRoot: projects/`,
  `configFile`, `projectDefaults`. AGENTS.md/CLAUDE.md referencian la ruta canónica para nuevos
  proyectos.
- **config/workspace.config.json**: Creado desde el example — fuente única de verdad para rutas de
  workspace, proyectos y defaults.
- **Modification Protocol (5 fases)**: Nueva sección en `rules/DEVELOPMENT-STANDARDS.md` —
  Explore→Scope→Validate→Modify→Post-Validate. Define cómo el agente debe abordar proyectos
  existentes antes de modificar.
- **SessionStart OS-aware**: detect-tool.ps1 resuelve `instructions.sessionAutostart` dinámicamente
  (.cmd en Windows, .sh en Linux/macOS).
- **sessionStartPlatform en tool configs**: 7 archivos `config/tool-*.json` ahora incluyen
  `sessionStartPlatform` con alternativas por SO.
- **pwsh fallback en NORMATIVAS-CROSS-PLATFORM.md**: Nueva sección 11 — availability check, tabla de
  fallback por plataforma, comportamiento cuando falta pwsh.

### 🔧 Fixed#

- **detect-tool.ps1**: sessionAutostart ya no es hardcodeado a .cmd — se resuelve según OS
  detectado.
- **Tool configs**: 7 configs hardcodeaban `.cmd` sin alternativa Linux/macOS. Ahora tienen mapa
  `sessionStartPlatform`.
- **8 backslashes hardcodeados**: detectados en auditoría (bootstrap-workspace.ps1, detect-tool.ps1,
  pre-process-input.ps1, auto-delegation-wrapper.ps1) — documentados para migración futura.
- **post-autostart-summary.ps1**: Variables `$isLinux`/`$isMacOS` renombradas a
  `$osIsLinux`/`$osIsMacOS` por conflicto con variables automáticas read-only de PS7.

### 📚 Changed#

- **CLAUDE.md**: Startup step 1 usa `$detected.instructions.sessionAutostart` (OS-aware). Nuevas
  secciones: "New Project & Modification Rules", referencias a workspace.config.json y
  DEVELOPMENT-STANDARDS.md.
- **docs/AGENTS.md**: Tool detection incluye OS output. Step 6 incluye platform/pathSeparator.
  Nuevas secciones: "New Project & Modification Rules", referencias a workspace.config.json.
- **rules/NORMATIVAS-CROSS-PLATFORM.md**: Renumbered sections 10→14, añadida sección 10 (pwsh check
  & fallback).

---

## [2.9.1] - 2026-05-12#

### 🔧 Fixed#

- **create-installer.ps1**: Hardened launcher build error handling so protected-artifact generation
  fails fast with a real exception instead of a false `$LASTEXITCODE` check
- **sync-to-public.ps1**: Fixed remote HEAD detection to avoid null-match failures during public
  repository synchronization
- **release workflow**: Aligned GitHub Release note extraction with the canonical root
  `CHANGELOG.md`
- **Session routing**: Removed `iniciar sesion` / `start session` from auto-delegation in favor of
  the canonical startup protocol defined in `CLAUDE.md`
- **SESSION skill docs**: Updated session workflow guidance to avoid duplicate start-session
  handling
- **Documentation sync**: Rebuilt and published `Gentle-Vanguard-Setup.exe` for
  `gentle-vanguard-public`, keeping the public installer current

### 📚 Changed#

- **VERSION**: Bumped from `2.9.0` to `2.9.1`
- **README badge**: Updated visible version badge to `2.9.1`
- **Public release process**: Gentle-Vanguard and gentle-vanguard-public are now aligned on the same
  validated patch release

---

## [2.9.0] - 2026-05-11#

### ✨ Added#

- **Model Router v2.2.0**: Reassigned all agent models to open-source subscription stack (GLM5, Kimi
  K2.6, Qwen 3.6 Plus via OpenRouter)
- **Agent visibility control**: All subagents marked `hidden: true` in opencode.json — only
  orchestrator is user-selectable; subagents are managed autonomously
- **OpenRouter provider**: Primary LLM provider configured for open-source model access

### 🔄 Changed#

- **opencode.json**: Complete rewrite — removed Anthropic/OpenAI default model references, switched
  to OpenRouter as primary provider, added `hidden: true` + `mode: "subagent"` to all
  non-orchestrator agents
- **config/model-router.json**: All 29 agent bindings updated from `opencode/gpt-*` to
  `openrouter/{glm-5|kimi-k2.6|qwen-3.6-plus}`
- **Default model**: Changed from `anthropic/claude-sonnet-4-5` to `openrouter/z-ai/glm-5`
- **Small model**: Set to `openrouter/qwen/qwen-3.6-plus` for lightweight tasks (title generation,
  compaction)

### 🗑️ Removed#

- **Direct Anthropic/OpenAI agent models**: All agents now route through OpenRouter for
  subscription-based open-source models

---

## [2.8.2] - 2026-05-10#

### ✨ Added#

- **Model Router v2.1.0**: 29-agent model-router with pipeline fixes and doc updates
- **14 custom agents**: Added Go-tier custom agents with model assignments
- **Portable multi-machine bootstrap**: Setup scripts for PC migration and runner installation
- **Session GitHub bypass**: Permanent enforcement of GitHub bypass at session start
- **Judgment Day paths**: Auto-generated paths added to `.gitignore`

### 🔄 Changed#

- **CI/CD optimization**: GHA workflow triggers optimized, pre-push hooks aligned
- **Sync workflows**: Consolidated sync steps, fixed PAT_SYNC auth and hardcoded branch
- **Dependencies**: Bumped `github/codeql-action` v3→v4, `actions/labeler` v5→v6, `actions/cache`
  v4→v5
- **Gitleaks allowlist**: Expanded for security-expert-skill, fixed format
- **Prettier config**: Added `.prettierignore`, excluded ps1/template/lefthook/package-lock

### 🛠️ Fixed#

- **GHA job permissions**: Added `actions:read` for CodeQL SARIF upload, `contents:read` to SAST
- **Sync errors**: Resolved `sync-public PAT_SYNC error` and hardcoded branch reference

---

## [2.8.1] - 2026-05-08#

### ✨ Added#

- **ROADMAP.md**: Project vision with short/mid/long-term milestones
- **docs/guides/RELEASE-PROCESS.md**: Documented release checklist
- **docs/guides/BRANCH-STRATEGY.md**: Git flow conventions documented
- **format-check.yml**: Prettier formatting CI workflow (15 workflows total)
- **npm scripts**: `format:check`, `format:fix` added to package.json
- **prettier**: Added as devDependency

### 🔄 Changed#

- **CONTRIBUTING.md**: Complete rewrite — URLs fixed to `gentle-vanguard-public`, test counts
  corrected (28), prerequisites updated
- **VERSION**: Synced from `2.6.5` to `2.8.0`
- **Stale branches**: 4 merged branches deleted (`feature/judgment-day`, `feature/security-system`,
  `pr/judgment-day-native`, `release/v1.0.0`)

---

## [2.8.0] - 2026-05-08#

### ✨ Added#

#### 🏗️ Project Infrastructure#

- **CODE_OF_CONDUCT.md**: Standard contributor covenant
- **PR template**: `.github/PULL_REQUEST_TEMPLATE.md` — conventional commit checklist
- **Dependabot**: `.github/dependabot.yml` — weekly GitHub Actions updates
- **CodeQL**: `.github/workflows/codeql-analysis.yml` — `actions` language only,
  `continue-on-error: true`
- **Labeler**: `.github/labeler.yml` — auto-labels PRs by changed paths
- **Linting configs**: `.markdownlint.json` (MD033 with allowed elements), `.prettierrc`
- **Security configs**: `.trivyignore`, `.secretlintrc.json`, `.secretlintignore`
- **Architecture Decision Records**: `docs/adr/ADR-0001-gentle-vanguard-architecture-decisions.md` —
  7 decisions documented

#### 🧪 CI/CD Pipeline#

- **test-suite.yml**: Full CI test workflow — runs on push/PR to main/develop, executes 28 tests,
  uploads results artifact
- **quality-gate.yml**: Central quality gate with `timeout-minutes` fixed (duplicate removed)
- **ps-lint.yml**: Caching enabled for PSScriptAnalyzer

#### 🔧 Git Hooks#

- **json-lint.ps1**: Pre-commit JSON validation script (replaces inline `-Command` to fix quoting)
- **workflow-lint.ps1**: Pre-commit workflow YAML validation — detects unsupported CodeQL languages,
  missing Trivy format/output

#### 🛠️ Installer Improvements#

- **Go auto-install**: `install-prerequisites.ps1` — checks via `go version`, installs via
  `winget install GoLang.Go`
- **Engram auto-install**: `install-prerequisites.ps1` — checks via `engram`, installs via
  `go install github.com/gentle-vanguard/engram/cmd/engram@latest`
- **TUI installer**: Interactive prompts for Go and Engram installation post-clone
- **sync-to-public.ps1**: Now copies `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md` to public repo

---

### 🔄 Changed#

#### 🔧 Lefthook v2 Migration#

- `.lefthook.yml`: Full rewrite to v2 syntax — `commands:` with `run:` for inline, `scripts:`
  without `run:` for script files
- Pre-commit: 3 hooks (json-lint, opencode-validation, workflow-lint)
- Pre-push: 4 hooks (audit-check, orchestrator-auto-fix, test-suite, trufflehog)
- commit-msg: commitlint via `@commitlint/cli`

#### 📚 Documentation#

- **README.md**: URLs updated from `anomalyco/gentle-vanguard` to
  `EmmanuelOrtiz87/gentle-vanguard-public`
- **BOARD-SUPPLEMENT.md**: Repo URLs updated — both public and private repos listed
- **CONTRIBUTING.md**: Clone URL updated to `gentle-vanguard-public`
- **TESTING-STRATEGY.md**: Rewritten with actual test states (22 unit + 3 integration + 2 security +
  1 perf)
- **tests/README.md**: Corrected test counts and categories
- **SECURITY-HARDENING.md**: Fixed corrupted accented characters (32 patterns restored)
- **COMPATIBILITY-MATRIX.md**: Updated with code quality standards checklist
- **Marketing URLs**: All 3 marketing files updated from `anomalyco/opencode` to
  `EmmanuelOrtiz87/gentle-vanguard-public`
- **Bitbucket references**: SUITE-OVERVIEW.md URL fixed

#### 🧩 Skills Reorganization#

- 8 business skills moved to `skills/business/` subdirectory
- `skills/documentation-manager.ps1` → `skills/documentation-manager-skill/` with proper `SKILL.md`
- `skills/SKILL_INDEX.md`: Links updated to reflect new paths

#### 🧹 Workspace Homologation#

- 52 stale files at `C:\Workspace_local\` root archived to `_archive/`
- `C:\Workspace_local\` now contains only: `gentle-vanguard`, `gentle-vanguard-public`,
  `bitbucket-dashboard`, and system dirs

---

### ✅ Fixed#

#### 🐛 Pre-Push Hooks#

- **audit-check**: Path switched to forward slashes for cross-platform compatibility
- **config validator**: Changed from output regex to `$LASTEXITCODE` for reliability
- **trufflehog**: Flags updated to `--no-update`, `--since-commit origin/main`
- **orchestrator-auto-fix**: Reliable exit code detection

#### 🐛 Pre-Commit Hooks#

- **json-lint**: Moved from inline `-Command` (backtick escaping issues) to `hooks/json-lint.ps1`
  with `-File`
- **opencode-validation**: Required sections changed to Spanish to match actual NORMATIVAS docs

#### 🐛 CI/CD#

- **CodeQL**: Removed unsupported `powershell` language from matrix (kept `actions` only)
- **CodeQL**: Added `continue-on-error: true` for private repos without Advanced Security
- **Trivy**: Added explicit `format: json` + `output: trivy-report.json` + `if: always()` +
  `retention-days: 30` in OWASP and dependency-backup workflows
- **quality-gate**: Removed duplicate `timeout-minutes` line

#### 🐛 Documentation & Orphaned Files#

- **25 broken Markdown links**: Fixed across 10 documentation files
- **NORMATIVAS link**: Last broken link resolved
- **Dead code**: Removed Spanish duplicate section in `pre-commit-config-validation.ps1` (after
  `exit 0`)
- **Orphaned AI-TOOLS-COMPATIBILITY-MATRIX.md**: Removed from `gentle-vanguard-public` (superseded
  by `COMPATIBILITY-MATRIX.md` v1.1.0)

#### 🐛 Installer#

- **NSIS case**: Fixed `Gentle-Vanguard-Installer.nsi` → `gentle-vanguard-installer.nsi` in sync
  script

---

### 🧪 Tests#

- **Reorganized**: Tests split into unit (22), integration (3), security (2), performance (1) — 28
  total, 100% PASS
- **tests/README.md**: Added with test documentation
- **categories updated**: `COMPATIBILITY-MATRIX.md` reflects new test structure
- **Pre-push test-suite**: Runs all 28 tests before push — 0 failures

---

## [2.7.0] - 2026-05-06#

### ✨ Added#

#### 🏗️ Documentation Standards & Visual Design#

- **New Default Behavior**: All official documentation now follows visual design standards
- **Badges**: shields.io badges for version, status, license, runtime
- **Emojis**: Strategic emojis in headers, list items, callouts
- **Tables**: Structured data presentation with emojis
- **ASCII Art**: Visual diagrams for architecture and reports
- **Section Separators**: Horizontal rules between major sections

#### 🎨 Marketing Materials#

- **docs/marketing/README.md**: Completely renovated with visual design
- **docs/marketing/GENTLE_VANGUARD-STACK-SOCIAL.md**: Updated with emojis and tables
- **docs/marketing/gentle-vanguard-stack-blog-post.md**: Enhanced with literary techniques

#### 📚 Core Documentation#

- **docs/README.md**: Hub document completely renovated (468 lines)
- **docs/getting-started/README.md**: Quick start guide with 3-step wizard
- **docs/architecture/README.md**: Architecture hub with 5-layer topology
- **docs/guides/README.md**: Navigation guide with all 40+ guides
- **docs/reference/README.md**: Technical reference hub
- **docs/audits/README.md**: Audit workflow documentation
- **docs/sessions/README.md**: Session lifecycle artifacts
- **docs/tasks/README.md**: Task briefs documentation
- **docs/specs/README.md**: Technical specifications

#### 🔧 Gentle-Vanguard Audit & Fixes#

- **audit-sweep.ps1**: Added null check for empty files
- **audit-sweep.ps1**: Exclude `.opencode/node_modules/` from link validation
- **auto-delegation-router.ps1**: Fixed PowerShell switch bug (now uses if/elseif)
- **auto-delegation-router.ps1**: Fixed confidence scoring logic
- **tests/integration**: Updated expectations to match actual behavior
- **CLAUDE.md**: Corrected path to `pre-process-input.ps1`
- **autonomous-validation.yml**: Added UTC mapping in cron comment
- **tools/ and projects/**: Created missing directories
- **125 skills**: All PASS validation
- **30 tests**: 20 unit + 10 integration — 100% PASS

---

### 🔄 Changed#

#### 📏 Documentation standards.md#

- Added **Section 7: Default Documentation Behavior**
- Defines visual design requirements for ALL official docs
- Enforcement via `agent-verify.ps1` and `gv validate`

#### 📂 Documentation Structure#

- **docs/README.md**: Now serves as documentation hub
- **docs/guides/README.md**: Lists all 40+ guides with emojis
- **docs/reference/README.md**: Technical reference with tables

---

### ✅ Fixed#

#### 🐛 Bug Fixes#

- **PowerShell switch bug**: `Calculate-ConfidenceScore` now uses if/elseif (not switch)
- **Audit false positives**: Excluded `.opencode/node_modules/` from link validation
- **CLAUDE.md**: Fixed wrong path `tools/` → `scripts/utilities/`
- **Missing directories**: Created `tools/` and `projects/`

---

## [2.6.5] - 2026-05-05#

### ✨ Added#

#### 🏢 Enterprise CI Hardening#

- `.github/workflows/ps-lint.yml`: PSScriptAnalyzer static analysis CI — Error severity blocks
  merge; warnings annotate PRs
- `.github/workflows/release.yml`: Automated GitHub Release creation on semver tag push; validates
  tag vs VERSION file
- `.github/dependabot.yml`: Weekly GitHub Actions version update automation (minor+patch grouped,
  max 5 PRs)
- `VERSION`: Single source of truth for current project version (`2.6.5`)
- `SECURITY.md`: Security policy — vulnerability reporting process, supported versions, 48h ack SLA,
  security controls table

#### 📋 Normativas (Rules)#

- `rules/POWERSHELL-STANDARDS.md`: Canonical PS1 coding standards — file headers, param
  declarations, error handling, output safety, path handling, security rules, naming conventions,
  PSSA configuration
- `rules/CI-HARDENING-STANDARDS.md`: Mandatory CI workflow requirements — permissions, concurrency,
  timeout defaults, action pinning, secrets handling, audit checklist
- `rules/TESTING-STANDARDS.md`: Testing pyramid, coverage targets, Pester 5 patterns, new-script
  test rule, quality gates

#### 🔧 gv CLI Improvements#

- `gv version`: New command — shows stack version from VERSION file, orchestrator version, PS
  version, and skill count#

#### 🧪 Tests#

- `tests/unit/v264-scripts.tests.ps1`: Existence + parse + behavior tests for FF-001/002/004/006
  scripts#

### 🔄 Changed#

- `.gitignore`: Added entries for `reports/dashboard.html`, `reports/metrics-export.csv`,
  `reports/gv-benchmark.json`, `trivy-report.json`, `.event-bus/`, `.session/`
- `config/quality-gates.json`: Added `ps-lint`, `sdd-gate`, `owasp-scan` to `requiredWorkflows`
  (v1.1.0)

---

## [2.6.4] - 2026-05-05#

### ✨ Added#

#### 🔧 FF-001 — SDD CI Hardening (O-38)#

- `scripts/hooks/check-sdd-gate.ps1`: validates that at least one SDD doc with status `validated`,
  `done`, or `active` exists before committing/pushing to protected branches#
  - Blocking for `main`; advisory for `develop`; skipped on feature/bugfix branches#
  - Integrates with `hook-advisory-classifier.ps1` (Add-BlockingFinding/Add-AdvisoryFinding)#
- `.github/workflows/sdd-gate.yml`: CI workflow triggered on PRs to main/develop; runs
  `check-sdd-gate.ps1` on Windows runner#
- `gv.ps1`: `sdd-gate` command registered in ValidateSet + switch + help#

#### 🔧 FF-002 — SDD Process Metrics (O-39)#

- `scripts/utilities/TELEMETRY-METRICS/sdd-process-metrics.ps1`: computes spec coverage %, avg lead
  time (days), rework ratio %, and SDD document status breakdown#
  - Reads `docs/backlog/items.json` + `docs/sdd/*.md`#
  - Health signals: GREEN/YELLOW/RED per KPI; `-AsJson` for machine-readable output#
- `gv.ps1`: `sdd-metrics` command registered in ValidateSet + switch + help#

#### 🔧 FF-004 — Sync Drift Prevention (O-40)#

- `scripts/utilities/sync-drift-report.ps1`: compares declared config vs actual filesystem#
  - Checks: skills declared in `auto-delegation.json` vs `skills/` dirs; MCP servers vs local
    presence; done backlog `resolved_by` script refs vs actual files#
  - Outputs drift score + categorized findings; exits 1 when drift > 0#
  - `-AsJson` for machine-readable output#
- `gv.ps1`: `sync-drift` command registered in ValidateSet + switch + help#

#### 🔧 FF-006 — Local Workflow Performance (O-41)#

- `scripts/utilities/gv-benchmark.ps1`: profiles key `gv` commands with `Measure-Command` and
  compares against configurable SLO thresholds#
  - Default commands: `status`, `health`. Custom via `-Commands status,health,verify`#
  - PASS/WARN/FAIL per command; report persisted to `reports/gv-benchmark.json`#
  - SLO defaults: status ≤5 s, health ≤15 s, verify ≤30 s (override via
    `config/testing.config.json#benchmark.slo`)#
- `gv.ps1`: `benchmark [cmds]` command registered in ValidateSet + switch + help#

### 🔄 Changed#

- `docs/backlog/items.json`: all 7 backlog items now `done` — FF-001/002/004/006 resolved this
  release#

---

## [2.6.3] - 2026-05-05#

### ✨ Added#

#### 🔧 FF-013 — Runtime Router Gating (O-35)#

- `runtime-router.ps1` extended with
  `-Mode gate -TaskType (ai|heavy-ai|network|local|metrics|any)`:#
  - Exit 0=allowed, 1=warned, 2=blocked based on runtime mode + token status + event-bus rate limit#

---

<p align="center">
  <b>📃 Ready to see what changed?</b><br>
  <code>git log --oneline --since="2026-04-01" | Select-Object -First 30</code>
</p>
