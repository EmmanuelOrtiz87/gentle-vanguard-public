<p align="center">
  <img src="https://raw.githubusercontent.com/EmmanuelOrtiz87/gentle-vanguard-public/main/docs/brand/assets/banner-github.svg" alt="Gentle-Vanguard" width="100%"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.2.0-00BFFF?style=flat-square&labelColor=0D1117" alt="Version">
  <img src="https://img.shields.io/badge/Status-Production%20Ready-22C55E?style=flat-square&labelColor=0D1117" alt="Status">
  <img src="https://img.shields.io/badge/License-MIT-4DCFFF?style=flat-square&labelColor=0D1117" alt="License">
  <img src="https://img.shields.io/badge/PowerShell-7+-A855F7?style=flat-square&labelColor=0D1117" alt="PowerShell">
  <img src="https://img.shields.io/badge/Platform-Win%20|%20Linux%20|%20macOS-6B7280?style=flat-square&labelColor=0D1117" alt="Platform">
  <img src="https://img.shields.io/badge/Agents-18-00BFFF?style=flat-square&labelColor=0D1117" alt="Agents">
  <img src="https://img.shields.io/badge/Skills-386-4DCFFF?style=flat-square&labelColor=0D1117" alt="Skills">
</p>

<p align="center">
  <a href="https://github.com/EmmanuelOrtiz87/gentle-vanguard-public">GitHub</a>
  &nbsp;·&nbsp;
  <a href="docs/getting-started/README.md">Getting Started</a>
  &nbsp;·&nbsp;
  <a href="../../releases">Releases</a>
  &nbsp;·&nbsp;
  <a href="docs/SECURITY.md">Security</a>
</p>

<p align="center">
  <strong>AI-powered development orchestrator · 18 agents · 386 skills · 10 tool-compatible</strong><br>
  <em>Tool-agnostic · Spec-Driven Development · Persistent Memory · Built-in Security</em>
</p>

> _"Building the definitive bridge between high-end software engineering and corporate strategy."_

Born from a simple observation: AI-assisted coding works, but without structure it is chaotic.
Gentle-Vanguard gives you an orchestration layer that routes tasks to specialized agents, enforces
standards, tracks every token, and remembers what you did last session.

---

## What It Solves

| Problem                       | How Gentle-Vanguard Solves It                              |
| ----------------------------- | ---------------------------------------------------------- |
| AI code quality varies wildly | Multi-layer validation gates catch issues before commit    |
| No session-to-session memory  | Persistent memory system recalls decisions across sessions |
| Token waste from wrong models | Cost-aware router assigns optimal model per task type      |
| Unstructured AI workflows     | SDD lifecycle enforces spec-driven development             |
| Disconnected tool sessions    | Session manager tracks context with crash recovery         |
| No AI cost visibility         | Dashboard with token trends and per-agent analytics        |
| One-size AI responses         | 18 specialized agents with role-specific profiles          |

---

## Quick Start

```powershell
# Download latest release
# https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases/latest

# Run
./gentle-vanguard-3.2.0.exe -Dashboard
```

Or use the portable version:

```powershell
# Extract and run
./gentle-vanguard.exe -Dashboard -Portable
```

---

## Installation

### System Requirements

- **OS**: Windows 10/11, Linux (Ubuntu 22.04+), macOS 14+
- **PowerShell**: 7.4+
- **Memory**: 4 GB RAM minimum
- **Disk**: 500 MB free

### Step-by-Step

1. Download the latest `.exe` from
   [Releases](https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases)
2. Run the executable — the installer will set up all dependencies
3. Launch with `./gentle-vanguard-3.2.0.exe -Dashboard`
4. Open `http://localhost:3000` in your browser

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                   USER LAYER                      │
│         (CLI · Dashboard · IDE Integration)       │
├──────────────────────────────────────────────────┤
│               ORCHESTRATION LAYER                 │
│    pre-process-input → trigger → agent dispatch   │
├──────────────────────────────────────────────────┤
│                   AGENT LAYER                     │
│    BA · SAD · DEV · QA · OPS · GOV · DOC · more  │
├──────────────────────────────────────────────────┤
│                    SKILL LAYER                    │
│    386 on-demand skills (web, mobile, security…)  │
├──────────────────────────────────────────────────┤
│                  MEMORY LAYER                     │
│     Engram persistent memory (hot/warm/cold)      │
└──────────────────────────────────────────────────┘
```

---

## New in v3.2.0 — CopilotKit Native Patterns

- **Agent Chat**: Conversational interface with 6 agents, @mentions autocomplete, suggested actions
- **AG-UI Protocol**: 7 interactive UI hints from agents (metric, datatable, chart, diff, form,
  list, alert)
- **Human-in-the-Loop**: 4-mode approval modal with auto-detection
- **Task Control**: Real-time agent task monitoring with quick dispatch
- **Session Timeline**: Visual event timeline with expandable payloads
- **Session Persistence**: Chat history saved across restarts
- **Shared State Bridge**: Event bus connected to dashboard via WebSocket

---

## Documentation

- [Getting Started](docs/getting-started/README.md)
- [Installation Guide](docs/getting-started/installation.md)
- [Stack Setup](docs/getting-started/STACK-SETUP.md)
- [Changelog](CHANGELOG.md)
- [Examples](docs/EXAMPLES.md)

---

## License

MIT © 2026 Emmanuel Ortiz

---

_Gentle-Vanguard v3.2.0 — Don't let your mellow hustle be faded_
