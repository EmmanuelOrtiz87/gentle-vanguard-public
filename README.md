# Gentle-Vanguard

<p align="center">
  <img src="https://raw.githubusercontent.com/EmmanuelOrtiz87/gentle-vanguard-public/main/docs/brand/assets/banner-github.svg" alt="Gentle-Vanguard" width="100%"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.8.1-00BFFF?style=flat-square&labelColor=0D1117" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-4DCFFF?style=flat-square&labelColor=0D1117" alt="License">
  <img src="https://img.shields.io/badge/Agents-21-00BFFF?style=flat-square&labelColor=0D1117" alt="Agents">
  <img src="https://img.shields.io/badge/Skills-263-4DCFFF?style=flat-square&labelColor=0D1117" alt="Skills">
</p>

> An AI development orchestrator that adds structure, memory and verification to your existing
> coding tools.

## What It Solves

AI-assisted coding is powerful, but sessions can lose context and quality can vary. Gentle-Vanguard
routes work to specialized agents, enforces an SDD workflow, remembers previous decisions through
Engram and reports what happened through a local dashboard.

It works alongside OpenCode, Claude Code, Cline, Cursor, Windsurf and Codex. It does not require a
hosted Gentle-Vanguard account or a mandatory cloud service.

## Quick Install

```bash
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git
cd gentle-vanguard-public
pnpm install
npx tsx src/setup-complete.ts
npm run start
```

Requirements: Node.js 20+, pnpm 11+ and Git. Windows, macOS and Linux are supported.

```mermaid
flowchart LR
  U[Your request] --> O[Orchestrator]
  O --> A[Specialized agents]
  A --> S[Skills]
  A --> M[Engram memory]
  A --> Q[Quality checks]
  Q --> R[Verified result]
```

## Architecture

Gentle-Vanguard is organized around five practical layers: user tools, orchestration, agents and
skills, memory, and observability.

```mermaid
flowchart TB
  T[CLI / IDE / Dashboard] --> O[Orchestration]
  O --> A[21 agents]
  A --> K[263 on-demand skills]
  A --> E[Engram persistent memory]
  O --> D[Local dashboard]
```

## Agent Ecosystem

| Agent | Role |
| --- | --- |
| Orchestrator | Routes work and manages sessions |
| BA | Requirements exploration |
| SAD | Architecture and contracts |
| DEV | Implementation and refactoring |
| QA | Testing and verification |
| OPS | CI/CD and infrastructure |
| GOV | Security, compliance and audit |
| DOC | Documentation and ADRs |

Each phase can use a different Model Profile. The router and fallback chain are configurable and
local providers are optional.

## Key Features

| Feature | Description |
| --- | --- |
| Specialized Agents | 21 roles for analysis, design, coding, QA and operations |
| On-Demand Skills | 263 skills for development, security, documentation and research |
| Persistent Engram Memory | Decisions and context survive across sessions |
| Cost-Aware Model Router | Selects models by task and supports safe fallbacks |
| Dashboard | Local metrics, traces, alerts and feedback |
| Security Controls | Secret scanning, SBOM, provenance and quality gates |

```mermaid
flowchart TD
  S[Session] --> E[Engram]
  S --> N[Nexus operational database]
  S --> W[Watchtower health checks]
  E --> D[Dashboard]
  N --> D
  W --> D
  D --> F[Feedback and adaptive routing]
```

## Getting Started

1. Install the prerequisites.
2. Clone this repository.
3. Run `pnpm install` and `npx tsx src/setup-complete.ts`.
4. Start with `npm run start`.
5. Run `gv verify` if the command is available, or `npm run watchtower:health`.

## Development

```bash
npm run typecheck
npm run lint
npm test
```

The project follows Spec-Driven Development: explore, design, implement and verify.

## CI/CD Pipeline

The public distribution is checked by `gentle-vanguard-quality-gate`, `test-suite`, `security.yml`
and `sync-public`. The public repository receives a curated set of build, documentation and example
files from the development repository.

## Defensive Patterns

- Scripts resolve paths from `repoRoot`.
- File operations use explicit UTF-8 encoding.
- PowerShell scripts use `ErrorActionPreference = Stop`.
- Setup and validation commands are designed to be idempotent.

## Security

Never commit API keys. Use environment variables or ignored local configuration. Secret scanning,
SBOM generation and release provenance are part of the delivery process. See
[`SECURITY.md`](SECURITY.md) and [`docs/security/README.md`](docs/security/README.md).

## Documentation

| Resource | Description |
| --- | --- |
| [Getting Started](docs/getting-started/README.md) | First-time setup |
| [Architecture](docs/technical/STACK-DOCUMENTATION.md) | Detailed technical reference |
| [Installation](docs/getting-started/installation.md) | Installation options |
| [Examples](docs/EXAMPLES.md) | Usage examples |
| [Changelog](CHANGELOG.md) | Version history |

## License

MIT © 2026 Emmanuel Ortiz
