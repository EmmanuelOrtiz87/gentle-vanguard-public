<p align="center">
  <img src="https://raw.githubusercontent.com/EmmanuelOrtiz87/gentle-vanguard-public/main/docs/brand/assets/banner-github.svg" alt="Gentle-Vanguard" width="100%"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.7.0-00BFFF?style=flat-square&labelColor=0D1117" alt="Version">
  <img src="https://img.shields.io/badge/Status-Production%20Ready-22C55E?style=flat-square&labelColor=0D1117" alt="Status">
  <img src="https://img.shields.io/badge/License-MIT-4DCFFF?style=flat-square&labelColor=0D1117" alt="License">
  <img src="https://img.shields.io/badge/Platform-Win%20|%20Linux%20|%20macOS-6B7280?style=flat-square&labelColor=0D1117" alt="Platform">
  <img src="https://img.shields.io/badge/Agents-21-00BFFF?style=flat-square&labelColor=0D1117" alt="Agents">
  <img src="https://img.shields.io/badge/Skills-88-4DCFFF?style=flat-square&labelColor=0D1117" alt="Skills">
  <img src="https://img.shields.io/badge/Auto_Update-%E2%9C%93-22C55E?style=flat-square&labelColor=0D1117" alt="Auto Update">
</p>

<p align="center">
  <a href="https://github.com/EmmanuelOrtiz87/gentle-vanguard-public">GitHub</a>
  &nbsp;·&nbsp;
  <a href="docs/getting-started/README.md">Getting Started</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases">Releases</a>
  &nbsp;·&nbsp;
  <a href="docs/SECURITY.md">Security</a>
</p>

<p align="center">
  <strong>AI-powered development orchestrator · 21 agents · 88 skills · 10 tool-compatible</strong><br>
  <em>Tool-agnostic · Spec-Driven Development · Persistent Memory · Built-in Security · Auto-Update</em>
</p>

> _"Building the definitive bridge between high-end software engineering and corporate strategy."_

Born from a simple observation: AI-assisted coding works, but without structure it is chaotic.
Gentle-Vanguard gives you an orchestration layer that routes tasks to specialized agents, enforces
standards, tracks every token, and remembers what you did last session.

---

## 🎯 What It Solves

| Problem                       | How Gentle-Vanguard Solves It                              |
| ----------------------------- | ---------------------------------------------------------- |
| AI code quality varies wildly | Multi-layer validation gates catch issues before commit    |
| No session-to-session memory  | Persistent memory system recalls decisions across sessions |
| Token waste from wrong models | Cost-aware router assigns optimal model per task type      |
| Unstructured AI workflows     | SDD lifecycle enforces spec-driven development             |
| Disconnected tool sessions    | Session manager tracks context with crash recovery         |
| No AI cost visibility         | Dashboard with token trends and per-agent analytics        |
| One-size AI responses         | 21 specialized agents with role-specific profiles          |

---

## 🚀 Quick Start

```powershell
# Download the latest release
# https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases/latest

# Run the installer — it sets up everything automatically
./gentle-vanguard-3.7.0.exe
```

Or use the portable version:

```powershell
# Extract and run
./gentle-vanguard.exe -Dashboard -Portable
```

---

## 📦 Installation

### System Requirements

| Requirement    | Minimum                                         |
| -------------- | ----------------------------------------------- |
| **OS**         | Windows 10/11, Linux (Ubuntu 22.04+), macOS 14+ |
| **PowerShell** | 7.4+                                            |
| **Memory**     | 4 GB RAM                                        |
| **Disk**       | 500 MB free                                     |

### Step-by-Step

1. Download the latest `.exe` from
   [Releases](https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases)
2. Run the executable — the installer sets up all dependencies (Node, TypeScript, tools)
3. Launch with `./gentle-vanguard-3.7.0.exe -Dashboard`
4. Open `http://localhost:3000` in your browser

### 🔄 Auto-Update

The `.exe` includes **automatic updates**:

- On launch, it checks for new versions against the Releases feed
- If a new version exists, it downloads and installs it in place
- Your configuration and data are preserved across updates
- No manual intervention required

---

## 🏗️ Architecture Overview

```mermaid
graph TB
    subgraph User["👤 User Layer"]
        CLI[CLI]
        DASH[Dashboard]
        IDE[IDE Integration]
    end

    subgraph Orchestrator["🎯 Orchestration Layer"]
        INPUT[pre-process-input]
        TRIGGER[Trigger System]
        DISPATCH[Agent Dispatch]
    end

    subgraph Agents["🤖 Agent Layer"]
        BA[BA - Business Analyst]
        SAD[SAD - Architect]
        DEV[DEV - Developer]
        QA[QA - Tester]
        OPS[OPS - DevOps]
        GOV[GOV - Governance]
    end

    subgraph Skills["⚡ Skill Layer"]
        SKILLS[88 On-Demand Skills]
    end

    subgraph Memory["🧠 Memory Layer"]
        ENGRAM[Persistent Memory]
    end

    User --> Orchestrator
    Orchestrator --> Agents
    Agents --> Skills
    Agents --> Memory
```

---

## ✨ What's New in v3.7.0

### 🏛️ Gobernanza de Madurez Completa

- **8/8 módulos experimentales activados** bajo el MODULE-ACTIVATION-WORKFLOW con gates 6/6
- Módulos: root-cause-correlator, convergence-monitor, fine-tuning-collector, predictive-governor,
  proactive-intelligence, trust-layer-stage8, skill-evolution-engine, cross-workspace-mesh

### 🔒 SBOM nativo (CycloneDX 1.7)

- Integración npm: `sbom:generate` y `sbom:validate`
- SBOM con 464 componentes trackeado como artifact de compliance

### 🛡️ Container Scanning nativo

- Scanner Syft+Grype+Trivy sin Docker — SBOM, directorios y artefactos
- Gates en CI/CD y pre-push hooks

### 🧪 Chaos Engineering L4

- Experimentos de resiliencia automatizados en CI/CD (semanal)
- Verificación de auto-heal del watchdog

### 🔄 Auto-Update

- El `.exe` se auto-actualiza detectando nuevas versiones en Releases

### ✅ Verificación

- Tests 367/367 · Typecheck 0 errores · Lint 0 errores · Watchtower 95/95

---

## 📚 Documentation

| Resource                                                   | Description                 |
| ---------------------------------------------------------- | --------------------------- |
| [Getting Started](docs/getting-started/README.md)          | First-time setup guide      |
| [Installation Guide](docs/getting-started/installation.md) | Detailed installation steps |
| [Stack Setup](docs/getting-started/STACK-SETUP.md)         | Full stack configuration    |
| [Changelog](CHANGELOG.md)                                  | Version history             |
| [Examples](docs/EXAMPLES.md)                               | Usage examples              |

---

## 📄 License

MIT © 2026 Emmanuel Ortiz

---

_Gentle-Vanguard v3.7.0 — Don't let your mellow hustle be faded_