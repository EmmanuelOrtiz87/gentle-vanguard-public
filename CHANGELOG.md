# Changelog — Gentle-Vanguard

## [Unreleased]

## [4.0.0] — 2026-09-01 — Stack Consolidado

### Hitos

- Absorción gentle-ai v2.5.0: continuations end-to-end, ack-before-burn, path-identity, typed
  refusals, capabilities.
- Design system GV v1 (css canonico, re-skin 6 apps, logo oficial, i18n es/en/pt dual-theme).
- Apps local-first desacopladas del repo del stack (git propio por producto).
- Nexus DB movido a `src/database/nexus/` (stack-tracked; dashboard usa re-export shims).
- Command Center: power widget en todas las apps; Prompt Studio v2 standalone; CMS F2.

### Seguridad

- CVE-2026-39824 purgado (golang.org/x/sys v0.36.0 en go.sum).
- Deps: setup-node v7, pnpm/action-setup v6, codecov v7, js-yaml 5.3.0.

### Limpieza

- PRs dependabot obsoletos cerrados, ramas stale eliminadas, deployments github-pages eliminados.
- Dockerfile/compose simplificados a imagen MCP-only; CI completamente verde.

### Added

- **Process Hygiene (reaper nativo)**: `src/core/process-hygiene.ts` — detección y limpieza de
  basura de procesos por clase (duplicados con keeper pidfile/port, one-shots colgados >15min,
  daemons envejecidos >24h reciclados solo si autostart los re-spawnea, pidfiles stale, chrome
  headless residual). Integrado: paso fase-1 del session-autostart (antes de los lazy daemons),
  check + autoheal del watchtower (96 checks / 22 componentes) y sweep en session-close (5.3b).
  Comandos: `npm run process:hygiene` (dry-run) / `process:reap`. Reporte en
  `.runtime/process-hygiene-report.json`. 10 tests unitarios sobre la capa pura.
- **SDD Research Lane**: `src/sdd/sdd-research.ts` — artefacto versionado
  `gentle-vanguard.sdd-research/v1` ligado al caso SDD (`.sdd/<feature>/RESEARCH/`): búsqueda +
  grading CRAG/BM25 determinista, veredicto y confianza por pregunta, scaffolds de mapeo
  claim→fuente y contradicciones para la capa agente, fail-closed sin caso existente, observación
  engram best-effort. PROPOSE (sdd-pipeline) cita la evidencia automáticamente. Comando ZCode
  `/sdd-research` + skill sdd-lifecycle Phase 2.5 (sync a zcode/codex/minimax). 7 tests unitarios.
