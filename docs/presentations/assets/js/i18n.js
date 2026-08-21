/**
 * i18n.js — Multilingual support for Gentle-Vanguard presentations
 *
 * Translates data-i18n elements on the fly. Supports en/es/pt-BR.
 * Language preference is persisted in localStorage.
 *
 * Usage:
 *   <span data-i18n="nav_home">Home</span>
 *
 * Dependencies: Bootstrap 5.3+ (for dropdown)
 */
(function () {
  'use strict';

  const DICT = {
    en: {
      nav_home: 'Home',
      nav_arch: 'Arch',
      nav_autonomy: 'Autonomy',
      nav_dashboard: 'Dashboard',
      nav_quickstart: 'Quickstart',
      nav_memory: 'Memory',
      nav_security: 'Security',
      nav_agents: 'Agents',
      nav_cloud: 'Cloud',
      nav_patterns: 'Patterns',
      nav_health: 'Health',
      nav_diagrams: 'Diagrams',
      /* Títulos de sección — index */
      sec_architecture: 'System Architecture',
      sec_components: 'Stack Components',
      sec_autonomous: 'Autonomous Systems',
      sec_data_layer: 'Data Layer — 11 Repos',
      sec_executive: 'Executive Systems',
      sec_feature_matrix: 'Feature Matrix',
      sec_skills_rules: 'Skills & Rules Explorer',
      sec_stack_metrics: 'Stack Metrics',
      sec_the_book: 'El Libro — The Book',
      sec_diagrams: 'Diagrams & Visualizations',
      sec_tools: 'Tools Ecosystem',
      /* Títulos de sección — architecture */
      sec_arch_layers: 'System Architecture',
      sec_daos: 'Data Access Objects',
      sec_pipeline: 'Session Pipeline',
      sec_performance: 'Performance Optimizations',
      /* Títulos de sección — agents-pipeline */
      sec_agent_eco: 'Agent Ecosystem',
      sec_routing: 'Routing Rules',
      sec_lifecycle: 'Session Lifecycle',
      sec_delegation: 'Delegation Model',
      sec_skills_system: 'Skills System',
      /* Títulos de sección — quickstart */
      sec_prereq: 'Prerequisites',
      sec_setup: 'One-Command Setup',
      sec_daily: 'Daily Commands',
      sec_dash_cmds: 'Dashboard Commands',
      sec_db_cmds: 'Database Commands',
      sec_workflow: 'Development Workflow',
      sec_arch_overview: 'Architecture Overview',
      sec_troubleshoot: 'Troubleshooting',
      sec_references: 'Reference Links',
      /* Títulos de sección — memory-knowledge */
      sec_mem_stack: 'The Memory Stack',
      sec_engram: 'Engram — Persistent Memory',
      sec_codegraph: 'CodeGraph — Symbol Intelligence',
      sec_graphify: 'Graphify — Knowledge Graph',
      sec_nexus: 'Nexus DB — Operational Database',
      sec_mem_daos: 'Data Access Objects',
      sec_ml_emb: 'ML Embeddings',
      sec_kb_manager: 'Knowledge Base Manager',
      sec_data_flow: 'Data Flow Diagram',
      /* Títulos de sección — security-governance */
      sec_sec_orch: 'Security Orchestrator',
      sec_audit: 'Audit Pipeline',
      sec_normatives: 'Normatives System',
      sec_guardrails: 'Guardrails & Policies',
      sec_governance: 'Governance Framework',
      sec_compliance: 'Compliance Checks',
      sec_hardening: 'Security Hardening',
      sec_standards: 'Standards Summary',
      /* Hero */
      hero_subtitle: 'Autonomous AI Orchestration Platform — 100% Autonomous',
      /* Títulos — health */
      sec_health_dash: 'Health Dashboard',
      sec_perf_slos: 'Performance SLOs',
      /* Títulos — operations-cloud */
      sec_ci_cd: 'CI/CD Pipeline',
      sec_security_wf: 'Security Workflow',
      sec_cloud_conn: 'Cloud Connectors',
      sec_cb_states: 'Circuit Breaker States',
      sec_tracing: 'Distributed Tracing',
      sec_state_persist: 'State Persistence',
      sec_event_saga: 'Event Sourcing + Saga',
      sec_health_api: 'Health API',
      sec_testing_infra: 'Testing Infrastructure',
      sec_ops_cmds: 'Operations Commands',
      sec_pipe_integ: 'Pipeline Integration',
      /* Info tips (modal de la "i") */
      info_kicker: 'More information',
      info_title: 'About this feature',
      info_hint: 'Press ESC or click outside to close',
      lbox_hint_wheel: 'Scroll to zoom',
      lbox_hint_drag: 'Drag to pan',
      lbox_hint_dbl: 'Double-click to toggle',
      tip_pipeline:
        'Session autostart: 31 parallel Phase-1 steps + 70 lazy background steps launched in batches of 5. Includes tool detection, token budget, Karpathy guidelines, codegraph sync, security orchestration and DB init.',
      tip_engram:
        'Persistent memory with automatic sync, SHA256 integrity checks and compaction. Currently holding 2,078 observations across 369 sessions. Survives across sessions and compactions.',
      tip_codegraph:
        'SQLite knowledge graph for symbol intelligence. 10,663 nodes and 21,746 edges across 677 files with sub-millisecond symbol queries.',
      tip_dashboard:
        'React + TypeScript + Vite observability SPA. WebSocket real-time updates every 5s with HTTP polling fallback, 7 dashboard sections, i18n in 3 languages and 8 alert rules.',
      tip_circuit:
        '3-state circuit breaker (CLOSED / OPEN / HALF_OPEN). 5 failures open the circuit, 2 successes recover it. Prevents cascading failures across the stack.',
      tip_autoapply:
        'Executive engine that follows trigger → evaluate (≥80% confidence) → apply → verify → rollback. Maximum 5 auto-applies per day with rollback if degradation exceeds 15%.',
      tip_depgraph:
        'Dynamically discovers component relationships from the pipeline config, replacing the hardcoded dependency map. Self-maintaining architecture.',
      tip_escalation:
        '3-tier escalation: warning (3 failures) → critical (5) → emergency (10). Every escalation is recorded with full audit trail in the findings ledger.',
      tip_abtest:
        'Statistical A/B testing framework: createExperiment, assignVariant, evaluateExperiment with automatic rollback on statistical degradation.',
      tip_scoring:
        'Per-session quality scoring tracking delegations, corrections and proactive hits. Automatic comparison, regression detection above 15% and anomaly alerts.',
      tip_watchtower:
        'Central health orchestrator: 95 checks across 21 components with Promise.allSettled parallel execution and auto-heal modes (health, rebuild, autoheal, report, continuous).',
      tip_nexus:
        'Operational SQLite database (WAL mode, FK ON) with 11 repositories, 7 migrations and 21 tables. Auto-init, auto-prune, auto-backup and watchtower monitoring.',
      tip_layers:
        'The stack is organized in 6 layers: Tools (10 IDEs) → Agents (21 specialized) → Pipeline (101 enabled steps) → Memory & Knowledge → Data (11 repos) → Executive systems.',
      section_overview: 'Overview',
      section_architecture: 'Architecture',
      section_metrics: 'Metrics',
      section_quickstart: 'Quick Start',
      section_security: 'Security & Governance',
      section_operations: 'Operations',
      section_patterns: 'Patterns & Conventions',
      section_memory: 'Memory & Knowledge',
      section_agents: 'Agents & Pipeline',
      section_autonomy: 'Autonomy Levels',
      section_dashboard: 'Dashboard',
      theme_dark: 'Dark',
      theme_light: 'Light',
      lang_en: 'English',
      lang_es: 'Español',
      lang_pt: 'Português',
      footer_all_rights: 'All rights reserved.',
      footer_built_with: 'Built with',
      see_docs: 'See Documentation',
      view_on_github: 'View on GitHub',
      coming_soon: 'Coming soon',
      loading: 'Loading...',
      error: 'Error',
      search: 'Search...',
      no_results: 'No results found.',
      back_to_top: 'Back to top',
      copy: 'Copy',
      copied: 'Copied!',
      close: 'Close',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      create: 'Create',
      update: 'Update',
      refresh: 'Refresh',
      download: 'Download',
      upload: 'Upload',
      filter: 'Filter',
      sort: 'Sort',
      status_ok: 'Operational',
      status_warn: 'Warning',
      status_error: 'Error',
      status_unknown: 'Unknown',

      tip_hs_dash_backend:
        'Backend Server: real-data.ts computes metrics from state files; WebSocket Server pushes every 5s on port 8080.',
      tip_hs_dash_fallback:
        'HTTP Polling Fallback: useMetrics.ts always polls HTTP, so data loads even if the WebSocket server is down.',
      tip_hs_dash_frontend:
        'Frontend - React/Vite: 7 sections (Metrics, Traces, Alerts, Feedback, Scoring, Waterfall, Info Popup) with i18n.',
      tip_hs_dash_sources:
        'Data Sources: real trace data read from .session/context-log/*.state.json and *.meta.json - no mock data.',
      tip_hs_dash_watchdog:
        'Watchdog Auto-Recovery: monitors :8080 every 5s, restarts up to 10 times, and kills the watchdog first to avoid loops.',
      tip_hs_data_nexus:
        'NEXUS DB: operational SQLite database (gentle-vanguard.db) with WAL mode, FK ON, 12 tables and 3 migrations.',
      tip_hs_data_repos_blue:
        'Data DAOs (blue): MetricsRepo (metric_snapshots), SessionRepo (sessions) and TraceRepo (traces) - time-series and session history.',
      tip_hs_data_repos_green:
        'Quality DAOs (green): CacheRepo (response_cache) and EventRepo (events) - caching and event sourcing audit trail.',
      tip_hs_data_repos_orange:
        'Ops DAOs (orange): HousekeepingRepo (token_usage) and MigrationRunner (7 migrations) - maintenance and schema evolution.',
      tip_hs_data_repos_purple:
        'Memory DAOs (purple): SkillRepo (skill_usage), ContractRepo (contract_results) and ErrMemoryRepo (scoring) - usage and scoring.',
      tip_hs_flow_karpathy:
        'Karpathy Guidelines: 3 rules (Think First, Simplicity, Surgical Changes) with quality rubrics and self-critique.',
      tip_hs_flow_lazy_batch:
        'Lazy Batch - 5 background workers: runs deferred steps like Tracing Init, Cloud Connectors, Event Sourcing, Audit Pipeline and Dashboard WS.',
      tip_hs_flow_phase1:
        'Phase 1 - 31 parallel steps: fast, independent initializers that run concurrently and never block on failure.',
      tip_hs_flow_phase2:
        'Phase 2 - 70 lazy background steps: deferred heavy work executed in batches of 5 workers after session start.',
      tip_hs_flow_process_bar:
        'Process bar: parallel steps (31) then lazy background (70) then DONE - the full 101-step session pipeline.',
      tip_hs_flow_session_manager:
        'Session Manager: generates the session ID, syncs Engram and tracks the session lifecycle.',
      tip_hs_flow_token_budget:
        'Token Budget: allocates the 5M daily / 3M per-session budget and enforces guard thresholds.',
      tip_hs_flow_tool_detection:
        'Tool Detection: maps the 8 available tools (Bash, Read, Write, Edit, Grep, Glob, Task, Skill).',
      tip_hs_loop_auto_escalation:
        'Guard rail - Auto-Escalation: promotes unresolved issues to a higher authority (orchestrator or human).',
      tip_hs_loop_autoapply:
        'Auto-Apply SAFE: the central verification gate - changes are only applied when they pass all safety checks.',
      tip_hs_loop_circuit_breaker:
        'Guard rail - Circuit Breaker: opens after repeated failures to stop cascading errors and halts the loop.',
      tip_hs_loop_decision:
        'Phase 3 - Decision: chooses the winning action with confidence thresholds; escalates when uncertainty is high.',
      tip_hs_loop_detection:
        'Phase 1 - Detection: identifies anomalies, new signals or degradation events in the environment, tool outputs and session traces.',
      tip_hs_loop_evaluation:
        'Phase 2 - Evaluation: scores each candidate action against quality rubrics, cost and risk before deciding.',
      tip_hs_loop_execution:
        'Phase 4 - Execution: applies the selected action through the safe auto-apply gate, tracking every mutation.',
      tip_hs_loop_learning:
        'Phase 6 - Learning: records outcomes in Engram and the routing table, improving future decisions.',
      tip_hs_loop_norms_learner:
        'Guard rail - Norms Learner: learns project conventions and injects them as adaptive norms into new sessions.',
      tip_hs_loop_session_scoring:
        'Guard rail - Session Scoring: grades each session (delegations, corrections, proactive hits) and feeds the routing table.',
      tip_hs_loop_verification:
        'Phase 5 - Verification: runs typecheck, lint and tests; if verification fails, the action is rolled back.',
      tip_hs_agents:
        'Agents - 21 specialized subagents: Orchestrator, SDD (explore/design/apply/verify), Doc, Ops, Gov, Session, Premortem, Maintenance, Self-Diag, SIA, GitFlow, Knowledge + business (Mkt, Sales, Finance, HR, Legal, Bus-Tele).',
      tip_hs_data:
        'Data Layer - Nexus SQLite DB with 11 repositories (10 DAOs + MigrationRunner), 7 migrations and 21 tables. WAL mode and FK ON enabled.',
      tip_hs_executive:
        'Executive Systems - 12 autonomous subsystems: Auto-Apply Safe, Circuit Breaker, Auto-Escalation, Dynamic Dependency Graph, AB Testing, Session Scoring, Norms Learner, Watchtower, Security Orchestrator, State Persistence, Distributed Tracing, Cloud Connectors',
      tip_hs_memory:
        'Memory Layer - Engram (2078 observations), CodeGraph (10,663 nodes), Graphify 18MB knowledge graph, ML Embeddings vector index, Nexus DB and Knowledge Vault.',
      tip_hs_pipeline:
        'Pipeline - 105 steps configured, 101 enabled: 31 Phase 1 parallel + 70 lazy background in batches of 5. Promise.allSettled never blocks on failure.',
      tip_hs_tools:
        'Tools - 10 IDE integrations: OpenCode, Claude Code, Cursor, Windsurf, Cline, Codex, Copilot, Continue.dev, Aider, Roo Code.',
      tip_c_agentspipeline_10: 'Code generation, feature building, refactoring',
      tip_c_agentspipeline_11: 'sdd-verify',
      tip_c_agentspipeline_12: 'Testing, validation, quality gates',
      tip_c_agentspipeline_13: 'gov-agent',
      tip_c_agentspipeline_14: 'Compliance, security, policy enforcement',
      tip_c_agentspipeline_15: 'ops-agent',
      tip_c_agentspipeline_16: 'Deployment, CI/CD, infrastructure',
      tip_c_agentspipeline_17: 'doc-agent',
      tip_c_agentspipeline_18: 'Technical docs, ADRs, guides',
      tip_c_agentspipeline_19: 'session-agent',
      tip_c_agentspipeline_20: 'State tracking, lifecycle management',
      tip_c_agentspipeline_21: 'premortem-agent',
      tip_c_agentspipeline_22: 'Risk identification, failure prediction',
      tip_c_agentspipeline_23: 'maintenance-agent',
      tip_c_agentspipeline_24: 'Cleanup, optimization, health monitoring',
      tip_c_agentspipeline_25: 'self-diag-agent',
      tip_c_agentspipeline_26: 'Auto-debug and break-glass recovery',
      tip_c_agentspipeline_27: 'sia-agent',
      tip_c_agentspipeline_28: 'Self-improving agent, iterative refinement',
      tip_c_agentspipeline_29: 'gitflow-agent',
      tip_c_agentspipeline_30: 'Branch management, PR automation',
      tip_c_agentspipeline_31: 'knowledge-agent',
      tip_c_agentspipeline_32: 'Knowledge base operations, vault management',
      tip_c_agentspipeline_33: 'explore',
      tip_c_agentspipeline_34: 'Fast codebase exploration',
      tip_c_agentspipeline_35: 'general',
      tip_c_agentspipeline_36: 'Research and multi-step tasks',
      tip_c_agentspipeline_4: 'Routes, coordinates, session lifecycle',
      tip_c_agentspipeline_5: 'sdd-explore',
      tip_c_agentspipeline_6: 'Requirements gathering, analysis, clarification',
      tip_c_agentspipeline_7: 'sdd-design',
      tip_c_agentspipeline_8: 'System design, API contracts, architecture',
      tip_c_agentspipeline_9: 'sdd-apply',
      tip_c_health_10: 'Config files, bridge health, MCP status',
      tip_c_health_11: 'Session dir, manifest, pipeline config',
      tip_c_health_12: 'Git hooks: pre-commit, post-commit, post-merge',
      tip_c_health_13: 'JSON schemas, 5 configs, JSON validator',
      tip_c_health_14: 'Clinerules, cursorrules, continue config',
      tip_c_health_15: 'Opencode structure, auth config, security orchestrator',
      tip_c_health_16: 'Hybrid executor, AWS/Azure delegators',
      tip_c_health_17: 'Tracing spans, OTLP export, span files',
      tip_c_health_18: 'Checkpoint dir, snapshots, rollback readiness',
      tip_c_health_19: 'Nexus DB file, WAL, integrity check, 7 migrations, 21 tables',
      tip_c_health_20: 'Model router, profiles, fallback configuration',
      tip_c_health_21: 'Audit logs, pipeline, archive',
      tip_c_health_22: 'Policy files, rules directory, 60 normatives',
      tip_c_health_27: 'Init DB + run all migrations',
      tip_c_health_28: 'Health check: integrity, WAL, tables, rows',
      tip_c_health_29: 'Safe online backup to .runtime/backups/',
      tip_c_health_30: 'WAL checkpoint + REINDEX + VACUUM',
      tip_c_health_31: 'Prune old data from stack tables',
      tip_c_health_32: 'Show backlog statistics by status/severity/type',
      tip_c_health_33: 'List backlog items with filters',
      tip_c_health_34: 'Generate markdown report',
      tip_c_health_36: 'dev, po, qa, ux, ops, sec, any',
      tip_c_health_37: 'critical, high, medium, low',
      tip_c_health_38: '1-5 numeric',
      tip_c_health_39: 'Estimated resolution time',
      tip_c_health_40: 'blocking, major, minor, cosmetic',
      tip_c_health_41: 'Target version/release',
      tip_c_health_42: 'dev, staging, prod, all',
      tip_c_health_43: 'open, in_progress, resolved, wont_fix, backlog, duplicate',
      tip_c_health_44: 'Comments',
      tip_c_health_45: 'Discussion thread per item',
      tip_c_health_46: 'Status History',
      tip_c_health_47: 'Full audit trail of status changes',
      tip_c_health_48: 'Related Items',
      tip_c_health_49: 'duplicates, blocked_by, supersedes, child_of',
      tip_c_health_5: 'Dashboard WS server, API 200, watchdog PID',
      tip_c_health_50: 'Tags',
      tip_c_health_51: 'Multi-label categorization',
      tip_c_health_52: 'Session Link',
      tip_c_health_53: 'Traceability to session where found/fixed',
      tip_c_health_54: 'Search',
      tip_c_health_55: 'Find similar items to prevent duplicates',
      tip_c_health_56: 'Auto-prune',
      tip_c_health_57: 'Remove old resolved items (configurable TTL)',
      tip_c_health_6: 'Index exists, 677 files, 10,663 nodes, 21,746 edges, 28MB',
      tip_c_health_7: 'Timeout daemon, watchdog PIDs, restart loop protection',
      tip_c_health_8: 'ML index, embedding files, skill embeddings',
      tip_c_health_9: 'DB integrity, reindex log, RAG pipeline, 2078 obs',
      tip_c_operationscloud_10: 'Verify CI/CD workflow syntax',
      tip_c_operationscloud_11: 'Research script integrity',
      tip_c_operationscloud_12: 'Nexus DB health check',
      tip_c_operationscloud_13: 'Safe online backup',
      tip_c_operationscloud_14: 'Full maintenance check',
      tip_c_operationscloud_9: 'Validate JSON schemas',
      tip_c_quickstart_11: 'Run all test suites',
      tip_c_quickstart_12: 'Run health checks',
      tip_c_quickstart_13: 'Check pending auto-applies',
      tip_c_quickstart_14: 'Database health check',
      tip_c_quickstart_15: 'Knowledge graph query',
      tip_c_quickstart_16: 'Build dashboard',
      tip_c_quickstart_18: 'Start full dashboard (Vite dev + WS proxy)',
      tip_c_quickstart_19: 'Start WS server only (WebSocket + HTTP API)',
      tip_c_quickstart_20: 'Build production dashboard bundle',
      tip_c_quickstart_22: 'Initialize DB + run all migrations (idempotent)',
      tip_c_quickstart_23: 'Health check — integrity, WAL, tables, rows',
      tip_c_quickstart_24: 'Prune old data (events &gt;30d, cache &gt;7d, tokens &gt;90d)',
      tip_c_quickstart_25: 'WAL checkpoint + REINDEX + VACUUM',
      tip_c_securitygovernance_12: 'Append entry to daily JSONL',
      tip_c_securitygovernance_13: 'Current audit status',
      tip_c_securitygovernance_14: 'Search audit entries',
      tip_c_securitygovernance_15: 'Rotate old logs to archive',
      tip_c_securitygovernance_16: 'Remove expired entries',
      tip_c_securitygovernance_54: 'AI-NORMATIVES.md',
      tip_c_securitygovernance_55: 'Core AI behavior &amp; ethical guidelines',
      tip_c_securitygovernance_56: 'NORMATIVAS-ARCHITECTURE.md',
      tip_c_securitygovernance_57: 'System design constraints &amp; patterns',
      tip_c_securitygovernance_58: 'Architecture',
      tip_c_securitygovernance_59: 'NORMATIVAS-SECURITY-COMPLIANCE.md',
      tip_c_securitygovernance_60: 'Security hardening &amp; compliance',
      tip_c_securitygovernance_61: 'Security',
      tip_c_securitygovernance_62: 'NORMATIVAS-CODE-QUALITY.md',
      tip_c_securitygovernance_63: 'Code review gates &amp; quality thresholds',
      tip_c_securitygovernance_64: 'Quality',
      tip_c_securitygovernance_65: 'NORMATIVAS-WORKFLOW.md',
      tip_c_securitygovernance_66: 'Operational workflows &amp; sequences',
      tip_c_securitygovernance_67: 'Workflow',
      tip_c_securitygovernance_68: 'NORMATIVAS-OPS-DEVOPS.md',
      tip_c_securitygovernance_69: 'CI/CD, deployment, infrastructure rules',
      tip_c_securitygovernance_70: 'DevOps',
      tip_c_securitygovernance_71: 'NORMATIVAS-AUTONOMOUS-EVOLUTION.md',
      tip_c_securitygovernance_72: 'Self-evolution &amp; norm promotion',
      tip_c_securitygovernance_73: 'Autonomy',
      tip_c_securitygovernance_74: 'NORMATIVAS-EVAL-QUALITY.md',
      tip_c_securitygovernance_75: 'Evaluation gates &amp; assessment',
      tip_c_securitygovernance_77: 'NORMATIVAS-MULTI-TENANT.md',
      tip_c_securitygovernance_78: 'Tenant isolation &amp; resource limits',
      tip_c_securitygovernance_79: 'Multi-Tenant',
      tip_c_securitygovernance_80: 'NORMATIVAS-PERFORMANCE.md',
      tip_c_securitygovernance_81: 'Performance budgets &amp; SLAs',
      tip_c_securitygovernance_82: 'Performance',
      tip_c_securitygovernance_83: 'NORMATIVAS-ENFORCEMENT.md',
      tip_c_securitygovernance_84: 'Enforcement mechanisms &amp; escalation',
      tip_c_securitygovernance_85: 'Governance',
      tip_c_securitygovernance_86: 'HUMAN-IN-THE-LOOP.md',
      tip_c_securitygovernance_87: 'Human oversight &amp; approval gates',
      tip_c_securitygovernance_89: 'INCIDENT-RESPONSE.md',
      tip_c_securitygovernance_90: 'Incident handling &amp; recovery',
      tip_c_securitygovernance_92: 'SECRETS-MANAGEMENT.md',
      tip_c_securitygovernance_93: 'Secrets handling &amp; rotation',
      tip_c_securitygovernance_95: 'COST-ATTRIBUTION.md',
      tip_c_securitygovernance_96: 'Cost tracking &amp; attribution',
      tip_c_securitygovernance_97: 'Finance',
      tip_fm_55:
        '11 repositories total: 10 DAOs + MigrationRunner. The MigrationRunner applies schema migrations in order with FK ON and WAL mode.',
      tip_fm_56:
        '7 schema migrations create 21 tables. Migration 001 = initial schema, 002 = stack tables, 003 = session scoring, applied automatically by DatabaseManager at session start.',
      tip_fm_57:
        '6-layer decoupled design: Tools -> Agents -> Pipeline -> Memory -> Data -> Executive.',
      tip_fm_58:
        '31 Phase-1 steps run in parallel at session start using Promise.allSettled. Non-blocking and idempotent.',
      tip_fm_59:
        '70 lazy background tasks are queued in batches after session start (batch delay 500ms -> 100ms).',
      tip_fm_60:
        'All batch tasks use Promise.allSettled so a single failure never blocks the pipeline.',
      tip_fm_61:
        'Executive engine: trigger -> apply -> verify -> rollback. Max 5 auto-applies/day, rollback on >15% degradation.',
      tip_fm_62:
        '3-state CLOSED/OPEN/HALF_OPEN pattern. 5 failures -> OPEN, 2 successes -> CLOSED.',
      tip_fm_63:
        '3-tier escalation: warning(3) -> critical(5) -> emergency(10) with audit trail + findings ledger.',
      tip_fm_64:
        'Auto-discovers component relationships from the pipeline config. No hardcoded dependency map.',
      tip_fm_65:
        'createExperiment -> assign -> evaluate with automatic rollback on statistical degradation.',
      tip_fm_66:
        'Per-session quality scoring tracking delegations, corrections and proactive hits. Anomaly detection.',
      tip_fm_67:
        'Auto-discovers patterns in executions and writes LEARNED-NORMS.md. Adaptive evolution.',
      tip_fm_68:
        'Engram persistent memory: 2078 observations, auto-sync across sessions and projects.',
      tip_fm_69:
        'CodeGraph knowledge graph: 10,663 nodes and 21,746 edges derived from AST analysis.',
      tip_fm_70:
        'Graphify 18MB knowledge graph with god nodes, community structure and cross-file relationships.',
      tip_fm_71:
        'Nexus operational DB: SQLite WAL mode, 21 tables, auto-init, auto-prune, auto-backup and watchtower monitoring.',
      tip_fm_72:
        'ML Embeddings vector index for semantic search over skills, norms and documentation.',
      tip_fm_73:
        'Pre-input scanning, audit pipeline, policy enforcement and guardrails before every prompt.',
      tip_fm_74:
        'JSONL audit logs with log/status/query/archive/prune actions under .session/audit/logs/.',
      tip_fm_75: 'Governance policies + rules enforcement across all 21 watchtower components.',
      tip_fm_76:
        'Guardrails: pre-input validation that rejects unsafe prompts before they reach the model.',
      tip_fm_77: '60 normatives covering rules and policies for autonomous operation.',
      tip_fm_78:
        'WebSocket push to the dashboard every 5 seconds with real metrics computed from traces.',
      tip_fm_79:
        'HTTP polling fallback keeps the dashboard alive even when the WS server is temporarily down.',
      tip_fm_80:
        '7 dashboard sections: overview, metrics, tracing, alerts, feedback, i18n and info popups.',
      tip_fm_81:
        'Full UI translation in English, Spanish and Brazilian Portuguese (14 metric descriptions).',
      tip_fm_82: '8 alert rules auto-evaluated every broadcast cycle with status ok/degraded/fail.',
      tip_fm_83: '6 CI jobs + 3 security jobs (gitleaks, secretlint, trivy) on every push.',
      tip_fm_84:
        'Hybrid AWS/Azure routing by cost, latency and load with circuit breaker fallback.',
      tip_fm_85: 'Span-based distributed tracing with OTLP export. JSONL spans under .telemetry/.',
      tip_fm_86:
        'Checkpoints, snapshots and rollback with dry-run validation. Auto-create at session start.',
      tip_fm_87:
        'Append-only event store + saga orchestrator with compensation steps for consistency.',
      tip_fm_88: '109 test files across 10 suites covering units, configs, workflows and CI/CD.',
      tip_fm_89: '95 health checks across 21 components. All green: 95/95 PASS, 0 WARN, 0 FAIL.',
      tip_fm_90:
        'Multi-axis code review: correctness, readability, architecture, security and performance.',
      tip_fm_91: 'Karpathy guidelines: Think First, Simplicity, Surgical Changes, Goal-Driven.',
      tip_fm_92:
        'SDD workflow: explore -> design -> apply -> verify with formal input/output contracts.',
      tip_auto_loop:
        'Detection → Evaluation → Decision → Execution → Verification → Learning. Reads 3 trigger sources: predictive-governor (budget), skill-evolution (deprecation) and auto-norm-learner (norms). Auto-apply safe with rollback if degradation >15%.',
      tip_auto_safety:
        'Health & safety envelope: 95/95 checks PASS across 21 components, circuit breaker (5 failures → OPEN, 2 successes → CLOSED), 3-tier auto-escalation (3→5→10), auto-rollback and a minimum apply threshold of 80% confidence.',
      tip_cacherepo:
        'response_cache + semantic cache — SHA256 key → response with TTL awareness and hit_count tracking; semantic cache adds embedding similarity lookup.',
      tip_contractrepo:
        'contract_results — persistence of SDD (Spec-Driven Development) contract validation: input/output contracts evaluated per delegation.',
      tip_errormemrepo:
        'error_memory + embeddings — bug tracking with vector search so past errors and their fixes are retrievable by semantic similarity.',
      tip_eventrepo:
        'events + alerts — append-only event sourcing with SHA-256 hash chain (tamper-proof) plus the 8 alert rules evaluated on a 5s broadcast cycle.',
      tip_exe_abtest:
        'Statistical A/B testing: createExperiment → assign → evaluate. Auto-rollback when the winning variant shows statistical degradation against the control.',
      tip_exe_autoapply:
        'Executive engine: trigger→apply→verify→rollback with a safety cap of 5 auto-applies per day. Any change that degrades performance more than 15% is rolled back automatically.',
      tip_exe_circuit:
        '3-state CLOSED/OPEN/HALF_OPEN pattern: 5 consecutive failures open the circuit, 2 successes move it to HALF_OPEN then CLOSED. Prevents cascade failures in cloud and pipeline calls.',
      tip_exe_cloud:
        'Hybrid AWS/Azure executor routing by cost, latency and load with automatic fallback. Circuit breaker: 5 failures → OPEN, 2 successes → HALF_OPEN → CLOSED.',
      tip_exe_depgraph:
        'Auto-discovers component relationships by reading the pipeline configuration — no hardcoded dependency map. The graph stays correct as steps are added or removed.',
      tip_exe_escalation:
        '3-tier escalation: warning (3 failures) → critical (5) → emergency (10). Every escalation writes a full audit trail into the findings ledger.',
      tip_exe_norms:
        'Auto-discovers recurring patterns in executions and writes them to LEARNED-NORMS.md — the stack literally evolves its own rules over time.',
      tip_exe_scoring:
        'Per-session quality scoring tracking delegations, corrections and proactive hits. Compares scores automatically and alerts on >15% regression or anomalies.',
      tip_exe_security:
        'Pre-input scanning of every prompt, audit pipeline (JSONL logs with query/archive/prune), policy enforcement and guardrails. Governed by 60+ normatives.',
      tip_exe_state:
        'Checkpoint, snapshot and rollback with dry-run validation. Checkpoints auto-create at session start; rollback restores state safely from the last good checkpoint.',
      tip_exe_tracing:
        'Span-based distributed tracing with OTLP export to http://localhost:4318/v1/traces. Spans persist as JSONL under .telemetry/spans/ and .telemetry/traces/.',
      tip_exe_watchtower:
        'Central health orchestrator: 95 checks across 21 components running with Promise.allSettled parallelism. Modes: health, rebuild, autoheal, report, continuous, all.',
      tip_housekeepingrepo:
        'pruneAll, housekeeping, vacuum — automatic WAL checkpoint when >1MB, retention pruning and DB optimization (REINDEX, VACUUM).',
      tip_met_health:
        '95/95 checks PASS across 21 components: dashboard-ws, codegraph, ml-embeddings, engram, mcp, session, hooks, configs, tool-configs, security, cloud-connectors, tracing, state-persistence, audit, governance and gentle-vanguard-db. Measured by the maintenance watchtower.',
      tip_met_perf:
        'Key performance indicators: watchtower checks went from sequential to parallel execution, lazy batch delay optimized 500ms → 100ms (5x faster), DB Manager refactored 1066 → 250 lines (-77%) and autonomy climbed from 73% to 100%.',
      tip_metricsrepo:
        'CRUD for metric_snapshots — time-series of tokens, latency and health sampled every 30s. Powers the real-time dashboard charts and trend analysis.',
      tip_nexus_arch:
        'Nexus is the operational brain: SQLite in WAL mode with FK ON. 11 repositories (10 DAOs + MigrationRunner), 7 migrations (m001 initial schema, m002 stack tables, m003 session scoring, …) and 21 tables. Each component persists its live state to .state.json files under .session/context-log/. Auto-init, auto-prune, auto-backup and watchtower monitoring (gentle-vanguard-db component).',
      tip_sessionrepo:
        'sessions + session_scoring — upsert by session_id, active session queries and per-session quality scoring (delegations, corrections, proactive hits).',
      tip_sk_analysis:
        'idea-refine, doubt-driven-dev, premortem, socratic-skill, interview-me and source-driven — thinking frameworks that stress-test ideas before execution.',
      tip_sk_arch:
        'The SDD pipeline: sdd-explore (BA), sdd-design (SAD), sdd-apply (DEV) and sdd-verify (QA) plus systems-thinking and api-interface — spec-driven development from idea to verified code.',
      tip_sk_auto:
        'Skills that power self-management: auto-apply-safe, circuit-breaker, auto-escalation, session-scoring, predictive-governor and auto-norm-learner — the executive brain of the stack.',
      tip_sk_dev:
        'typescript-skill, testing-skill, testing-coverage, technical-debt, code-review and shellcheck — coding quality gates applied before every change lands.',
      tip_sk_docs:
        'doc-agent, writing-plans, write-spec, visual-content, documentation and standup-skill — produce and maintain high-quality documentation natively.',
      tip_sk_infra:
        'ci-cd-automation, observability, performance-opt, cloud-connectors, NORMATIVAS-OPS and SELF-HEALING-CI — the operational layer that keeps the stack running.',
      tip_sk_quality:
        'testing-evidence, eval-gates, CI-HARDENING, Karpathy, HALLUCINATION and SDD-STRICT-TDD — evidence-based gates that block low-quality output.',
      tip_sk_sec:
        'Security skill, security-audit, governance-agent, AI-NORMATIVES, SECRETS-MGMT and INCIDENT-RESPONSE — enforce policy and guardrails across every prompt.',
      tip_sk_tooling:
        'start-skill, workflow-orch, session-workflow, task-mgmt, semantic-matcher and skill-creator — the meta-skills that manage how all other skills are used.',
      tip_skillrepo:
        'skill_usage, token_usage, routing_rules — per-session skill usage tracking, real token accounting with generated total_tokens column and adaptive router persistence with hit_count.',
      tip_tracerepo:
        'traces + feedback — distributed tracing spans with waterfall view, latency statistics and thumbs up/down per span from the observability dashboard.',

      // Dashboard-specific tips (for triggers)
      tip_dashboard_websocket:
        'WebSocket real-time updates every 5 seconds with automatic HTTP polling fallback for resilience.',
      tip_dashboard_sections:
        '7 dashboard sections: Metrics, Traces, Alerts, Scoring, Waterfall, Feedback, and Info panels.',
      tip_dashboard_alerts:
        '8 configurable alert rules monitoring token usage, health status, and performance thresholds.',
      tip_dashboard_i18n:
        'Internationalization support: English, Spanish, and Portuguese with automatic language detection.',

      // Patterns & Conventions tips
      tip_patterns_karpathy:
        'Karpathy Guidelines: Think First, Simplicity, Surgical Changes, Goal-Driven — quality rubrics for AI output.',
      tip_patterns_sdd:
        'Spec-Driven Development lifecycle: Explore → Design → Apply → Verify with confidence thresholds.',
      tip_patterns_slop:
        'AI Slop Detection: automated quality gates to prevent generic, unhelpful AI-generated content.',
      tip_patterns_arch:
        '10 architectural patterns: Layered, Event-Driven, CQRS, Circuit Breaker, Saga, and more.',
      tip_patterns_standards:
        'Development standards: code conventions, documentation requirements, and review gates.',
      tip_patterns_docs:
        'Cognitive load reduction and progressive disclosure in technical documentation.',
    },
    es: {
      nav_home: 'Inicio',
      nav_arch: 'Arq',
      nav_autonomy: 'Autonomía',
      nav_dashboard: 'Dashboard',
      nav_quickstart: 'Inicio Rápido',
      nav_memory: 'Memoria',
      nav_security: 'Seguridad',
      nav_agents: 'Agentes',
      nav_cloud: 'Nube',
      nav_patterns: 'Patrones',
      nav_health: 'Salud',
      nav_diagrams: 'Diagramas',
      /* Títulos de sección — index */
      sec_architecture: 'Arquitectura del Sistema',
      sec_components: 'Componentes del Stack',
      sec_autonomous: 'Sistemas Autónomos',
      sec_data_layer: 'Capa de Datos — 11 Repos',
      sec_executive: 'Sistemas Ejecutivos',
      sec_feature_matrix: 'Matriz de Funcionalidades',
      sec_skills_rules: 'Explorador de Skills y Reglas',
      sec_stack_metrics: 'Métricas del Stack',
      sec_the_book: 'El Libro',
      sec_diagrams: 'Diagramas y Visualizaciones',
      sec_tools: 'Ecosistema de Herramientas',
      /* Títulos de sección — architecture */
      sec_arch_layers: 'Arquitectura del Sistema',
      sec_daos: 'Objetos de Acceso a Datos',
      sec_pipeline: 'Pipeline de Sesión',
      sec_performance: 'Optimizaciones de Rendimiento',
      /* Títulos de sección — agents-pipeline */
      sec_agent_eco: 'Ecosistema de Agentes',
      sec_routing: 'Reglas de Ruteo',
      sec_lifecycle: 'Ciclo de Vida de Sesión',
      sec_delegation: 'Modelo de Delegación',
      sec_skills_system: 'Sistema de Skills',
      /* Títulos de sección — quickstart */
      sec_prereq: 'Requisitos Previos',
      sec_setup: 'Instalación en un Comando',
      sec_daily: 'Comandos Diarios',
      sec_dash_cmds: 'Comandos del Dashboard',
      sec_db_cmds: 'Comandos de Base de Datos',
      sec_workflow: 'Flujo de Desarrollo',
      sec_arch_overview: 'Resumen de Arquitectura',
      sec_troubleshoot: 'Solución de Problemas',
      sec_references: 'Enlaces de Referencia',
      /* Títulos de sección — memory-knowledge */
      sec_mem_stack: 'El Stack de Memoria',
      sec_engram: 'Engram — Memoria Persistente',
      sec_codegraph: 'CodeGraph — Inteligencia de Símbolos',
      sec_graphify: 'Graphify — Grafo de Conocimiento',
      sec_nexus: 'Nexus DB — Base de Datos Operacional',
      sec_mem_daos: 'Objetos de Acceso a Datos',
      sec_ml_emb: 'Embeddings ML',
      sec_kb_manager: 'Gestor de Base de Conocimiento',
      sec_data_flow: 'Diagrama de Flujo de Datos',
      /* Títulos de sección — security-governance */
      sec_sec_orch: 'Orquestador de Seguridad',
      sec_audit: 'Pipeline de Auditoría',
      sec_normatives: 'Sistema de Normativas',
      sec_guardrails: 'Guardarraíles y Políticas',
      sec_governance: 'Marco de Gobernanza',
      sec_compliance: 'Verificaciones de Cumplimiento',
      sec_hardening: 'Endurecimiento de Seguridad',
      sec_standards: 'Resumen de Estándares',
      /* Hero */
      hero_subtitle: 'Plataforma Autónoma de Orquestración AI — 100% Autónoma',
      /* Títulos — health */
      sec_health_dash: 'Dashboard de Salud',
      sec_perf_slos: 'SLOs de Rendimiento',
      /* Títulos — operations-cloud */
      sec_ci_cd: 'Pipeline CI/CD',
      sec_security_wf: 'Flujo de Seguridad',
      sec_cloud_conn: 'Conectores Cloud',
      sec_cb_states: 'Estados del Circuit Breaker',
      sec_tracing: 'Trazabilidad Distribuida',
      sec_state_persist: 'Persistencia de Estado',
      sec_event_saga: 'Event Sourcing + Saga',
      sec_health_api: 'API de Salud',
      sec_testing_infra: 'Infraestructura de Testing',
      sec_ops_cmds: 'Comandos de Operaciones',
      sec_pipe_integ: 'Integración de Pipeline',
      /* Info tips (modal de la "i") */
      info_kicker: 'Más información',
      info_title: 'Acerca de esta función',
      info_hint: 'Pulsa ESC o haz clic fuera para cerrar',
      lbox_hint_wheel: 'Rueda para zoom',
      lbox_hint_drag: 'Arrastra para mover',
      lbox_hint_dbl: 'Doble clic para alternar',
      tip_pipeline:
        'Autostart de sesión: 31 pasos Phase-1 en paralelo + 70 pasos lazy en background lanzados en lotes de 5. Incluye detección de herramientas, presupuesto de tokens, guías Karpathy, sync de codegraph, orquestación de seguridad e init de BD.',
      tip_engram:
        'Memoria persistente con sincronización automática, checks de integridad SHA256 y compactación. Actualmente con 2,078 observaciones en 369 sesiones. Sobrevive entre sesiones y compactaciones.',
      tip_codegraph:
        'Grafo de conocimiento SQLite para inteligencia de símbolos. 10,663 nodos y 21,746 aristas en 677 archivos con consultas de símbolos en menos de un milisegundo.',
      tip_dashboard:
        'SPA de observabilidad React + TypeScript + Vite. WebSocket con actualizaciones en tiempo real cada 5s con fallback de polling HTTP, 7 secciones del dashboard, i18n en 3 idiomas y 8 reglas de alerta.',
      tip_circuit:
        'Circuit breaker de 3 estados (CLOSED / OPEN / HALF_OPEN). 5 fallos abren el circuito, 2 éxitos lo recuperan. Previene fallos en cascada en todo el stack.',
      tip_autoapply:
        'Motor ejecutivo que sigue trigger → evaluar (confianza ≥80%) → aplicar → verificar → rollback. Máximo 5 auto-aplicaciones por día con rollback si la degradación supera el 15%.',
      tip_depgraph:
        'Descubre dinámicamente las relaciones entre componentes desde la config del pipeline, reemplazando el mapa de dependencias hardcodeado. Arquitectura auto-mantenible.',
      tip_escalation:
        'Escalación de 3 niveles: advertencia (3 fallos) → crítico (5) → emergencia (10). Cada escalación queda registrada con trazabilidad completa en el ledger de hallazgos.',
      tip_abtest:
        'Framework estadístico de A/B testing: createExperiment, assignVariant, evaluateExperiment con rollback automático ante degradación estadística.',
      tip_scoring:
        'Scoring de calidad por sesión que rastrea delegaciones, correcciones y aciertos proactivos. Comparación automática, detección de regresión mayor al 15% y alertas de anomalías.',
      tip_watchtower:
        'Orquestador central de salud: 95 checks en 21 componentes con ejecución paralela Promise.allSettled y modos de auto-healing (health, rebuild, autoheal, report, continuous).',
      tip_nexus:
        'Base de datos operacional SQLite (modo WAL, FK ON) con 11 repositorios, 7 migraciones y 21 tablas. Auto-init, auto-prune, auto-backup y monitoreo por watchtower.',
      tip_layers:
        'El stack se organiza en 6 capas: Tools (10 IDEs) → Agents (21 especializados) → Pipeline (101 pasos habilitados) → Memoria y Conocimiento → Datos (11 repos) → Sistemas ejecutivos.',
      section_overview: 'Resumen',
      section_architecture: 'Arquitectura',
      section_metrics: 'Métricas',
      section_quickstart: 'Inicio Rápido',
      section_security: 'Seguridad y Gobernanza',
      section_operations: 'Operaciones',
      section_patterns: 'Patrones y Convenciones',
      section_memory: 'Memoria y Conocimiento',
      section_agents: 'Agentes y Pipeline',
      section_autonomy: 'Niveles de Autonomía',
      section_dashboard: 'Dashboard',
      theme_dark: 'Oscuro',
      theme_light: 'Claro',
      lang_en: 'English',
      lang_es: 'Español',
      lang_pt: 'Português',
      footer_all_rights: 'Todos los derechos reservados.',
      footer_built_with: 'Construido con',
      see_docs: 'Ver Documentación',
      view_on_github: 'Ver en GitHub',
      coming_soon: 'Próximamente',
      loading: 'Cargando...',
      error: 'Error',
      search: 'Buscar...',
      no_results: 'Sin resultados.',
      back_to_top: 'Volver arriba',
      copy: 'Copiar',
      copied: '¡Copiado!',
      close: 'Cerrar',
      save: 'Guardar',
      cancel: 'Cancelar',
      delete: 'Eliminar',
      edit: 'Editar',
      create: 'Crear',
      update: 'Actualizar',
      refresh: 'Actualizar',
      download: 'Descargar',
      upload: 'Subir',
      filter: 'Filtrar',
      sort: 'Ordenar',
      status_ok: 'Operativo',
      status_warn: 'Advertencia',
      status_error: 'Error',
      status_unknown: 'Desconocido',

      tip_hs_dash_backend:
        'Backend Server: real-data.ts calcula métricas desde los state files; WebSocket Server empuja cada 5s en el puerto 8080.',
      tip_hs_dash_fallback:
        'HTTP Polling Fallback: useMetrics.ts siempre hace polling HTTP, así los datos cargan aunque el servidor WebSocket esté caído.',
      tip_hs_dash_frontend:
        'Frontend - React/Vite: 7 secciones (Metrics, Traces, Alerts, Feedback, Scoring, Waterfall, Info Popup) con i18n.',
      tip_hs_dash_sources:
        'Data Sources: datos de trazas reales leídos de .session/context-log/*.state.json y *.meta.json - sin datos simulados.',
      tip_hs_dash_watchdog:
        'Watchdog Auto-Recovery: monitoriza :8080 cada 5s, reinicia hasta 10 veces y mata el watchdog primero para evitar bucles.',
      tip_hs_data_nexus:
        'NEXUS DB: base de datos operacional SQLite (gentle-vanguard.db) con modo WAL, FK ON, 12 tablas y 3 migraciones.',
      tip_hs_data_repos_blue:
        'DAOs de datos (azul): MetricsRepo (metric_snapshots), SessionRepo (sessions) y TraceRepo (traces) - series temporales e historial de sesiones.',
      tip_hs_data_repos_green:
        'DAOs de calidad (verde): CacheRepo (response_cache) y EventRepo (events) - caché y auditoría de event sourcing.',
      tip_hs_data_repos_orange:
        'DAOs de ops (naranja): HousekeepingRepo (token_usage) y MigrationRunner (7 migraciones) - mantenimiento y evolución de esquema.',
      tip_hs_data_repos_purple:
        'DAOs de memoria (púrpura): SkillRepo (skill_usage), ContractRepo (contract_results) y ErrMemoryRepo (scoring) - uso y puntuación.',
      tip_hs_flow_karpathy:
        'Karpathy Guidelines: 3 reglas (Think First, Simplicity, Surgical Changes) con rúbricas de calidad y autocrítica.',
      tip_hs_flow_lazy_batch:
        'Lazy Batch - 5 workers en background: ejecuta pasos diferidos como Tracing Init, Cloud Connectors, Event Sourcing, Audit Pipeline y Dashboard WS.',
      tip_hs_flow_phase1:
        'Fase 1 - 31 pasos paralelos: inicializadores rápidos e independientes que corren en concurrencia y nunca bloquean ante fallos.',
      tip_hs_flow_phase2:
        'Fase 2 - 70 pasos lazy background: trabajo pesado diferido ejecutado en batches de 5 workers tras el inicio de sesión.',
      tip_hs_flow_process_bar:
        'Barra de proceso: pasos paralelos (31), luego lazy background (70) y DONE - el pipeline completo de 101 pasos.',
      tip_hs_flow_session_manager:
        'Session Manager: genera el ID de sesión, sincroniza Engram y rastrea el ciclo de vida de la sesión.',
      tip_hs_flow_token_budget:
        'Token Budget: asigna el presupuesto de 5M diario / 3M por sesión y aplica los umbrales de guardia.',
      tip_hs_flow_tool_detection:
        'Tool Detection: mapea las 8 herramientas disponibles (Bash, Read, Write, Edit, Grep, Glob, Task, Skill).',
      tip_hs_loop_auto_escalation:
        'Guard rail - Auto-Escalation: promueve problemas no resueltos a una autoridad superior (orquestador o humano).',
      tip_hs_loop_autoapply:
        'Auto-Apply SAFE: el portón central de verificación - los cambios solo se aplican cuando superan todas las comprobaciones de seguridad.',
      tip_hs_loop_circuit_breaker:
        'Guard rail - Circuit Breaker: se abre tras fallos repetidos para detener errores en cascada y pausa el bucle.',
      tip_hs_loop_decision:
        'Fase 3 - Decisión: elige la acción ganadora con umbrales de confianza; escala cuando la incertidumbre es alta.',
      tip_hs_loop_detection:
        'Fase 1 - Detección: identifica anomalías, nuevas señales o eventos de degradación en el entorno, salidas de herramientas y trazas de sesión.',
      tip_hs_loop_evaluation:
        'Fase 2 - Evaluación: puntúa cada acción candidata según rúbricas de calidad, coste y riesgo antes de decidir.',
      tip_hs_loop_execution:
        'Fase 4 - Ejecución: aplica la acción seleccionada a través del portón seguro auto-apply, rastreando cada mutación.',
      tip_hs_loop_learning:
        'Fase 6 - Aprendizaje: registra los resultados en Engram y la tabla de ruteo, mejorando decisiones futuras.',
      tip_hs_loop_norms_learner:
        'Guard rail - Norms Learner: aprende las convenciones del proyecto y las inyecta como normas adaptativas en nuevas sesiones.',
      tip_hs_loop_session_scoring:
        'Guard rail - Session Scoring: puntúa cada sesión (delegaciones, correcciones, aciertos proactivos) y alimenta la tabla de ruteo.',
      tip_hs_loop_verification:
        'Fase 5 - Verificación: ejecuta typecheck, lint y tests; si la verificación falla, la acción se revierte.',
      tip_hs_agents:
        'Agents - 21 subagentes especializados: Orchestrator, SDD (explore/design/apply/verify), Doc, Ops, Gov, Session, Premortem, Maintenance, Self-Diag, SIA, GitFlow, Knowledge + business (Mkt, Sales, Finance, HR, Legal, Bus-Tele).',
      tip_hs_data:
        'Data Layer - Base Nexus SQLite con 11 repositorios (10 DAOs + MigrationRunner), 7 migraciones y 21 tablas. Modo WAL y FK ON habilitados.',
      tip_hs_executive:
        'Executive Systems - 12 subsistemas autónomos: Auto-Apply Safe, Circuit Breaker, Auto-Escalation, Dynamic Dependency Graph, AB Testing, Session Scoring, Norms Learner, Watchtower, Security Orchestrator, State Persistence, Distributed Tracing, Cloud Connectors',
      tip_hs_memory:
        'Memory Layer - Engram (2078 observaciones), CodeGraph (10.663 nodos), Graphify 18MB grafo de conocimiento, ML Embeddings índice vectorial, Nexus DB y Knowledge Vault.',
      tip_hs_pipeline:
        'Pipeline - 105 pasos configurados, 101 habilitados: 31 Phase 1 paralelos + 70 lazy background en batches de 5. Promise.allSettled nunca bloquea ante fallos.',
      tip_hs_tools:
        'Tools - 10 integraciones IDE: OpenCode, Claude Code, Cursor, Windsurf, Cline, Codex, Copilot, Continue.dev, Aider, Roo Code.',
      tip_c_agentspipeline_10: 'Generación de código, construcción de features, refactoring',
      tip_c_agentspipeline_11: 'sdd-verify',
      tip_c_agentspipeline_12: 'Testing, validación, quality gates',
      tip_c_agentspipeline_13: 'gov-agent',
      tip_c_agentspipeline_14: 'Cumplimiento, seguridad y aplicación de políticas',
      tip_c_agentspipeline_15: 'ops-agent',
      tip_c_agentspipeline_16: 'Deployment, CI/CD, infraestructura',
      tip_c_agentspipeline_17: 'doc-agent',
      tip_c_agentspipeline_18: 'Documentación técnica, ADRs, guías',
      tip_c_agentspipeline_19: 'session-agent',
      tip_c_agentspipeline_20: 'Seguimiento de estado, gestión del lifecycle',
      tip_c_agentspipeline_21: 'premortem-agent',
      tip_c_agentspipeline_22: 'Identificación de riesgos, predicción de fallos',
      tip_c_agentspipeline_23: 'maintenance-agent',
      tip_c_agentspipeline_24: 'Limpieza, optimización, monitoreo de salud',
      tip_c_agentspipeline_25: 'self-diag-agent',
      tip_c_agentspipeline_26: 'Auto-debug y recuperación break-glass',
      tip_c_agentspipeline_27: 'sia-agent',
      tip_c_agentspipeline_28: 'Agente auto-mejorable, refinamiento iterativo',
      tip_c_agentspipeline_29: 'gitflow-agent',
      tip_c_agentspipeline_30: 'Gestión de ramas, automatización de PRs',
      tip_c_agentspipeline_31: 'knowledge-agent',
      tip_c_agentspipeline_32: 'Operaciones de knowledge base, gestión del vault',
      tip_c_agentspipeline_33: 'explore',
      tip_c_agentspipeline_34: 'Exploración rápida del codebase',
      tip_c_agentspipeline_35: 'general',
      tip_c_agentspipeline_36: 'Investigación y tareas de múltiples pasos',
      tip_c_agentspipeline_4: 'Enruta, coordina, lifecycle de sesión',
      tip_c_agentspipeline_5: 'sdd-explore',
      tip_c_agentspipeline_6: 'Recopilación de requisitos, análisis y aclaración',
      tip_c_agentspipeline_7: 'sdd-design',
      tip_c_agentspipeline_8: 'Diseño de sistemas, contratos de API, arquitectura',
      tip_c_agentspipeline_9: 'sdd-apply',
      tip_c_health_10: 'Archivos de configuración, salud del bridge, estado del MCP',
      tip_c_health_11: 'Directorio de sesión, manifiesto, configuración del pipeline',
      tip_c_health_12: 'Git hooks: pre-commit, post-commit, post-merge',
      tip_c_health_13: 'JSON schemas, 5 configs, validador JSON',
      tip_c_health_14: 'Clinerules, cursorrules, configuración de continue',
      tip_c_health_15: 'Estructura de Opencode, configuración de auth, orquestador de seguridad',
      tip_c_health_16: 'Hybrid executor, delegadores AWS/Azure',
      tip_c_health_17: 'Spans de tracing, exportación OTLP, archivos de spans',
      tip_c_health_18: 'Directorio de checkpoints, snapshots, preparación para rollback',
      tip_c_health_19:
        'Archivo de Nexus DB, WAL, comprobación de integridad, 7 migrations, 21 tables',
      tip_c_health_20: 'Model router, perfiles, configuración de fallback',
      tip_c_health_21: 'Logs de auditoría, pipeline, archivo',
      tip_c_health_22: 'Archivos de políticas, directorio de reglas, 60 normativas',
      tip_c_health_27: 'Inicializar DB + ejecutar todas las migrations',
      tip_c_health_28: 'Health check: integridad, WAL, tables, rows',
      tip_c_health_29: 'Backup online seguro en .runtime/backups/',
      tip_c_health_30: 'WAL checkpoint + REINDEX + VACUUM',
      tip_c_health_31: 'Eliminar datos antiguos de las stack tables',
      tip_c_health_32: 'Mostrar estadísticas del backlog por estado/severidad/tipo',
      tip_c_health_33: 'Listar elementos del backlog con filtros',
      tip_c_health_34: 'Generar informe markdown',
      tip_c_health_36: 'dev, po, qa, ux, ops, sec, any',
      tip_c_health_37: 'critical, high, medium, low',
      tip_c_health_38: '1-5 numérico',
      tip_c_health_39: 'Tiempo estimado de resolución',
      tip_c_health_40: 'blocking, major, minor, cosmetic',
      tip_c_health_41: 'Versión/release objetivo',
      tip_c_health_42: 'dev, staging, prod, all',
      tip_c_health_43: 'open, in_progress, resolved, wont_fix, backlog, duplicate',
      tip_c_health_44: 'Comentarios',
      tip_c_health_45: 'Hilo de discusión por elemento',
      tip_c_health_46: 'Historial de estados',
      tip_c_health_47: 'Registro de auditoría completo de los cambios de estado',
      tip_c_health_48: 'Elementos relacionados',
      tip_c_health_49: 'duplicates, blocked_by, supersedes, child_of',
      tip_c_health_5: 'Servidor WS del Dashboard, API 200, PID del watchdog',
      tip_c_health_50: 'Etiquetas',
      tip_c_health_51: 'Categorización multi-etiqueta',
      tip_c_health_52: 'Enlace de sesión',
      tip_c_health_53: 'Trazabilidad hasta la sesión donde se encontró/corrigió',
      tip_c_health_54: 'Buscar',
      tip_c_health_55: 'Encontrar elementos similares para evitar duplicados',
      tip_c_health_56: 'Auto-prune',
      tip_c_health_57: 'Eliminar elementos resueltos antiguos (TTL configurable)',
      tip_c_health_6: 'Índice existente, 677 archivos, 10,663 nodos, 21,746 aristas, 28MB',
      tip_c_health_7: 'Daemon de timeout, PIDs del watchdog, protección contra bucles de reinicio',
      tip_c_health_8: 'Índice ML, archivos de embeddings, skill embeddings',
      tip_c_health_9: 'Integridad de la DB, log de reindexación, pipeline RAG, 2078 obs',
      tip_c_operationscloud_10: 'Verificar la sintaxis del workflow de CI/CD',
      tip_c_operationscloud_11: 'Integridad de los scripts de research',
      tip_c_operationscloud_12: 'Health check de la base de datos Nexus',
      tip_c_operationscloud_13: 'Copia de seguridad online segura',
      tip_c_operationscloud_14: 'Chequeo completo de mantenimiento',
      tip_c_operationscloud_9: 'Validar esquemas JSON',
      tip_c_quickstart_11: 'Ejecutar todas las suites de tests',
      tip_c_quickstart_12: 'Ejecutar health checks',
      tip_c_quickstart_13: 'Comprobar auto-aplicaciones pendientes',
      tip_c_quickstart_14: 'Health check de la base de datos',
      tip_c_quickstart_15: 'Consulta del knowledge graph',
      tip_c_quickstart_16: 'Compilar el dashboard',
      tip_c_quickstart_18: 'Iniciar el dashboard completo (Vite dev + proxy WS)',
      tip_c_quickstart_19: 'Iniciar solo el servidor WS (WebSocket + API HTTP)',
      tip_c_quickstart_20: 'Compilar el bundle de producción del dashboard',
      tip_c_quickstart_22: 'Inicializar la DB + ejecutar todas las migraciones (idempotente)',
      tip_c_quickstart_23: 'Health check — integridad, WAL, tablas, filas',
      tip_c_quickstart_24: 'Purgar datos antiguos (eventos &gt;30d, caché &gt;7d, tokens &gt;90d)',
      tip_c_quickstart_25: 'Checkpoint WAL + REINDEX + VACUUM',
      tip_c_securitygovernance_12: 'Añadir entrada al JSONL diario',
      tip_c_securitygovernance_13: 'Estado de auditoría actual',
      tip_c_securitygovernance_14: 'Buscar entradas de auditoría',
      tip_c_securitygovernance_15: 'Rotar registros antiguos al archivo',
      tip_c_securitygovernance_16: 'Eliminar entradas caducadas',
      tip_c_securitygovernance_54: 'AI-NORMATIVES.md',
      tip_c_securitygovernance_55: 'Reglas centrales de comportamiento de IA &amp; pautas éticas',
      tip_c_securitygovernance_56: 'NORMATIVAS-ARCHITECTURE.md',
      tip_c_securitygovernance_57: 'Restricciones de diseño del sistema &amp; patrones',
      tip_c_securitygovernance_58: 'Arquitectura',
      tip_c_securitygovernance_59: 'NORMATIVAS-SECURITY-COMPLIANCE.md',
      tip_c_securitygovernance_60: 'Endurecimiento de seguridad &amp; cumplimiento',
      tip_c_securitygovernance_61: 'Seguridad',
      tip_c_securitygovernance_62: 'NORMATIVAS-CODE-QUALITY.md',
      tip_c_securitygovernance_63: 'Compuertas de revisión de código &amp; umbrales de calidad',
      tip_c_securitygovernance_64: 'Calidad',
      tip_c_securitygovernance_65: 'NORMATIVAS-WORKFLOW.md',
      tip_c_securitygovernance_66: 'Flujos de trabajo operativos &amp; secuencias',
      tip_c_securitygovernance_67: 'Workflow',
      tip_c_securitygovernance_68: 'NORMATIVAS-OPS-DEVOPS.md',
      tip_c_securitygovernance_69: 'Reglas de CI/CD, despliegue e infraestructura',
      tip_c_securitygovernance_70: 'DevOps',
      tip_c_securitygovernance_71: 'NORMATIVAS-AUTONOMOUS-EVOLUTION.md',
      tip_c_securitygovernance_72: 'Auto-evolución &amp; promoción de normas',
      tip_c_securitygovernance_73: 'Autonomía',
      tip_c_securitygovernance_74: 'NORMATIVAS-EVAL-QUALITY.md',
      tip_c_securitygovernance_75: 'Compuertas de evaluación &amp; valoración',
      tip_c_securitygovernance_77: 'NORMATIVAS-MULTI-TENANT.md',
      tip_c_securitygovernance_78: 'Aislamiento de tenant &amp; límites de recursos',
      tip_c_securitygovernance_79: 'Multi-Tenant',
      tip_c_securitygovernance_80: 'NORMATIVAS-PERFORMANCE.md',
      tip_c_securitygovernance_81: 'Presupuestos de rendimiento &amp; SLAs',
      tip_c_securitygovernance_82: 'Rendimiento',
      tip_c_securitygovernance_83: 'NORMATIVAS-ENFORCEMENT.md',
      tip_c_securitygovernance_84: 'Mecanismos de aplicación &amp; escalado',
      tip_c_securitygovernance_85: 'Gobernanza',
      tip_c_securitygovernance_86: 'HUMAN-IN-THE-LOOP.md',
      tip_c_securitygovernance_87: 'Supervisión humana &amp; compuertas de aprobación',
      tip_c_securitygovernance_89: 'INCIDENT-RESPONSE.md',
      tip_c_securitygovernance_90: 'Gestión de incidentes &amp; recuperación',
      tip_c_securitygovernance_92: 'SECRETS-MANAGEMENT.md',
      tip_c_securitygovernance_93: 'Gestión de secretos &amp; rotación',
      tip_c_securitygovernance_95: 'COST-ATTRIBUTION.md',
      tip_c_securitygovernance_96: 'Seguimiento de costos &amp; atribución',
      tip_c_securitygovernance_97: 'Finanzas',
      tip_fm_55:
        '11 repositorios en total: 10 DAOs + MigrationRunner. El MigrationRunner aplica las migraciones de esquema en orden con FK ON y modo WAL.',
      tip_fm_56:
        '7 migraciones de esquema crean 21 tablas. Migración 001 = esquema inicial, 002 = tablas del stack, 003 = session scoring, aplicadas automáticamente por DatabaseManager al inicio de sesión.',
      tip_fm_57:
        'Diseño desacoplado de 6 capas: Tools -> Agents -> Pipeline -> Memory -> Data -> Executive.',
      tip_fm_58:
        '31 pasos Phase-1 se ejecutan en paralelo al inicio de sesión usando Promise.allSettled. No bloqueante e idempotente.',
      tip_fm_59:
        '70 tareas lazy en background se encolan en batches tras el inicio de sesión (delay de batch 500ms -> 100ms).',
      tip_fm_60:
        'Todas las tareas de batch usan Promise.allSettled para que un solo fallo nunca bloquee el pipeline.',
      tip_fm_61:
        'Motor ejecutivo: trigger -> apply -> verify -> rollback. Máx. 5 auto-aplicaciones/día, rollback si degradación >15%.',
      tip_fm_62: 'Patrón de 3 estados CLOSED/OPEN/HALF_OPEN. 5 fallos -> OPEN, 2 éxitos -> CLOSED.',
      tip_fm_63:
        'Escalación de 3 niveles: warning(3) -> critical(5) -> emergency(10) con auditoría + findings ledger.',
      tip_fm_64:
        'Descubre automáticamente las relaciones entre componentes desde la config del pipeline. Sin mapa hardcoded.',
      tip_fm_65:
        'createExperiment -> assign -> evaluate con rollback automático ante degradación estadística.',
      tip_fm_66:
        'Scoring de calidad por sesión que rastrea delegaciones, correcciones y aciertos proactivos. Detección de anomalías.',
      tip_fm_67:
        'Descubre automáticamente patrones en las ejecuciones y escribe LEARNED-NORMS.md. Evolución adaptativa.',
      tip_fm_68:
        'Memoria persistente Engram: 2078 observaciones, auto-sync entre sesiones y proyectos.',
      tip_fm_69:
        'Grafo de conocimiento CodeGraph: 10.663 nodos y 21.746 aristas derivadas del análisis AST.',
      tip_fm_70:
        'Grafo de conocimiento Graphify de 18MB con god nodes, estructura de comunidades y relaciones entre archivos.',
      tip_fm_71:
        'BD operacional Nexus: SQLite modo WAL, 21 tablas, auto-init, auto-prune, auto-backup y monitoreo del watchtower.',
      tip_fm_72:
        'Índice vectorial ML Embeddings para búsqueda semántica sobre skills, normas y documentación.',
      tip_fm_73:
        'Escaneo pre-input, pipeline de auditoría, enforcement de políticas y guardrails antes de cada prompt.',
      tip_fm_74:
        'Logs de auditoría JSONL con acciones log/status/query/archive/prune bajo .session/audit/logs/.',
      tip_fm_75:
        'Políticas de governance + enforcement de reglas en los 21 componentes del watchtower.',
      tip_fm_76:
        'Guardrails: validación pre-input que rechaza prompts inseguros antes de que lleguen al modelo.',
      tip_fm_77: '60 normativas que cubren reglas y políticas para la operación autónoma.',
      tip_fm_78:
        'Push WebSocket al dashboard cada 5 segundos con métricas reales calculadas desde traces.',
      tip_fm_79:
        'El fallback HTTP polling mantiene el dashboard vivo incluso si el servidor WS cae temporalmente.',
      tip_fm_80:
        '7 secciones del dashboard: overview, metrics, tracing, alerts, feedback, i18n e info popups.',
      tip_fm_81:
        'Traducción completa de la UI en inglés, español y portugués brasileño (14 descripciones de métricas).',
      tip_fm_82:
        '8 reglas de alerta auto-evaluadas cada ciclo de broadcast con estado ok/degraded/fail.',
      tip_fm_83: '6 jobs CI + 3 jobs de seguridad (gitleaks, secretlint, trivy) en cada push.',
      tip_fm_84:
        'Routing híbrido AWS/Azure por costo, latencia y carga con fallback de circuit breaker.',
      tip_fm_85:
        'Tracing distribuido basado en spans con exportación OTLP. Spans JSONL bajo .telemetry/.',
      tip_fm_86:
        'Checkpoints, snapshots y rollback con validación dry-run. Auto-creación al inicio de sesión.',
      tip_fm_87:
        'Event store append-only + saga orchestrator con pasos de compensación para consistencia.',
      tip_fm_88: '97 archivos de test en 12 suites que cubren units, configs, workflows y CI/CD.',
      tip_fm_89: '95 health checks en 21 componentes. Todo verde: 95/95 PASS, 0 WARN, 0 FAIL.',
      tip_fm_90:
        'Code review multi-eje: correctness, readability, architecture, security y performance.',
      tip_fm_91: 'Guías Karpathy: Think First, Simplicity, Surgical Changes, Goal-Driven.',
      tip_fm_92:
        'Workflow SDD: explore -> design -> apply -> verify con contratos formales de entrada/salida.',
      tip_auto_loop:
        'Detección → Evaluación → Decisión → Ejecución → Verificación → Aprendizaje. Lee 3 fuentes de disparo: predictive-governor (presupuesto), skill-evolution (deprecación) y auto-norm-learner (normas). Auto-apply safe con rollback si degradación >15%.',
      tip_auto_safety:
        'Envoltura de salud y seguridad: 95/95 checks PASS en 21 componentes, circuit breaker (5 fallos → OPEN, 2 éxitos → CLOSED), auto-escalación de 3 niveles (3→5→10), auto-rollback y umbral mínimo de aplicación del 80% de confianza.',
      tip_cacherepo:
        'response_cache + semantic cache — clave SHA256 → respuesta con TTL y tracking de hit_count; el cache semántico añade búsqueda por similitud de embeddings.',
      tip_contractrepo:
        'contract_results — persistencia de la validación de contratos SDD (Spec-Driven Development): contratos de entrada/salida evaluados por delegación.',
      tip_errormemrepo:
        'error_memory + embeddings — tracking de bugs con búsqueda vectorial para que errores pasados y sus soluciones sean recuperables por similitud semántica.',
      tip_eventrepo:
        'events + alerts — event sourcing append-only con cadena de hash SHA-256 (a prueba de manipulación) más las 8 reglas de alerta evaluadas en un ciclo de broadcast de 5s.',
      tip_exe_abtest:
        'Testing A/B estadístico: createExperiment → assign → evaluate. Auto-rollback cuando la variante ganadora muestra degradación estadística frente al control.',
      tip_exe_autoapply:
        'Motor ejecutivo: trigger→apply→verify→rollback con un tope de seguridad de 5 auto-aplicaciones diarias. Cualquier cambio que degrade el rendimiento más del 15% se revierte automáticamente.',
      tip_exe_circuit:
        'Patrón de 3 estados CLOSED/OPEN/HALF_OPEN: 5 fallos consecutivos abren el circuito, 2 éxitos lo mueven a HALF_OPEN y luego CLOSED. Previene fallos en cascada en llamadas cloud y pipeline.',
      tip_exe_cloud:
        'Ejecutor híbrido AWS/Azure con routing por costo, latencia y carga con fallback automático. Circuit breaker: 5 fallos → OPEN, 2 éxitos → HALF_OPEN → CLOSED.',
      tip_exe_depgraph:
        'Descubre automáticamente las relaciones entre componentes leyendo la configuración del pipeline — sin mapa de dependencias hardcoded. El grafo se mantiene correcto al añadir o quitar pasos.',
      tip_exe_escalation:
        'Escalación de 3 niveles: warning (3 fallos) → critical (5) → emergency (10). Cada escalación escribe un registro de auditoría completo en el findings ledger.',
      tip_exe_norms:
        'Descubre automáticamente patrones recurrentes en las ejecuciones y los escribe en LEARNED-NORMS.md — el stack evoluciona sus propias reglas con el tiempo.',
      tip_exe_scoring:
        'Scoring de calidad por sesión que rastrea delegaciones, correcciones y aciertos proactivos. Compara puntuaciones automáticamente y alerta sobre regresión >15% o anomalías.',
      tip_exe_security:
        'Escaneo pre-input de cada prompt, pipeline de auditoría (logs JSONL con query/archive/prune), enforcement de políticas y guardrails. Regido por 60+ normativas.',
      tip_exe_state:
        'Checkpoint, snapshot y rollback con validación dry-run. Los checkpoints se crean automáticamente al inicio de sesión; el rollback restaura el estado de forma segura desde el último checkpoint bueno.',
      tip_exe_tracing:
        'Tracing distribuido basado en spans con exportación OTLP a http://localhost:4318/v1/traces. Los spans se persisten como JSONL en .telemetry/spans/ y .telemetry/traces/.',
      tip_exe_watchtower:
        'Orquestador central de salud: 95 checks en 21 componentes ejecutados con paralelismo Promise.allSettled. Modos: health, rebuild, autoheal, report, continuous, all.',
      tip_housekeepingrepo:
        'pruneAll, housekeeping, vacuum — checkpoint WAL automático cuando >1MB, poda por retención y optimización de BD (REINDEX, VACUUM).',
      tip_met_health:
        '95/95 checks PASS en 21 componentes: dashboard-ws, codegraph, ml-embeddings, engram, mcp, session, hooks, configs, tool-configs, security, cloud-connectors, tracing, state-persistence, audit, governance y gentle-vanguard-db. Medidos por el maintenance watchtower.',
      tip_met_perf:
        'Indicadores clave de rendimiento: los checks del watchtower pasaron de secuencial a paralelo, el delay de batches lazy se optimizó de 500ms → 100ms (5x más rápido), el DB Manager se refactorizó de 1066 → 250 líneas (-77%) y la autonomía subió del 73% al 100%.',
      tip_metricsrepo:
        'CRUD de metric_snapshots — series temporales de tokens, latencia y salud muestreadas cada 30s. Alimenta las gráficas del dashboard en tiempo real y el análisis de tendencias.',
      tip_nexus_arch:
        'Nexus es el cerebro operacional: SQLite en modo WAL con FK ON. 11 repositorios (10 DAOs + MigrationRunner), 7 migraciones (m001 esquema inicial, m002 tablas del stack, m003 session scoring, …) y 21 tablas. Cada componente persiste su estado vivo en archivos .state.json bajo .session/context-log/. Auto-init, auto-prune, auto-backup y monitoreo del watchtower (componente gentle-vanguard-db).',
      tip_sessionrepo:
        'sessions + session_scoring — upsert por session_id, consultas de sesiones activas y scoring de calidad por sesión (delegaciones, correcciones, aciertos proactivos).',
      tip_sk_analysis:
        'idea-refine, doubt-driven-dev, premortem, socratic-skill, interview-me y source-driven — marcos de pensamiento que ponen a prueba las ideas antes de ejecutar.',
      tip_sk_arch:
        'El pipeline SDD: sdd-explore (BA), sdd-design (SAD), sdd-apply (DEV) y sdd-verify (QA) más systems-thinking y api-interface — desarrollo guiado por especificación, de la idea al código verificado.',
      tip_sk_auto:
        'Skills que impulsan la autogestión: auto-apply-safe, circuit-breaker, auto-escalation, session-scoring, predictive-governor y auto-norm-learner — el cerebro ejecutivo del stack.',
      tip_sk_dev:
        'typescript-skill, testing-skill, testing-coverage, technical-debt, code-review y shellcheck — compuertas de calidad de código aplicadas antes de que cada cambio llegue.',
      tip_sk_docs:
        'doc-agent, writing-plans, write-spec, visual-content, documentation y standup-skill — producen y mantienen documentación de alta calidad de forma nativa.',
      tip_sk_infra:
        'ci-cd-automation, observability, performance-opt, cloud-connectors, NORMATIVAS-OPS y SELF-HEALING-CI — la capa operativa que mantiene el stack funcionando.',
      tip_sk_quality:
        'testing-evidence, eval-gates, CI-HARDENING, Karpathy, HALLUCINATION y SDD-STRICT-TDD — compuertas basadas en evidencia que bloquean salida de baja calidad.',
      tip_sk_sec:
        'Security skill, security-audit, governance-agent, AI-NORMATIVES, SECRETS-MGMT e INCIDENT-RESPONSE — aplican políticas y guardrails en cada prompt.',
      tip_sk_tooling:
        'start-skill, workflow-orch, session-workflow, task-mgmt, semantic-matcher y skill-creator — las meta-skills que gestionan cómo se usan todas las demás.',
      tip_skillrepo:
        'skill_usage, token_usage, routing_rules — tracking de uso de skills por sesión, contabilidad real de tokens con columna total_tokens generada y persistencia del router adaptativo con hit_count.',
      tip_tracerepo:
        'traces + feedback — spans de tracing distribuido con vista waterfall, estadísticas de latencia y pulgar arriba/abajo por span desde el dashboard de observabilidad.',
      // Dashboard tips (ES)
      tip_dashboard_websocket:
        'Actualizaciones WebSocket en tiempo real cada 5 segundos con fallback HTTP.',
      tip_dashboard_sections:
        '7 secciones del dashboard: Métricas, Trazas, Alertas, Scoring, Waterfall, Feedback e Info.',
      tip_dashboard_alerts:
        '8 reglas de alerta configurables que monitorean uso de tokens, salud y rendimiento.',
      tip_dashboard_i18n:
        'Soporte de internacionalización: Español, Inglés y Portugués con detección automática.',

      // Patterns tips (ES)
      tip_patterns_karpathy:
        'Guías Karpathy: Think First, Simplicity, Surgical Changes, Goal-Driven — rúbricas de calidad.',
      tip_patterns_sdd: 'Ciclo SDD: Explore → Design → Apply → Verify con umbrales de confianza.',
      tip_patterns_slop:
        'Detección AI Slop: compuertas automáticas para prevenir contenido genérico de IA.',
      tip_patterns_arch:
        '10 patrones arquitectónicos: Layered, Event-Driven, CQRS, Circuit Breaker, Saga, etc.',
      tip_patterns_standards:
        'Estándares de desarrollo: convenciones de código, documentación y compuertas de revisión.',
      tip_patterns_docs:
        'Reducción de carga cognitiva y revelación progresiva en documentación técnica.',
    },
    'pt-BR': {
      nav_home: 'Início',
      nav_arch: 'Arq',
      nav_autonomy: 'Autonomia',
      nav_dashboard: 'Dashboard',
      nav_quickstart: 'Início Rápido',
      nav_memory: 'Memória',
      nav_security: 'Segurança',
      nav_agents: 'Agentes',
      nav_cloud: 'Nuvem',
      nav_patterns: 'Padrões',
      nav_health: 'Saúde',
      nav_diagrams: 'Diagramas',
      /* Títulos de sección — index */
      sec_architecture: 'Arquitetura do Sistema',
      sec_components: 'Componentes da Stack',
      sec_autonomous: 'Sistemas Autônomos',
      sec_data_layer: 'Camada de Dados — 11 Repos',
      sec_executive: 'Sistemas Executivos',
      sec_feature_matrix: 'Matriz de Funcionalidades',
      sec_skills_rules: 'Explorador de Skills e Regras',
      sec_stack_metrics: 'Métricas da Stack',
      sec_the_book: 'O Livro',
      sec_diagrams: 'Diagramas e Visualizações',
      sec_tools: 'Ecossistema de Ferramentas',
      /* Títulos de sección — architecture */
      sec_arch_layers: 'Arquitetura do Sistema',
      sec_daos: 'Objetos de Acesso a Dados',
      sec_pipeline: 'Pipeline de Sessão',
      sec_performance: 'Otimizações de Desempenho',
      /* Títulos de sección — agents-pipeline */
      sec_agent_eco: 'Ecossistema de Agentes',
      sec_routing: 'Regras de Roteamento',
      sec_lifecycle: 'Ciclo de Vida da Sessão',
      sec_delegation: 'Modelo de Delegação',
      sec_skills_system: 'Sistema de Skills',
      /* Títulos de sección — quickstart */
      sec_prereq: 'Pré-requisitos',
      sec_setup: 'Instalação em um Comando',
      sec_daily: 'Comandos Diários',
      sec_dash_cmds: 'Comandos do Dashboard',
      sec_db_cmds: 'Comandos de Banco de Dados',
      sec_workflow: 'Fluxo de Desenvolvimento',
      sec_arch_overview: 'Visão Geral da Arquitetura',
      sec_troubleshoot: 'Solução de Problemas',
      sec_references: 'Links de Referência',
      /* Títulos de sección — memory-knowledge */
      sec_mem_stack: 'A Stack de Memória',
      sec_engram: 'Engram — Memória Persistente',
      sec_codegraph: 'CodeGraph — Inteligência de Símbolos',
      sec_graphify: 'Graphify — Grafo de Conhecimento',
      sec_nexus: 'Nexus DB — Banco de Dados Operacional',
      sec_mem_daos: 'Objetos de Acesso a Dados',
      sec_ml_emb: 'Embeddings ML',
      sec_kb_manager: 'Gerenciador de Base de Conhecimento',
      sec_data_flow: 'Diagrama de Fluxo de Dados',
      /* Títulos de sección — security-governance */
      sec_sec_orch: 'Orquestador de Segurança',
      sec_audit: 'Pipeline de Auditoria',
      sec_normatives: 'Sistema de Normativas',
      sec_guardrails: 'Guardrails e Políticas',
      sec_governance: 'Framework de Governança',
      sec_compliance: 'Verificações de Conformidade',
      sec_hardening: 'Endurecimento de Segurança',
      sec_standards: 'Resumo de Padrões',
      /* Hero */
      hero_subtitle: 'Plataforma Autônoma de Orquestração de IA — 100% Autônoma',
      /* Títulos — health */
      sec_health_dash: 'Painel de Saúde',
      sec_perf_slos: 'SLOs de Desempenho',
      /* Títulos — operations-cloud */
      sec_ci_cd: 'Pipeline CI/CD',
      sec_security_wf: 'Fluxo de Segurança',
      sec_cloud_conn: 'Conectores Cloud',
      sec_cb_states: 'Estados do Circuit Breaker',
      sec_tracing: 'Rastreamento Distribuído',
      sec_state_persist: 'Persistência de Estado',
      sec_event_saga: 'Event Sourcing + Saga',
      sec_health_api: 'API de Saúde',
      sec_testing_infra: 'Infraestrutura de Testes',
      sec_ops_cmds: 'Comandos de Operações',
      sec_pipe_integ: 'Integração de Pipeline',
      /* Info tips (modal da "i") */
      info_kicker: 'Mais informações',
      info_title: 'Sobre este recurso',
      info_hint: 'Pressione ESC ou clique fora para fechar',
      lbox_hint_wheel: 'Role para zoom',
      lbox_hint_drag: 'Arraste para mover',
      lbox_hint_dbl: 'Clique duplo para alternar',
      tip_pipeline:
        'Autostart de sessão: 31 passos Phase-1 em paralelo + 70 passos lazy em background lançados em lotes de 5. Inclui detecção de ferramentas, orçamento de tokens, guias Karpathy, sync de codegraph, orquestração de segurança e init de BD.',
      tip_engram:
        'Memória persistente com sincronização automática, checks de integridade SHA256 e compactação. Atualmente com 2.078 observações em 369 sessões. Sobrevive entre sessões e compactações.',
      tip_codegraph:
        'Grafo de conhecimento SQLite para inteligência de símbolos. 10.663 nós e 21.746 arestas em 677 arquivos com consultas de símbolos em menos de um milissegundo.',
      tip_dashboard:
        'SPA de observabilidade React + TypeScript + Vite. WebSocket com atualizações em tempo real a cada 5s com fallback de polling HTTP, 7 seções do dashboard, i18n em 3 idiomas e 8 regras de alerta.',
      tip_circuit:
        'Circuit breaker de 3 estados (CLOSED / OPEN / HALF_OPEN). 5 falhas abrem o circuito, 2 sucessos o recuperam. Previne falhas em cascata em toda a stack.',
      tip_autoapply:
        'Motor executivo que segue trigger → avaliar (confiança ≥80%) → aplicar → verificar → rollback. Máximo 5 auto-aplicações por dia com rollback se a degradação ultrapassar 15%.',
      tip_depgraph:
        'Descobre dinamicamente as relações entre componentes a partir da config do pipeline, substituindo o mapa de dependências hardcoded. Arquitetura auto-mantida.',
      tip_escalation:
        'Escalação de 3 níveis: aviso (3 falhas) → crítico (5) → emergência (10). Cada escalação fica registrada com rastreabilidade completa no ledger de descobertas.',
      tip_abtest:
        'Framework estatístico de A/B testing: createExperiment, assignVariant, evaluateExperiment com rollback automático diante de degradação estatística.',
      tip_scoring:
        'Scoring de qualidade por sessão que rastreia delegações, correções e acertos proativos. Comparação automática, detecção de regressão acima de 15% e alertas de anomalias.',
      tip_watchtower:
        'Orquestrador central de saúde: 95 checks em 21 componentes com execução paralela Promise.allSettled e modos de auto-healing (health, rebuild, autoheal, report, continuous).',
      tip_nexus:
        'Banco de dados operacional SQLite (modo WAL, FK ON) com 11 repositórios, 7 migrações e 21 tabelas. Auto-init, auto-prune, auto-backup e monitoramento por watchtower.',
      tip_layers:
        'A stack se organiza em 6 camadas: Tools (10 IDEs) → Agents (21 especializados) → Pipeline (101 passos habilitados) → Memória e Conhecimento → Dados (11 repos) → Sistemas executivos.',
      section_overview: 'Visão Geral',
      section_architecture: 'Arquitetura',
      section_metrics: 'Métricas',
      section_quickstart: 'Início Rápido',
      section_security: 'Segurança e Governança',
      section_operations: 'Operações',
      section_patterns: 'Padrões e Convenções',
      section_memory: 'Memória e Conhecimento',
      section_agents: 'Agentes e Pipeline',
      section_autonomy: 'Níveis de Autonomia',
      section_dashboard: 'Dashboard',
      theme_dark: 'Escuro',
      theme_light: 'Claro',
      lang_en: 'English',
      lang_es: 'Español',
      lang_pt: 'Português',
      footer_all_rights: 'Todos os direitos reservados.',
      footer_built_with: 'Construído com',
      see_docs: 'Ver Documentação',
      view_on_github: 'Ver no GitHub',
      coming_soon: 'Em breve',
      loading: 'Carregando...',
      error: 'Erro',
      search: 'Pesquisar...',
      no_results: 'Nenhum resultado.',
      back_to_top: 'Voltar ao topo',
      copy: 'Copiar',
      copied: 'Copiado!',
      close: 'Fechar',
      save: 'Salvar',
      cancel: 'Cancelar',
      delete: 'Excluir',
      edit: 'Editar',
      create: 'Criar',
      update: 'Atualizar',
      refresh: 'Atualizar',
      download: 'Baixar',
      upload: 'Enviar',
      filter: 'Filtrar',
      sort: 'Ordenar',
      status_ok: 'Operacional',
      status_warn: 'Aviso',
      status_error: 'Erro',
      status_unknown: 'Desconhecido',

      tip_hs_dash_backend:
        'Backend Server: real-data.ts calcula métricas a partir dos state files; WebSocket Server envia a cada 5s na porta 8080.',
      tip_hs_dash_fallback:
        'HTTP Polling Fallback: useMetrics.ts sempre faz polling HTTP, então os dados carregam mesmo se o servidor WebSocket estiver fora.',
      tip_hs_dash_frontend:
        'Frontend - React/Vite: 7 seções (Metrics, Traces, Alerts, Feedback, Scoring, Waterfall, Info Popup) com i18n.',
      tip_hs_dash_sources:
        'Data Sources: dados de rastros reais lidos de .session/context-log/*.state.json e *.meta.json - sem dados simulados.',
      tip_hs_dash_watchdog:
        'Watchdog Auto-Recovery: monitora :8080 a cada 5s, reinicia até 10 vezes e mata o watchdog primeiro para evitar loops.',
      tip_hs_data_nexus:
        'NEXUS DB: banco operacional SQLite (gentle-vanguard.db) com modo WAL, FK ON, 12 tabelas e 3 migrações.',
      tip_hs_data_repos_blue:
        'DAOs de dados (azul): MetricsRepo (metric_snapshots), SessionRepo (sessions) e TraceRepo (traces) - séries temporais e histórico de sessões.',
      tip_hs_data_repos_green:
        'DAOs de qualidade (verde): CacheRepo (response_cache) e EventRepo (events) - cache e auditoria de event sourcing.',
      tip_hs_data_repos_orange:
        'DAOs de ops (laranja): HousekeepingRepo (token_usage) e MigrationRunner (7 migrações) - manutenção e evolução de esquema.',
      tip_hs_data_repos_purple:
        'DAOs de memória (roxo): SkillRepo (skill_usage), ContractRepo (contract_results) e ErrMemoryRepo (scoring) - uso e pontuação.',
      tip_hs_flow_karpathy:
        'Karpathy Guidelines: 3 regras (Think First, Simplicity, Surgical Changes) com rubricas de qualidade e autocrítica.',
      tip_hs_flow_lazy_batch:
        'Lazy Batch - 5 workers em background: executa etapas adiadas como Tracing Init, Cloud Connectors, Event Sourcing, Audit Pipeline e Dashboard WS.',
      tip_hs_flow_phase1:
        'Fase 1 - 31 etapas paralelas: inicializadores rápidos e independentes que rodam em concorrência e nunca bloqueiam ante falhas.',
      tip_hs_flow_phase2:
        'Fase 2 - 70 etapas lazy background: trabalho pesado adiado executado em lotes de 5 workers após o início da sessão.',
      tip_hs_flow_process_bar:
        'Barra de processo: etapas paralelas (31), depois lazy background (70) e DONE - o pipeline completo de 101 etapas.',
      tip_hs_flow_session_manager:
        'Session Manager: gera o ID da sessão, sincroniza o Engram e rastreia o ciclo de vida da sessão.',
      tip_hs_flow_token_budget:
        'Token Budget: aloca o orçamento de 5M diário / 3M por sessão e aplica os limiares de guarda.',
      tip_hs_flow_tool_detection:
        'Tool Detection: mapeia as 8 ferramentas disponíveis (Bash, Read, Write, Edit, Grep, Glob, Task, Skill).',
      tip_hs_loop_auto_escalation:
        'Guard rail - Auto-Escalation: promove problemas não resolvidos a uma autoridade superior (orquestador ou humano).',
      tip_hs_loop_autoapply:
        'Auto-Apply SAFE: o portão central de verificação - as mudanças só são aplicadas quando passam em todas as verificações de segurança.',
      tip_hs_loop_circuit_breaker:
        'Guard rail - Circuit Breaker: abre após falhas repetidas para interromper erros em cascata e pausa o ciclo.',
      tip_hs_loop_decision:
        'Fase 3 - Decisão: escolhe a ação vencedora com limiares de confiança; escala quando a incerteza é alta.',
      tip_hs_loop_detection:
        'Fase 1 - Detecção: identifica anomalias, novas sinalizações ou eventos de degradação no ambiente, saídas de ferramentas e rastros de sessão.',
      tip_hs_loop_evaluation:
        'Fase 2 - Avaliação: pontua cada ação candidata segundo rubricas de qualidade, custo e risco antes de decidir.',
      tip_hs_loop_execution:
        'Fase 4 - Execução: aplica a ação selecionada através do portão seguro auto-apply, rastreando cada mutação.',
      tip_hs_loop_learning:
        'Fase 6 - Aprendizado: registra os resultados no Engram e na tabela de roteamento, melhorando decisões futuras.',
      tip_hs_loop_norms_learner:
        'Guard rail - Norms Learner: aprende as convenções do projeto e as injeta como normas adaptativas em novas sessões.',
      tip_hs_loop_session_scoring:
        'Guard rail - Session Scoring: pontua cada sessão (delegações, correções, acertos proativos) e alimenta a tabela de roteamento.',
      tip_hs_loop_verification:
        'Fase 5 - Verificação: executa typecheck, lint e testes; se a verificação falhar, a ação é revertida.',
      tip_hs_agents:
        'Agents - 21 subagentes especializados: Orchestrator, SDD (explore/design/apply/verify), Doc, Ops, Gov, Session, Premortem, Maintenance, Self-Diag, SIA, GitFlow, Knowledge + business (Mkt, Sales, Finance, HR, Legal, Bus-Tele).',
      tip_hs_data:
        'Data Layer - Banco Nexus SQLite com 11 repositórios (10 DAOs + MigrationRunner), 7 migrações e 21 tabelas. Modo WAL e FK ON habilitados.',
      tip_hs_executive:
        'Executive Systems - 12 subsistemas autônomos: Auto-Apply Safe, Circuit Breaker, Auto-Escalation, Dynamic Dependency Graph, AB Testing, Session Scoring, Norms Learner, Watchtower, Security Orchestrator, State Persistence, Distributed Tracing, Cloud Connectors',
      tip_hs_memory:
        'Memory Layer - Engram (2078 observações), CodeGraph (10.663 nós), Graphify 18MB grafo de conhecimento, ML Embeddings índice vetorial, Nexus DB e Knowledge Vault.',
      tip_hs_pipeline:
        'Pipeline - 105 etapas configuradas, 101 habilitadas: 31 Phase 1 paralelas + 70 lazy background em lotes de 5. Promise.allSettled nunca bloqueia ante falhas.',
      tip_hs_tools:
        'Tools - 10 integrações IDE: OpenCode, Claude Code, Cursor, Windsurf, Cline, Codex, Copilot, Continue.dev, Aider, Roo Code.',
      tip_c_agentspipeline_10: 'Geração de código, construção de features, refatoração',
      tip_c_agentspipeline_11: 'sdd-verify',
      tip_c_agentspipeline_12: 'Testes, validação, quality gates',
      tip_c_agentspipeline_13: 'gov-agent',
      tip_c_agentspipeline_14: 'Conformidade, segurança e aplicação de políticas',
      tip_c_agentspipeline_15: 'ops-agent',
      tip_c_agentspipeline_16: 'Deploy, CI/CD, infraestrutura',
      tip_c_agentspipeline_17: 'doc-agent',
      tip_c_agentspipeline_18: 'Documentação técnica, ADRs, guias',
      tip_c_agentspipeline_19: 'session-agent',
      tip_c_agentspipeline_20: 'Rastreamento de estado, gerenciamento do lifecycle',
      tip_c_agentspipeline_21: 'premortem-agent',
      tip_c_agentspipeline_22: 'Identificação de riscos, previsão de falhas',
      tip_c_agentspipeline_23: 'maintenance-agent',
      tip_c_agentspipeline_24: 'Limpeza, otimização, monitoramento de saúde',
      tip_c_agentspipeline_25: 'self-diag-agent',
      tip_c_agentspipeline_26: 'Auto-debug e recuperação break-glass',
      tip_c_agentspipeline_27: 'sia-agent',
      tip_c_agentspipeline_28: 'Agente auto-melhorável, refinamento iterativo',
      tip_c_agentspipeline_29: 'gitflow-agent',
      tip_c_agentspipeline_30: 'Gerenciamento de branches, automação de PRs',
      tip_c_agentspipeline_31: 'knowledge-agent',
      tip_c_agentspipeline_32: 'Operações de knowledge base, gerenciamento do vault',
      tip_c_agentspipeline_33: 'explore',
      tip_c_agentspipeline_34: 'Exploração rápida do codebase',
      tip_c_agentspipeline_35: 'general',
      tip_c_agentspipeline_36: 'Pesquisa e tarefas de múltiplas etapas',
      tip_c_agentspipeline_4: 'Roteia, coordena, lifecycle da sessão',
      tip_c_agentspipeline_5: 'sdd-explore',
      tip_c_agentspipeline_6: 'Coleta de requisitos, análise e esclarecimento',
      tip_c_agentspipeline_7: 'sdd-design',
      tip_c_agentspipeline_8: 'Design de sistemas, contratos de API, arquitetura',
      tip_c_agentspipeline_9: 'sdd-apply',
      tip_c_health_10: 'Arquivos de configuração, saúde do bridge, status do MCP',
      tip_c_health_11: 'Diretório de sessão, manifesto, configuração do pipeline',
      tip_c_health_12: 'Git hooks: pre-commit, post-commit, post-merge',
      tip_c_health_13: 'JSON schemas, 5 configs, validador JSON',
      tip_c_health_14: 'Clinerules, cursorrules, configuração do continue',
      tip_c_health_15: 'Estrutura do Opencode, configuração de auth, orquestador de segurança',
      tip_c_health_16: 'Hybrid executor, delegadores AWS/Azure',
      tip_c_health_17: 'Spans de tracing, exportação OTLP, arquivos de spans',
      tip_c_health_18: 'Diretório de checkpoints, snapshots, prontidão para rollback',
      tip_c_health_19:
        'Arquivo da Nexus DB, WAL, verificação de integridade, 7 migrations, 21 tables',
      tip_c_health_20: 'Model router, perfis, configuração de fallback',
      tip_c_health_21: 'Logs de auditoria, pipeline, arquivo',
      tip_c_health_22: 'Arquivos de políticas, diretório de regras, 60 normativas',
      tip_c_health_27: 'Inicializar DB + executar todas as migrations',
      tip_c_health_28: 'Health check: integridade, WAL, tables, rows',
      tip_c_health_29: 'Backup online seguro em .runtime/backups/',
      tip_c_health_30: 'WAL checkpoint + REINDEX + VACUUM',
      tip_c_health_31: 'Remover dados antigos das stack tables',
      tip_c_health_32: 'Mostrar estatísticas do backlog por status/severidade/tipo',
      tip_c_health_33: 'Listar itens do backlog com filtros',
      tip_c_health_34: 'Gerar relatório markdown',
      tip_c_health_36: 'dev, po, qa, ux, ops, sec, any',
      tip_c_health_37: 'critical, high, medium, low',
      tip_c_health_38: '1-5 numérico',
      tip_c_health_39: 'Tempo estimado de resolução',
      tip_c_health_40: 'blocking, major, minor, cosmetic',
      tip_c_health_41: 'Versão/release alvo',
      tip_c_health_42: 'dev, staging, prod, all',
      tip_c_health_43: 'open, in_progress, resolved, wont_fix, backlog, duplicate',
      tip_c_health_44: 'Comentários',
      tip_c_health_45: 'Thread de discussão por item',
      tip_c_health_46: 'Histórico de status',
      tip_c_health_47: 'Trilha de auditoria completa das mudanças de status',
      tip_c_health_48: 'Itens relacionados',
      tip_c_health_49: 'duplicates, blocked_by, supersedes, child_of',
      tip_c_health_5: 'Servidor WS do Dashboard, API 200, PID do watchdog',
      tip_c_health_50: 'Tags',
      tip_c_health_51: 'Categorização multi-rótulo',
      tip_c_health_52: 'Link da sessão',
      tip_c_health_53: 'Rastreabilidade até a sessão onde foi encontrado/corrigido',
      tip_c_health_54: 'Buscar',
      tip_c_health_55: 'Encontrar itens semelhantes para evitar duplicados',
      tip_c_health_56: 'Auto-prune',
      tip_c_health_57: 'Remover itens resolvidos antigos (TTL configurável)',
      tip_c_health_6: 'Índice existente, 677 arquivos, 10,663 nós, 21,746 arestas, 28MB',
      tip_c_health_7: 'Daemon de timeout, PIDs do watchdog, proteção contra loops de reinício',
      tip_c_health_8: 'Índice ML, arquivos de embeddings, skill embeddings',
      tip_c_health_9: 'Integridade da DB, log de reindexação, pipeline RAG, 2078 obs',
      tip_c_operationscloud_10: 'Verificar a sintaxe do workflow de CI/CD',
      tip_c_operationscloud_11: 'Integridade dos scripts de research',
      tip_c_operationscloud_12: 'Health check do banco de dados Nexus',
      tip_c_operationscloud_13: 'Backup online seguro',
      tip_c_operationscloud_14: 'Verificação completa de manutenção',
      tip_c_operationscloud_9: 'Validar esquemas JSON',
      tip_c_quickstart_11: 'Executar todas as suítes de testes',
      tip_c_quickstart_12: 'Executar health checks',
      tip_c_quickstart_13: 'Verificar auto-aplicações pendentes',
      tip_c_quickstart_14: 'Health check do banco de dados',
      tip_c_quickstart_15: 'Consulta do knowledge graph',
      tip_c_quickstart_16: 'Compilar o dashboard',
      tip_c_quickstart_18: 'Iniciar o dashboard completo (Vite dev + proxy WS)',
      tip_c_quickstart_19: 'Iniciar apenas o servidor WS (WebSocket + API HTTP)',
      tip_c_quickstart_20: 'Compilar o bundle de produção do dashboard',
      tip_c_quickstart_22: 'Inicializar o DB + executar todas as migrações (idempotente)',
      tip_c_quickstart_23: 'Health check — integridade, WAL, tabelas, linhas',
      tip_c_quickstart_24: 'Limpar dados antigos (eventos &gt;30d, cache &gt;7d, tokens &gt;90d)',
      tip_c_quickstart_25: 'Checkpoint WAL + REINDEX + VACUUM',
      tip_c_securitygovernance_12: 'Adicionar entrada ao JSONL diário',
      tip_c_securitygovernance_13: 'Status de auditoria atual',
      tip_c_securitygovernance_14: 'Buscar entradas de auditoria',
      tip_c_securitygovernance_15: 'Rotacionar logs antigos para o arquivo',
      tip_c_securitygovernance_16: 'Remover entradas expiradas',
      tip_c_securitygovernance_54: 'AI-NORMATIVES.md',
      tip_c_securitygovernance_55: 'Regras centrais de comportamento de IA &amp; diretrizes éticas',
      tip_c_securitygovernance_56: 'NORMATIVAS-ARCHITECTURE.md',
      tip_c_securitygovernance_57: 'Restrições de design do sistema &amp; padrões',
      tip_c_securitygovernance_58: 'Arquitetura',
      tip_c_securitygovernance_59: 'NORMATIVAS-SECURITY-COMPLIANCE.md',
      tip_c_securitygovernance_60: 'Endurecimento de segurança &amp; conformidade',
      tip_c_securitygovernance_61: 'Segurança',
      tip_c_securitygovernance_62: 'NORMATIVAS-CODE-QUALITY.md',
      tip_c_securitygovernance_63: 'Portões de revisão de código &amp; limites de qualidade',
      tip_c_securitygovernance_64: 'Qualidade',
      tip_c_securitygovernance_65: 'NORMATIVAS-WORKFLOW.md',
      tip_c_securitygovernance_66: 'Fluxos de trabalho operacionais &amp; sequências',
      tip_c_securitygovernance_67: 'Workflow',
      tip_c_securitygovernance_68: 'NORMATIVAS-OPS-DEVOPS.md',
      tip_c_securitygovernance_69: 'Regras de CI/CD, implantação e infraestrutura',
      tip_c_securitygovernance_70: 'DevOps',
      tip_c_securitygovernance_71: 'NORMATIVAS-AUTONOMOUS-EVOLUTION.md',
      tip_c_securitygovernance_72: 'Auto-evolução &amp; promoção de normas',
      tip_c_securitygovernance_73: 'Autonomia',
      tip_c_securitygovernance_74: 'NORMATIVAS-EVAL-QUALITY.md',
      tip_c_securitygovernance_75: 'Portões de avaliação &amp; verificação',
      tip_c_securitygovernance_77: 'NORMATIVAS-MULTI-TENANT.md',
      tip_c_securitygovernance_78: 'Isolamento de tenant &amp; limites de recursos',
      tip_c_securitygovernance_79: 'Multi-Tenant',
      tip_c_securitygovernance_80: 'NORMATIVAS-PERFORMANCE.md',
      tip_c_securitygovernance_81: 'Orçamentos de desempenho &amp; SLAs',
      tip_c_securitygovernance_82: 'Desempenho',
      tip_c_securitygovernance_83: 'NORMATIVAS-ENFORCEMENT.md',
      tip_c_securitygovernance_84: 'Mecanismos de aplicação &amp; escalonamento',
      tip_c_securitygovernance_85: 'Governança',
      tip_c_securitygovernance_86: 'HUMAN-IN-THE-LOOP.md',
      tip_c_securitygovernance_87: 'Supervisão humana &amp; portões de aprovação',
      tip_c_securitygovernance_89: 'INCIDENT-RESPONSE.md',
      tip_c_securitygovernance_90: 'Tratamento de incidentes &amp; recuperação',
      tip_c_securitygovernance_92: 'SECRETS-MANAGEMENT.md',
      tip_c_securitygovernance_93: 'Gerenciamento de segredos &amp; rotação',
      tip_c_securitygovernance_95: 'COST-ATTRIBUTION.md',
      tip_c_securitygovernance_96: 'Rastreamento de custos &amp; atribuição',
      tip_c_securitygovernance_97: 'Finanças',
      tip_fm_55:
        '11 repositórios no total: 10 DAOs + MigrationRunner. O MigrationRunner aplica as migrações de esquema em ordem com FK ON e modo WAL.',
      tip_fm_56:
        '7 migrações de esquema criam 21 tabelas. Migração 001 = esquema inicial, 002 = tabelas do stack, 003 = session scoring, aplicadas automaticamente pelo DatabaseManager no início da sessão.',
      tip_fm_57:
        'Design desacoplado de 6 camadas: Tools -> Agents -> Pipeline -> Memory -> Data -> Executive.',
      tip_fm_58:
        '31 etapas Phase-1 executam em paralelo no início da sessão usando Promise.allSettled. Não bloqueante e idempotente.',
      tip_fm_59:
        '70 tarefas lazy em background são enfileiradas em batches após o início da sessão (delay de batch 500ms -> 100ms).',
      tip_fm_60:
        'Todas as tarefas de batch usam Promise.allSettled para que uma única falha nunca bloqueie o pipeline.',
      tip_fm_61:
        'Motor executivo: trigger -> apply -> verify -> rollback. Máx. 5 auto-aplicações/dia, rollback se degradação >15%.',
      tip_fm_62:
        'Padrão de 3 estados CLOSED/OPEN/HALF_OPEN. 5 falhas -> OPEN, 2 sucessos -> CLOSED.',
      tip_fm_63:
        'Escalação de 3 níveis: warning(3) -> critical(5) -> emergency(10) com auditoria + findings ledger.',
      tip_fm_64:
        'Descobre automaticamente as relações entre componentes a partir da config do pipeline. Sem mapa hardcoded.',
      tip_fm_65:
        'createExperiment -> assign -> evaluate com rollback automático ante degradação estatística.',
      tip_fm_66:
        'Scoring de qualidade por sessão que rastreia delegações, correções e acertos proativos. Detecção de anomalias.',
      tip_fm_67:
        'Descobre automaticamente padrões nas execuções e escreve LEARNED-NORMS.md. Evolução adaptativa.',
      tip_fm_68:
        'Memória persistente Engram: 2078 observações, auto-sync entre sessões e projetos.',
      tip_fm_69:
        'Grafo de conhecimento CodeGraph: 10.663 nós e 21.746 arestas derivadas da análise AST.',
      tip_fm_70:
        'Grafo de conhecimento Graphify de 18MB com god nodes, estrutura de comunidades e relações entre arquivos.',
      tip_fm_71:
        'BD operacional Nexus: SQLite modo WAL, 21 tabelas, auto-init, auto-prune, auto-backup e monitoramento do watchtower.',
      tip_fm_72:
        'Índice vetorial ML Embeddings para busca semântica sobre skills, normas e documentação.',
      tip_fm_73:
        'Escaneamento pre-input, pipeline de auditoria, aplicação de políticas e guardrails antes de cada prompt.',
      tip_fm_74:
        'Logs de auditoria JSONL com ações log/status/query/archive/prune sob .session/audit/logs/.',
      tip_fm_75: 'Políticas de governance + aplicação de regras nos 21 componentes do watchtower.',
      tip_fm_76:
        'Guardrails: validação pre-input que rejeita prompts inseguros antes de chegarem ao modelo.',
      tip_fm_77: '60 normativas que cobrem regras e políticas para a operação autônoma.',
      tip_fm_78:
        'Push WebSocket ao dashboard a cada 5 segundos com métricas reais calculadas a partir de traces.',
      tip_fm_79:
        'O fallback HTTP polling mantém o dashboard vivo mesmo se o servidor WS cair temporariamente.',
      tip_fm_80:
        '7 seções do dashboard: overview, metrics, tracing, alerts, feedback, i18n e info popups.',
      tip_fm_81:
        'Tradução completa da UI em inglês, espanhol e português brasileiro (14 descrições de métricas).',
      tip_fm_82:
        '8 regras de alerta auto-avaliadas a cada ciclo de broadcast com status ok/degraded/fail.',
      tip_fm_83: '6 jobs CI + 3 jobs de segurança (gitleaks, secretlint, trivy) em cada push.',
      tip_fm_84:
        'Roteamento híbrido AWS/Azure por custo, latência e carga com fallback de circuit breaker.',
      tip_fm_85:
        'Tracing distribuído baseado em spans com exportação OTLP. Spans JSONL sob .telemetry/.',
      tip_fm_86:
        'Checkpoints, snapshots e rollback com validação dry-run. Auto-criação no início da sessão.',
      tip_fm_87:
        'Event store append-only + saga orchestrator com passos de compensação para consistência.',
      tip_fm_88: '97 arquivos de teste em 12 suítes cobrindo units, configs, workflows e CI/CD.',
      tip_fm_89: '95 health checks em 21 componentes. Tudo verde: 95/95 PASS, 0 WARN, 0 FAIL.',
      tip_fm_90:
        'Code review multi-eixo: correctness, readability, architecture, security e performance.',
      tip_fm_91: 'Diretrizes Karpathy: Think First, Simplicity, Surgical Changes, Goal-Driven.',
      tip_fm_92:
        'Workflow SDD: explore -> design -> apply -> verify com contratos formais de entrada/saída.',
      tip_auto_loop:
        'Detecção → Avaliação → Decisão → Execução → Verificação → Aprendizado. Lê 3 fontes de gatilho: predictive-governor (orçamento), skill-evolution (deprecação) e auto-norm-learner (normas). Auto-apply safe com rollback se degradação >15%.',
      tip_auto_safety:
        'Envelope de saúde e segurança: 95/95 checks PASS em 21 componentes, circuit breaker (5 falhas → OPEN, 2 sucessos → CLOSED), auto-escalação de 3 níveis (3→5→10), auto-rollback e limite mínimo de aplicação de 80% de confiança.',
      tip_cacherepo:
        'response_cache + semantic cache — chave SHA256 → resposta com TTL e rastreio de hit_count; o cache semântico adiciona busca por similaridade de embeddings.',
      tip_contractrepo:
        'contract_results — persistência da validação de contratos SDD (Spec-Driven Development): contratos de entrada/saída avaliados por delegação.',
      tip_errormemrepo:
        'error_memory + embeddings — rastreio de bugs com busca vetorial para que erros passados e suas soluções sejam recuperáveis por similaridade semântica.',
      tip_eventrepo:
        'events + alerts — event sourcing append-only com cadeia de hash SHA-256 (à prova de adulteração) mais as 8 regras de alerta avaliadas em um ciclo de broadcast de 5s.',
      tip_exe_abtest:
        'Teste A/B estatístico: createExperiment → assign → evaluate. Auto-rollback quando a variante vencedora mostra degradação estatística contra o controle.',
      tip_exe_autoapply:
        'Motor executivo: trigger→apply→verify→rollback com um teto de segurança de 5 auto-aplicações diárias. Qualquer mudança que degrade o desempenho mais de 15% é revertida automaticamente.',
      tip_exe_circuit:
        'Padrão de 3 estados CLOSED/OPEN/HALF_OPEN: 5 falhas consecutivas abrem o circuito, 2 sucessos o movem para HALF_OPEN e depois CLOSED. Previne falhas em cascata em chamadas cloud e pipeline.',
      tip_exe_cloud:
        'Executor híbrido AWS/Azure com roteamento por custo, latência e carga com fallback automático. Circuit breaker: 5 falhas → OPEN, 2 sucessos → HALF_OPEN → CLOSED.',
      tip_exe_depgraph:
        'Descobre automaticamente as relações entre componentes lendo a configuração do pipeline — sem mapa de dependências hardcoded. O grafo permanece correto ao adicionar ou remover etapas.',
      tip_exe_escalation:
        'Escalação de 3 níveis: warning (3 falhas) → critical (5) → emergency (10). Cada escalação escreve um registro de auditoria completo no findings ledger.',
      tip_exe_norms:
        'Descobre automaticamente padrões recorrentes nas execuções e os escreve em LEARNED-NORMS.md — o stack literalmente evolui suas próprias regras ao longo do tempo.',
      tip_exe_scoring:
        'Scoring de qualidade por sessão que rastreia delegações, correções e acertos proativos. Compara pontuações automaticamente e alerta sobre regressão >15% ou anomalias.',
      tip_exe_security:
        'Escaneamento pre-input de cada prompt, pipeline de auditoria (logs JSONL com query/archive/prune), aplicação de políticas e guardrails. Regido por 60+ normativas.',
      tip_exe_state:
        'Checkpoint, snapshot e rollback com validação dry-run. Os checkpoints são criados automaticamente no início da sessão; o rollback restaura o estado com segurança a partir do último checkpoint bom.',
      tip_exe_tracing:
        'Tracing distribuído baseado em spans com exportação OTLP para http://localhost:4318/v1/traces. Os spans persistem como JSONL em .telemetry/spans/ e .telemetry/traces/.',
      tip_exe_watchtower:
        'Orquestador central de saúde: 95 checks em 21 componentes executados com paralelismo Promise.allSettled. Modos: health, rebuild, autoheal, report, continuous, all.',
      tip_housekeepingrepo:
        'pruneAll, housekeeping, vacuum — checkpoint WAL automático quando >1MB, poda por retenção e otimização do BD (REINDEX, VACUUM).',
      tip_met_health:
        '95/95 checks PASS em 21 componentes: dashboard-ws, codegraph, ml-embeddings, engram, mcp, session, hooks, configs, tool-configs, security, cloud-connectors, tracing, state-persistence, audit, governance e gentle-vanguard-db. Medidos pelo maintenance watchtower.',
      tip_met_perf:
        'Indicadores-chave de desempenho: os checks do watchtower passaram de sequencial para paralelo, o delay de batches lazy foi otimizado de 500ms → 100ms (5x mais rápido), o DB Manager foi refatorado de 1066 → 250 linhas (-77%) e a autonomia subiu de 73% para 100%.',
      tip_metricsrepo:
        'CRUD de metric_snapshots — séries temporais de tokens, latência e saúde amostradas a cada 30s. Alimenta os gráficos do dashboard em tempo real e a análise de tendências.',
      tip_nexus_arch:
        'Nexus é o cérebro operacional: SQLite em modo WAL com FK ON. 11 repositórios (10 DAOs + MigrationRunner), 7 migrações (m001 esquema inicial, m002 tabelas do stack, m003 session scoring, …) e 21 tabelas. Cada componente persiste seu estado vivo em arquivos .state.json sob .session/context-log/. Auto-init, auto-prune, auto-backup e monitoramento do watchtower (componente gentle-vanguard-db).',
      tip_sessionrepo:
        'sessions + session_scoring — upsert por session_id, consultas de sessões ativas e scoring de qualidade por sessão (delegações, correções, acertos proativos).',
      tip_sk_analysis:
        'idea-refine, doubt-driven-dev, premortem, socratic-skill, interview-me e source-driven — estruturas de pensamento que testam ideias antes da execução.',
      tip_sk_arch:
        'O pipeline SDD: sdd-explore (BA), sdd-design (SAD), sdd-apply (DEV) e sdd-verify (QA) mais systems-thinking e api-interface — desenvolvimento guiado por especificação, da ideia ao código verificado.',
      tip_sk_auto:
        'Skills que impulsionam a autogestão: auto-apply-safe, circuit-breaker, auto-escalation, session-scoring, predictive-governor e auto-norm-learner — o cérebro executivo do stack.',
      tip_sk_dev:
        'typescript-skill, testing-skill, testing-coverage, technical-debt, code-review e shellcheck — portões de qualidade de código aplicados antes de cada mudança chegar.',
      tip_sk_docs:
        'doc-agent, writing-plans, write-spec, visual-content, documentation e standup-skill — produzem e mantêm documentação de alta qualidade de forma nativa.',
      tip_sk_infra:
        'ci-cd-automation, observability, performance-opt, cloud-connectors, NORMATIVAS-OPS e SELF-HEALING-CI — a camada operacional que mantém o stack rodando.',
      tip_sk_quality:
        'testing-evidence, eval-gates, CI-HARDENING, Karpathy, HALLUCINATION e SDD-STRICT-TDD — portões baseados em evidência que bloqueiam saída de baixa qualidade.',
      tip_sk_sec:
        'Security skill, security-audit, governance-agent, AI-NORMATIVES, SECRETS-MGMT e INCIDENT-RESPONSE — aplicam políticas e guardrails em cada prompt.',
      tip_sk_tooling:
        'start-skill, workflow-orch, session-workflow, task-mgmt, semantic-matcher e skill-creator — as meta-skills que gerenciam como todas as outras são usadas.',
      tip_skillrepo:
        'skill_usage, token_usage, routing_rules — rastreio de uso de skills por sessão, contabilidade real de tokens com coluna total_tokens gerada e persistência do router adaptativo com hit_count.',
      tip_tracerepo:
        'traces + feedback — spans de tracing distribuído com visão waterfall, estatísticas de latência e polegar para cima/baixo por span do dashboard de observabilidade.',
      // Dashboard tips (pt-BR)
      tip_dashboard_websocket:
        'Atualizações WebSocket em tempo real a cada 5 segundos com fallback HTTP.',
      tip_dashboard_sections:
        '7 seções do dashboard: Métricas, Trazas, Alertas, Scoring, Waterfall, Feedback e Info.',
      tip_dashboard_alerts:
        '8 regras de alerta configuráveis que monitoram uso de tokens, saúde e desempenho.',
      tip_dashboard_i18n:
        'Suporte de internacionalização: Português, Espanhol e Inglês com detecção automática.',

      // Patterns tips (pt-BR)
      tip_patterns_karpathy:
        'Diretrizes Karpathy: Think First, Simplicity, Surgical Changes, Goal-Driven.',
      tip_patterns_sdd: 'Ciclo SDD: Explore → Design → Apply → Verify com limiares de confiança.',
      tip_patterns_slop:
        'Detecção AI Slop: portões automáticos para prevenir conteúdo genérico de IA.',
      tip_patterns_arch:
        '10 padrões arquiteturais: Layered, Event-Driven, CQRS, Circuit Breaker, Saga, etc.',
      tip_patterns_standards:
        'Padrões de desenvolvimento: convenções de código, documentação e portões de revisão.',
      tip_patterns_docs:
        'Redução de carga cognitiva e revelação progressiva em documentação técnica.',
    },
  };

  const STORAGE_KEY = 'gv-lang';

  function getCurrentLang() {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('lang');
      if (fromUrl && DICT[fromUrl]) return fromUrl;
      return localStorage.getItem(STORAGE_KEY) || 'en';
    } catch (e) {
      return 'en';
    }
  }

  const FLAGS = { en: '🇬🇧', es: '🇪🇸', 'pt-BR': '🇧🇷' };
  const LANG_SHORT = { en: 'EN', es: 'ES', 'pt-BR': 'PT' };

  function translate(lang) {
    const dict = DICT[lang] || DICT.en;
    // Mezclar diccionario de contenido externo (i18n-content.js) si existe
    const contentDict =
      window.__GV_CONTENT && window.__GV_CONTENT[lang] ? window.__GV_CONTENT[lang] : {};
    const merged = Object.assign({}, DICT.en, contentDict, dict);
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (merged[key] !== undefined) {
        el.textContent = merged[key];
      }
    });
    // Traducir atributos title de elementos con data-i18n-title
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-title');
      if (merged[key] !== undefined) {
        el.setAttribute('title', merged[key]);
      }
    });
    document.documentElement.setAttribute('lang', lang);
    // file:// pages do not share localStorage consistently across browsers;
    // keep the selection in the URL as a portable navigation fallback.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      window.history.replaceState({}, '', url.href);
    } catch (e) {
      /* history is unavailable in restricted viewers */
    }
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      /* localStorage no disponible (file:// o modo restringido) */
    }
    // Update active state on language buttons (segmented control)
    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      const isActive = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      const code = btn.querySelector('.lang-code');
      if (code) code.textContent = LANG_SHORT[btn.getAttribute('data-lang')];
    });
    // Dispatch event for other scripts
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
  }

  function setActiveNav() {
    const current = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('nav a.nav-link[href]').forEach(function (link) {
      const href = link.getAttribute('href') || '';
      const target = href.split(/[?#]/)[0].split('/').pop().toLowerCase();
      const active = target === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function init() {
    var currentLang = getCurrentLang();
    translate(currentLang);
    setActiveNav();

    // Delegate click events on language buttons
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lang]');
      if (btn) {
        e.preventDefault();
        var lang = btn.getAttribute('data-lang');
        if (DICT[lang]) {
          translate(lang);
        }
      }

      var link = e.target.closest('nav a.nav-link[href]');
      if (link) {
        try {
          var next = new URL(link.href, window.location.href);
          next.searchParams.set('lang', getCurrentLang());
          link.href = next.href;
        } catch (err) {
          /* keep normal navigation in restricted viewers */
        }
      }
    });
  }

  // Run on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.__i18n = {
    DICT: DICT,
    getDict: function (lang) {
      const current = lang || getCurrentLang();
      const contentDict =
        window.__GV_CONTENT && window.__GV_CONTENT[current] ? window.__GV_CONTENT[current] : {};
      return Object.assign({}, DICT.en, contentDict, DICT[current] || {});
    },
    translate: translate,
    getCurrentLang: getCurrentLang,
  };
})();
