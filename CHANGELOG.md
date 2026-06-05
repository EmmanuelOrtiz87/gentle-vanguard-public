# Changelog

## [3.2.0] - 2026-06-04

### Added

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