- **RDD retention**: acción `prune` en `src/rdd/rdd-core.ts` (lazy step del autostart) — elimina
  workflows terminales >30d y CIERRA en evento terminal las reviews estancadas >30d (lecciones de
  gentle-ai #1656 y v2.5.0-rc.1). Nunca toca disable-log.jsonl ni el flag DISABLED. 5 tests decoy.
- **Academy**: track `automatizaciones` registrado (8 lecciones recuperadas — el contenido y el i18n
  existían pero no estaba cableado), +2 lecciones en workflows (RDD y la revisión 4R; SDD con TDD,
  BDD y RDD), +5 términos de glosario (4R, BDD, Code review, RDD, TDD). Ahora 9 tracks / 85
  lecciones / 120 términos.

### Fixed

- **process-lock-manager.isProcessAlive**: tasklist devuelve exit 0 aunque el PID no exista — ahora
  parsea el CSV (los locks stale nunca se detectaban).
- **token-ingest daemon**: ahora registra `.runtime/token-ingest.pid` y lo limpia en SIGTERM/SIGINT
  (antes era el único daemon sin tracking, acumulándose por días).

- **src/ por dominios (F2.2) — 8 dominios**: `src/tokens/` (13), `src/retrieval/` (3),
  `src/compression/` (3), `src/web/` (6), `src/research/` (2), `src/design/` (3), `src/humanize/`
  (2), `src/planning/` (3) — ~120 referencias actualizadas (scripts npm, configs de pipeline, hooks,
  docs, tests), grafo regenerado tras cada move.
- **Sprint A comercial 100%** y **Sprint B drafts** (pricing model con benchmarks, 3 borradores
  legales, landing) en GENTLE_VANGUARD_MASTER/11-SPRINT-B-SELL-ENABLE/.
- **Skills sin duplicación (F4.3)**: 60 duplicadas resueltas (43+7 merges, 60 stubs DEPRECATED, cero
  borrados; 31 descripciones recuperadas del bug de YAML multilinea del migrador); `skills/INDEX.md`
  (263 filas) generado por `npm run skills:index`.
- **Tipado**: 165 `any` eliminados en 45 módulos (218→35, **-84%**). Fix ESM preexistente en
  `model-fallback-runtime.ts` (crasheaba al ejecutarse directo).

- **Graphify nativo**: `src/cli/graphify-build.ts` construye el knowledge graph desde cero (AST
  TypeScript, dos pasadas, resolución de imports, comunidades por label propagation) —
  `npm run graphify -- build|update .`. Grafo actual: 4.435 nodos / 8.500 edges. El workflow
  graphify vuelve a estar ACTIVO (antes dependía de un snapshot externo inexistente).
- **Cache de embeddings por skill**: `skill-embedder.ts` ahora escribe `.atl/ml-embeddings/` (419
  archivos) — el directorio que la watchtower vigilaba sin que nadie lo generara.
- **Umbral de cobertura 30→40%** (lines/functions/statements; branches 30) — baseline real medido:
  62% agregado de src/.

### Fixed (Fase 0/1 — plan de evolución `docs/plans/STACK-EVOLUTION-PLAN-2026.md`)

- **Auto-update integrity**: `releases/latest-version.json` apuntaba a v3.5.0 (URL 404, `sha256`
  vacío). Regenerado contra el release real v3.8.2 con hash verificado del binario publicado.
- **Workspace pnpm**: `pnpm-workspace.yaml` ahora declara `packages:` (apps/_, packages/_); el
  dashboard deja de resolver dependencias por ascenso de directorios (`better-sqlite3` movido a
  `dependencies`).
- **Docker**: imagen runner ya no corre como root (usuario `app` dedicado) y el stage runner no
  instala pnpm innecesario.
- **Repositorio**: purgados artefactos trackeados por error (`.pnpm-store/`, `.local/`, log de
  tests, fixtures de debug en raíz, SBOM commiteado).
- **CI**: gates de seguridad que nunca fallaban eliminadas o activadas de verdad (audit, Trivy,
  pseudo-SAST); workflows duplicados consolidados; matriz Node 22/24.
- **Docs**: cifras caducadas corregidas (Nexus 23 tablas/7 migraciones, watchtower 95 checks/21
  componentes); onboarding reparado (`gv check`, setup TS).
- **Watchtower 95/95**: componente security valida `renovate.json` (política single-bot); daemons
  revivibles; ml-embeddings generado de raíz.
- **Tipado**: singletons DB (`error-memory`, `token-tracker`, `event-sourcing`, `adaptive-router`)
  tipados con `DatabaseManager`; rows de Nexus tipadas en `compare-tokens-sessions`; 16 `any`
  eliminados (quedan 193, erradicación incremental F2.4).

## [3.8.2] — 2026-08-22

### Fixed

- CI: la suite de integración corre con `tsx --test` y globs explícitos de archivos de test.
- CI: el servidor WS del dashboard arranca en el contenedor de integración; tests de API se saltan
  limpiamente si es inalcanzable.
- Deps: eliminado el bloque legacy `resolutions` que rompía el `--frozen-lockfile`.

### Style

- Formateo prettier repo-wide y limpieza de markdownlint.

> Nota: las versiones 3.6.x/3.7.0 no registraron entrada en este CHANGELOG. v3.7.0 fue publicada con
> binario (ver releases del repo público).

## [3.8.1] — 2026-08-20

### Changed

- README principal reorganizado para separar onboarding de la documentación técnica.
- Estrategia de publicación documentada: repositorio privado de desarrollo y distribución pública
  curada.

### Removed

- Configuración Dify/Cline no operativa y referencias Dify de los fallbacks de modelos.

### Security

- `gentle-vanguard` pasa a privado; `gentle-vanguard-public` permanece como superficie pública.

## [3.8.0] — 2026-08-18

### Content Operations Engine (Native TS, Offline-First)

- **Content Operations Engine**: `src/content-operations/` — manifest como fuente de verdad, state
  machine (`DRAFT → VALIDATED → PACKAGED → REVIEW → APPROVED → PUBLISHED → MEASURED`,
  `FAILED → DRAFT`), validación contra registry de plataformas, empaquetado idempotente
- **CLI**: 8 comandos (`list`, `validate`, `prepare`, `status`, `report`, `transition`, `export`,
  `help`) + npm scripts `content:*`
- **Manifest real**: `content/operations/master-manifest.json` — 21 jobs del sprint de lanzamiento
  `GROWTH-EXPERIMENT-001` (18/08 → 01/09/2026, 6 plataformas)
- **Assets**: 21 PNGs dimensionados por plataforma en `docs/presentations/social-assets/`
- **Registry**: `config/content-operations/platforms.json` — 11 plataformas con capacidades
- **Docs**: `docs/operations/` (engine, directive, integration status) + **ADR-0018**
- **Tests**: 15 unit tests (state machine, registry validation, idempotencia, manifest real)
- **README + QUICK-COMMANDS**: sección Content Operations con comandos `content:*`

### Distribution & Homologation

- **main homologado con develop** en `b66073a2` (fast-forward, 0 divergencia)
- **README/README-PUBLIC**: métricas reales v3.7.0 → v3.8.0
- **Auto-update**: fix `ref: main` en workflow (detached HEAD en trigger release)

## [3.5.0] — 2026-08-02

### Native RDD System

- **Risk-Driven Development**: Full native RDD pipeline (`src/rdd/`) — risk-classifier, RDD gates,
  4R review, RDD core, kill switch
- **RDD Normativa**: `rules/RDD-NORMATIVA.md` + `rules/REVIEW-AUTHORITY-THREAT-MODEL.md`
- **Tests**: RDD test suite passing

### Model Provider Healing

- **Auto-Healing**: `src/ml/model-provider-healer.ts` — detects unhealthy models
  (UnsupportedToolCalling, ModelNotFound, AuthFailure, RateLimit, ConnectionError, BadRequest) and
  auto-switches to fallback
- **Health State**: `config/model-health.json` + `.runtime/model-health.json` with cooldown
- **Correction Rule**: `ModelProviderUnsupported` in `config/correction-rules.json` (13 rules total)
- **Watchtower Check**: `model-provider-health` component monitors provider health
- **Pipeline Step**: `model-provider-heal` (lazy, phase 90)

### Web Permissions

- **Orchestrator**: `websearch`/`webfetch` set to `ask` (LOCAL-FIRST policy allows external search
  when user requests it)
- **LOCAL-FIRST-POLICY.md**: Updated with the `ask` mechanism
- **Skill Nudge Fix**: Corrected `skill-nudge` path in pipeline config

### Documentation & Migrations

- **Migration Complete**: All PS1 scripts migrated to TypeScript — removed legacy references
- **Docs Updated**: `DASHBOARD.md`, `CROSS-PLATFORM-SETUP.md`, `CLEANUP-GUIDE.md` — replaced broken
  PS1 commands with real TS equivalents (`npm run db:prune`, `stack:setup`, `gv`, `health:check`)
- **Version Alignment**: VERSION file fixed (was stale 8.0.1, now 3.5.0)

### Metrics

- Health Score: 84 PASS / 1 WARN (expected: kimi-2-5 unhealthy, auto-healed) / 0 FAIL
- Pipeline: 101 steps, 99 enabled, 0 missing scripts
- Dashboard build: OK

---

## [3.4.0] — 2026-07-27

### Stack Optimization & Simplification

- **100% Health Check**: Achieved 82/82 PASS (0 WARN, 0 FAIL) — all components operational
- **Configuration Simplification**: Removed model configs from `opencode.json` — OpenCode handles
  model selection
- **Cloud Dependencies Removed**: Deleted AWS/Azure connectors, hybrid executor — local-only
  operation
- **File Naming Standardization**: Removed versioned filenames (v1, v2, etc.)
  - `metrics-collector-v2.ts` → `metrics-collector.ts`
  - `v264-scripts.test.ts` → `scripts.test.ts`
  - `v284-scripts.test.ts` → `scripts-integration.test.ts`
- **Knowledge Base Sync**: New `src/knowledge-base-sync.ts` — auto-sync Engram to Obsidian vault
- **Auto-Reindex**: Engram auto-reindex every session (lazy step in pipeline)
- **Documentation**: Added naming standards to `docs/architecture/architecture-standards.md`
- **Optimization Summary**: Created `docs/OPTIMIZATION-SUMMARY-2026-07-27.md`

### Standards Established

- No version numbers in filenames (use Git for versioning)
- Local-first architecture (no cloud dependencies required)
- Auto-sync Knowledge Base at session start
- Documented conventions for file naming

### Metrics

- Files changed: 44
- Lines added: +3,999
- Lines removed: -1,798
- Health Score: 100% (82/82)

---

## [3.3.3] — 2026-07-26

### Wave 37.5 — Nexus Identity & Optimization

- **Nexus DB Identity**: Named the operational database "Nexus" — identity manifest, normativa
  (`rules/NEXUS-NORMATIVA.md`), skill (`skills/nexus-database/SKILL.md`), registered in `AGENTS.md`,
  `skill-router.ts`, `SKILL_INDEX.md`, `RECOVERY-NORMATIVA.md`
- **Watchtower Fix**: False positive integrity check — three-state classifier (PASS/WARN/FAIL),
  transient lock detection, auto-checkpoint WAL when WAL > 5MB or WAL > 1.5x DB size
- **Engram Critical**: Marked Engram as CRITICAL (SI) in recovery normativa — persistent memory is
  the stack's historical north
- **WAL Optimization**: Auto-checkpoint reduced WAL from 3.93 MB to 0.61 MB
- **3 ADRs**: ADR-007 (Nexus), ADR-008 (Session Scoring), ADR-009 (Watchtower)
- **CLI Migration**: `src/cli/gv.ts` — TS replacement for `bin/gv.ps1` CLI with commands: check,
  validate, info, list, health, prune, backup, optimize
- **CLI Registration**: `npm run gv` and `npm run cli:gv` in package.json

### Wave 37 — Session Scoring & Stack Tables

- **Phase B**: 4 React panels for stack tables (response_cache, contract_results, skill_usage,
  token_usage) + hook `useStackTables` + i18n entries
- **Phase C**: 5 SQLite metrics + 3 alert rules in dashboard
- **Phase D**: `pruneAll()` in DatabaseManager + `db-prune.ts` + lazy pipeline step
- **Phase E**: Migration 003 `session_scoring` table — CRUD + dual-write in session-scoring.ts
- **Migration 003**: `session_scoring` (12th table) — quality scoring per session

### Wave 34-36 — SQLite Foundation

- **Wave 34**: Stack-wide SQLite database lifecycle — `DatabaseManager` singleton, WAL mode, FK ON
- **Wave 35**: SQLite-backed response cache (SHA256 + TTL + hit_count)
- **Wave 36**: SQLite dual-write for token-tracker, skill-usage-tracker, result-gatekeeper,
  adaptive-router, event-sourcing
- **Migration 001**: Core operational (metric_snapshots, sessions, traces, events, alerts, feedback)
- **Migration 002**: Stack tables (response_cache, contract_results, skill_usage, token_usage,
  routing_rules)
- **Dashboard data API**: SQLite-backed endpoints for all 11 tables

### Stack Infrastructure

- **214 TS files** in `src/` — full PS1→TS migration of all core scripts
- **112 skills** — comprehensive library
- **49 rules** — governance and normativas
- **88 pipeline steps**, 52 lazy (59%)
- **98 watchtower checks** across 11 components
- **21 CI/CD workflows** — lint, typecheck, security, docker, release
- **67 test files** — config, workflows, security, research

---

## [3.3.0] — 2026-07-20

### Dashboard Evolution

- Wave 29: LiveChart always renders mcpSkills+commits, 32-skill registry
- Wave 30: vitest unit tests for LiveChart, jsdom testing infra
- Wave 31: MetricsCard, InfoPopup, AlertPanel tests + engram session close
- Dashboard build: 3.13s, 22KB gzip main bundle

### Infrastructure

- Wave 28: src/ restructured into subdirectories (Core/ infrastructure/ skills/ database/ etc.)
- Wave 27: SessionActivityHeatmap, LiveTraceFeed with filters, ActivityTimeline 24h chart
- SkillHeatmap component — visual skill activity grid with intensity colors

---

## [3.2.0] — 2026-07-15

### Migration to TypeScript

- PS1→TS migration complete for all core scripts in `scripts/`
- `maintenance-watchtower.ts` (834 lines) replaced watchtower PS1
- `health-check.ts` (332 lines), `session-autostart.ts` (168 lines)
- All 21 research Python scripts consolidated into single search_datasets.py
- 108 PS1 scripts deleted after TS migration verified

### CI/CD

- 6 jobs: lint-typecheck, test, dashboard-build, docker-build, python-lint, go-test
- 3 security jobs: gitleaks, secretlint, trivy
- Config consolidation: model-router.json replaces model-routing.json

---

## [3.1.0] — 2026-07-10

### Autonomous Stack

- Session autostart pipeline with 88 steps (52 lazy)
- Maintenance watchtower with 98 checks across 11 components
- Auto-healing: process restart, DB health check, WAL checkpoint
- Auto-learn: auto-norm-learner, self-reflection-loop
- Auto-evolve: skill-evolution-engine, auto-update, auto-optimizer
- Convergence monitor + findings ledger + compact state
- 6 ADRs created (ADR-001 through ADR-006)

### Security

- Security orchestrator with dependency scanning
- Secretlint + trufflehog pre-commit hooks
- Governance pipeline with audit events
- Distributed tracing with OTLP export

---

## [3.0.0] — 2026-07-01

### Initial Foundation

- Project scaffolding with TypeScript strict mode
- PowerShell CLI (`bin/gv.ps1`, `bin/gf.ps1`)
- 112 skills across 20+ domains
- OpenCode + Claude + Copilot compatibility
- Local-first, tool-agnostic architecture

---

Earlier versions (v2.x) are not tracked in this changelog. See git tags for historical releases.
