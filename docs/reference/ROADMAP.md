# Roadmap

<p align="center">
  <b>Gentle-Vanguard — AI-First Development Workspace</b><br>
  <i>v2.8.0 · Updated 2026-05-08</i>
</p>

---

## Vision

Convertir Gentle-Vanguard en el workspace estándar para desarrollo asistido por IA: **local-first,
seguro, extensible, zero-drama.**

---

## Short Term (v2.9 — v2.10)

| Area          | Feature                                     | Status     |
| ------------- | ------------------------------------------- | ---------- |
| **Installer** | Auto-install Go + Engram via TUI wizard     | ✅ v2.8.0  |
| **Quality**   | EditorConfig, Prettier CI check             | 🔜 Next    |
| **Docs**      | Branch strategy, Release process documented | 🔜 Next    |
| **Security**  | Secretlint pre-commit integration           | 📋 Planned |
| **Testing**   | Coverage reporting (Pester CodeCoverage)    | 📋 Planned |

## Mid Term (v3.0)

| Area          | Feature                                                     | Priority |
| ------------- | ----------------------------------------------------------- | -------- |
| **DX**        | `gentle-vanguard init` — project scaffolding from templates | High     |
| **CI/CD**     | Automated release workflow (tag → release)                  | High     |
| **Security**  | SBOM generation (CycloneDX) via Trivy                       | Medium   |
| **Docs**      | Architecture Decision Records process tooling               | Medium   |
| **Quality**   | Cross-platform test matrix (Linux + macOS)                  | Medium   |
| **Telemetry** | Token usage dashboard v2 with historical trends             | Low      |

## Long Term (v3.x+)

| Area                         | Vision                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| **Plugin Registry**          | Marketplace de skills comunitarios                              |
| **MCP Native**               | Model Context Protocol como first-class citizen                 |
| **Web UI**                   | Dashboard web para métricas en tiempo real                      |
| **VS Code Extension**        | Integración nativa con editor                                   |
| **Multi-repo Orchestration** | Gentle-Vanguard orquestando múltiples proyectos simultáneamente |

---

## Recent Milestones

| Version | Date       | Highlights                                                                                      |
| ------- | ---------- | ----------------------------------------------------------------------------------------------- |
| v2.8.0  | 2026-05-08 | CI/CD pipeline, Lefthook v2, security hardening, Go/Engram auto-install, workspace homologation |
| v2.7.0  | 2026-05-06 | Marketing materials, documentation standards, 127 skills                                        |
| v2.6.5  | 2026-05-05 | CI hardening, rules, PSScriptAnalyzer, release workflow                                         |
| v2.6.0  | 2026-05-05 | SDD CI gate, metrics, sync drift prevention, benchmarks                                         |
