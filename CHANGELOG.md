# Changelog

## [3.3.3] - 2026-06-19

### Fixed

- **Maintenance Watchtower**: Eliminado falso WARN por watchdog PID faltante cuando WS corre
  standalone. El check ahora reporta PASS "WS running standalone" si el servidor responde, aunque
  no haya watchdog. Autoheal optimizado: no reinicia el WS si ya está vivo (evita conflictos de
  puerto y procesos duplicados). Resultado: 74/74 PASS, 0 WARN, 0 FAIL.

### Changed

- **Dashboard real-data.ts**: Expansión de métricas y endpoints para monitoreo en tiempo real.
- **websocket-server.ts**: Mejoras de resiliencia en la conexión WebSocket.
- **Dashboard.tsx**: Nuevos paneles de monitoreo con indicadores de salud.
- **types/dashboard.ts**: Tipos extendidos para alertas y trazabilidad.
- **session-autostart.config.json**: Steps v4.0 integrados (tracing, checkpoint, audit,
  event-sourcing, cloud-connectors) todos con lazy: true.
- **docker-compose.yml**: Servicios adicionais para el stack de monitoreo.
- **session-scoring.ps1**: Algoritmo de scoring mejorado con pesos ajustables.

### Added

- **RBAC + CSP configs**: `config/rbac-policy.json` y `config/security-csp.json` para gobernanza.
- **Audit pipeline**: `scripts/security/audit-pipeline.ps1` con log JSONL diario.
- **State persistence**: Checkpoint/snapshot/rollback en `.session/`.
- **Tracing system**: OpenTelemetry spans en `.telemetry/` con export Prometheus.
- **Cloud connectors**: Hybrid executor + AWS/Azure delegators con circuit breaker.
- **Correction rules engine**: `scripts/adaptive/correction-rules-engine.ps1` para auto-corrección.
- **Engram auto-sync**: `scripts/utilities/memory/ENGRAM/engram-auto-sync.ps1`.
- **k8s/OpenTelemetry configs**: Despliegue Kubernetes y configs de tracing.
- **Integration tests**: Tests para cloud-connectors y phase-13-2-3.

## [3.3.2] - 2026-06-18

### Added

- **Dashboard i18n**: 3 idiomas (en/es/pt-BR) con `useLocale.ts` — 14 métricas localizadas.
- **Alert System**: 8 reglas configurables en `config/dashboard-alerts.json`, hook `useAlerts.ts`.
- **Maintenance Watchtower**: 60 checks en 11 componentes, 6 modos (health/rebuild/report/autoheal/continuous/all).
- **Info Popups**: Componente `InfoPopup.tsx` con animación fade-in + scale para descripción de métricas.
- **Dashboard lifecycle scripts**: `dashboard-common.ps1` (puertos dinámicos), `dashboard-start.ps1`,
  `dashboard-stop.ps1`, `dashboard-ws-autostart.ps1` (watchdog con auto-recovery).
- **Security & Tool Configs**: `SECURITY.md`, `.clinerules`, `.cursorrules`, `NORMATIVA-PNPM-SECURITY.md`,
  `NORMATIVAS-PERFORMANCE.md`.
- **norms-registry.json**: Schema versionado con hitCount, successRate.
- **Trace system**: `trace-logger.ps1` para depuración del pipeline pre-process-input.

### Changed

- **Dashboard server refactor**: WebSocket + REST API resiliente con HTTP polling fallback en `useMetrics.ts`.
- **Watchtower consolidation**: Unifica health-check.ps1, stack-health-check.ps1 y watchdog en un solo orquestador.
- **Dashboard components**: TracingDashboard con waterfall view mejorado, SessionTable refactorizado,
  MetricsCard con colores semánticos, ValidationPanel con info popups.

### Fixed

- **Pre-process pipeline**: Debug logging, health check integration, tool detection mejorado.
- **Dashboard health**: Integración end-to-end con el ecosistema de monitoreo.

## [3.3.1] - 2026-06-17

### Changed

- **CI/CD Consolidation**: 35 workflows reduced to 12 (6 reusable + 6 triggers + 4 retained).
  Reusable workflow_call pattern for lint, test, security, docker, release, governance.
- **Structured Logging**: New `Logger.psm1` module writes JSONL to `.session/logs/`. Integrated into
  all 5 adaptive scripts (correction-capture, session-scoring, pattern-detector, auto-norm-learner,
  auto-norm-enforcer).
- **Dual-Write Norms**: `auto-norm-learner.ps1` now writes both `LEARNED-NORMS.md` (backward
  compatible) and `norms-registry.json` (144 normas with versioned schema, hitCount, successRate).
- **Adapter Consolidation**: 3 JS adapters (antigravity, codex, windsurf) merged into one TypeScript
  `adapters/index.ts` (570→80 lines).
- **Docker Compose**: Root `docker-compose.yml` with 5 services (web-dashboard, mcp-server,
  websocket-server, health-api, pwsh-toolbox) — all with healthchecks.
- **Health Endpoint**: Expanded `/api/health` to report websocket, MCP, and adaptive component
  status (normsLoaded, sessionScore).

### Removed

