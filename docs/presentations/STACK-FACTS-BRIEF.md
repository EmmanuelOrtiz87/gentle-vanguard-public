# Stack Facts Brief — Gentle-Vanguard v4.0.0 (verificado 2026-09-02)

Datos REALES verificados contra el código. Usar para actualizar docs/presentations/*.html.

## Métricas core

- Versión: **v4.0.0**
- Archivos TS en src/: **604**
- Archivos de test: **175**
- Scripts en scripts/: **45**
- Agentes: **21** (Orchestrator, BA sdd-explore, SAD sdd-design, DEV sdd-apply, QA sdd-verify, GOV,
  OPS, DOC, Session, Premortem, Maintenance, Self-Diag, SIA, GitFlow, Knowledge, Mkt, Sales,
  Finance, HR, Legal, Bus-Tele)
- Skills: **92** en .opencode/skills + 200 en skills/ + 10 en .agents/skills
- Normativas: **60+**
- Watchtower: **96 checks / 22 componentes** (modularizado en src/core/watchtower/checks-*.ts)
- Pipeline de sesión: **117 pasos totales / 112 enabled / 83 lazy**
  (config/session-autostart.config.json)
- Nexus DB: **16 repositorios** (Metrics, Session, Trace, Event, Cache, Skill, Contract,
  ErrorMemory, Housekeeping, Backlog, AuthSession, Token, Principal, ContentOS, MigrationRunner +
  manager)
- Migraciones DB: **hasta 016_token_savings**
- Tablas Nexus: **23**

## Apps (8, desacopladas del repo del stack — local-first, git propio)

1. academy-web (@gentle-vanguard/academy-web)
2. archify (@gentle-vanguard/archify)
3. command-center (@gentle-vanguard/command-center) — puerto 8090, solo visual para prender/apagar
   apps
4. content-cms (@gentle-vanguard/content-cms)
5. design-hub (@gentle-vanguard/design-hub)
6. gv-analytics (@gentle-vanguard/gv-analytics)
7. prompt-studio (@gentle-vanguard/prompt-studio)
8. web-dashboard (@gentle-vanguard/web-dashboard)

(gv-design-studio y gv-design-system-catalog: eliminadas 2026-09-02, reemplazadas por design-hub)

## Packages (2)

- @gentle-vanguard/design-system (packages/gv-design-system) — tokens v2.0.0-alpha.1, 7 componentes
  React, MCP server, 3 CLIs
- @gentle-vanguard/shared (packages/shared)

## Diseño oficial v2.0 (v2 Premium — BRAND-DECISION-2026-09-01, fuente canónica)

- **Fuente canónica: v2 Premium** definida en `docs/brand/BRAND-DECISION-2026-09-01.md` +
  `docs/brand/TOKENS-v2.json`. Design-system alpha (ADR-0026, #121212/Orbitron) = DEPRECADO como
  histórico. v3 Kinetic = ARCHIVADA, NO es marca.
- Purple: #a78bfa (deep #7c3aed, soft #c4b5fd)
- Cyan: #22d3ee (deep #0891b2, soft #67e8f9)
- **BG: #0F1115** (deep #090C11), surface #1a1f2a, raised #252b38, glass rgba(26,31,42,0.72)
- Texto: #e8eef4 (muted #c4cdd8, faint #8b95a8)
- Feedback: success #4ade80, warning #f4bb4f, error #ee6d75, info #22d3ee
- Gradiente oficial: linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%)
- **Tipografía: Space Grotesk (display) / Inter (body) / JetBrains Mono (mono)**
- Logo: **monograma v1 con gradiente v2** (assets/logo.svg v2.1 — flecha en la V + glow). Wordmark
  "GentleVanguard" en Space Grotesk

## Comandos clave (package.json)

- session:autostart:detached, session:validate, session:close:fast
- watchtower:health (96/96 PASS), watchtower
- db:init, db:health, db:backup, db:restore, db:prune
- token:ingest, token:trace, token:status
- graphify (build/query/explain/update)
- cc:start (command center), cc:server
- process:hygiene, process:reap
- scan:secrets
- delegate:run, sdd:research
- profile:list, profile:apply
- web:search, web:select, web:crawl
- design:tokens, design:check
- humanize:analyze, humanize:transform
- animation:create

## Integraciones multi-tool

- ZCode, Codex, MiniMax Code (21 agentes sincronizados, 19 skills críticas)
- MCP: codegraph, engram, chrome-devtools, filesystem, memory
- Token tracking multi-tool: opencode (SQLite), zcode, codex, minimax

## Modelo operativo

- LOCAL-FIRST / SERVER-OPTIONAL (ADR-0017)
- Procesos ocultos en Windows (runNpxTsx, windowsHide, sin cmd.exe visible)
- Reaper nativo de procesos (process-hygiene)
- Watchtower auto-heal, 96 checks