- **skills-archive/**: Deleted ~1000 files of dead code (skills migrated to root `skills/` long
  ago).
- **29 legacy workflows**: Replaced by 6 reusable + 3 trigger workflows.
- **Root Python scripts**: 22 RLHF-related scripts moved to `research/rlhf-dataset-search/`.

### Fixed

- **package.json**: Version corrected from `"1.0.1"` to `"3.3.0"` (was out of sync).

## [3.3.0] - 2026-06-05

### Added

- **Community Skills**: Issue template for contributions, CI validation workflow, real marketplace
  API scanning `skills/` directory, `submit-community-skill.ps1` packaging script
- **Global Health Dashboard**: `GlobalHealth.tsx` component with cross-repo status,
  `global-health-api.ts` endpoint, integrated into Dashboard and WebSocket metrics
- **CI/CD Expansion**: Root `Dockerfile` (multi-stage MCP server), dashboard `Dockerfile`
  (Vite→nginx), `nginx.conf`, `docker-validate.yml`, `integration-tests.yml`, 14 API integration
  tests, 6-service `docker-compose.test.yml`
- **Auto-Update**: `check-version.ps1` (GitHub API semver comparison), `auto-update.ps1`
  (download/backup/restore), `gentle-vanguard.ps1` updated with `-Update`/`-CheckVersion` flags and
  dynamic version from `VERSION` file, `auto-update.yml` release workflow
- **CopilotKit Patterns (Fase 1-4)**: Native adoption of 5 CopilotKit patterns over MCP
- **AG-UI Protocol**: 7 ui_hints renderers (metric, datatable, chart, diff, form, list, alert) in
  AgentMessage component
- **Agent Chat Interface**: Conversational UI with @mentions autocomplete and suggested actions
- **Human-in-the-Loop**: 4-mode modal (confirmation, selection, form, review) with auto-detection
- **Shared State Bridge**: Event bus filesystem watcher with 3 WebSocket channels (state_history,
  state_event, state_tasks)
- **Task Control** (`/tasks`): Real-time task monitoring with status icons and quick dispatch
- **Session Timeline** (`/timeline`): Visual event timeline with expandable JSON payloads
- **Session Persistence**: File-based session history in `.event-bus/sessions-history.json`
- **useSharedState hook**: React hook for event bus state consumption
- **Route expansion**: `/tasks` and `/timeline` routes with dedicated wrapper pages

### Enhanced

- **AgentChat**: Empty state now shows suggested action chips + agent selector
- **AgentChat Sidebar**: Added History panel showing persistent sessions with timestamps
- **AgentChat Input**: Inline @mentions autocomplete with filtered dropdown
- **WebSocket Server**: Added `list_history` action, `agent_history` message type
- **WebSocket Server**: Session persistence with save/load from disk

### Technical

- `server/shared-state-bridge.ts` — New singleton for event bus filesystem polling
- `src/hooks/useSharedState.ts` — New React hook for shared state consumption
- `src/components/TaskControl.tsx` — New component for task monitoring UI
- `src/components/SessionTimeline.tsx` — New component for event timeline UI
- `server/websocket-server.ts` — Extended with history persistence, emit_event action
- `src/hooks/useAgentStream.ts` — Extended with historySessions state, listHistory method
- `src/components/AgentChat.tsx` — Rewritten with @mentions, suggested actions, history panel
- Build: `tsc --noEmit` 0 errors, `vite build` 3.01s
- No CopilotKit dependency added — all patterns implemented natively over MCP

## [3.1.0] - 2026-06-03

### Added

- **Dashboard v4**: OpenTelemetry tracing visualization with E2E traceability
- **Skill Marketplace**: Publishing, rating, and review system for skills
- **Interactive Documentation**: Guided tutorials with progress tracking
- **Performance Optimizations**: Code splitting with lazy loading and manual chunks
- **React Router**: Navigation between Dashboard, Tracing, Marketplace, and Docs

### Enhanced

- **Web Dashboard**: Modular architecture with separate chunks for vendor, charts, icons
- **Build Process**: Optimized bundle sizes with dynamic imports
- **User Experience**: Navigation bar with seamless view switching

### Technical

- Added `TracingDashboard.tsx` for OpenTelemetry trace visualization
- Added `Marketplace.tsx` with skill listings, search, and reviews
- Added `InteractiveDocs.tsx` with tutorial system
- Implemented code splitting in `vite.config.ts`
- Integrated React Router with lazy loading and Suspense

## [3.0.0] - 2026-06-03

### Added

- **Fase 3 Implementation**: MCP Native, Web UI, Multi-repo orchestration
- **MCP Server v2.0.0**: 5 tools + 3 prompts with native SDK
- **Web Dashboard v1.0.0**: React SPA with WebSocket real-time metrics
- **Multi-repo Engine v2.0.0**: 7 actions with Pester tests
- **Test Suite**: 16 tests (Pester + Vitest)
- **Skill Registry Sync**: 385 skills synchronized
- **CI/CD**: GitHub Action for skill registry validation

### Enhanced

- **Observability**: OpenTelemetry tracer with span management
- **Benchmarking**: Automated skill benchmark suite
- **Auto-update**: Launcher with rollback capability
- **Docker**: Containerized test environment
- **S3 Distribution**: CloudFront integration

## [2.30.0] - Previous

See previous changelog entries...
