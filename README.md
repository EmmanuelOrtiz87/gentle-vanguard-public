<p align="center">
  <img src="https://raw.githubusercontent.com/EmmanuelOrtiz87/gentle-vanguard-public/main/docs/brand/assets/banner-github.svg" alt="Gentle-Vanguard" width="100%"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.8.0-00BFFF?style=flat-square&labelColor=0D1117" alt="Version">
  <img src="https://img.shields.io/badge/Status-Production%20Ready-22C55E?style=flat-square&labelColor=0D1117" alt="Status">
  <img src="https://img.shields.io/badge/License-MIT-4DCFFF?style=flat-square&labelColor=0D1117" alt="License">
  <img src="https://img.shields.io/badge/Platform-Win%20|%20Linux%20|%20macOS-6B7280?style=flat-square&labelColor=0D1117" alt="Platform">
  <img src="https://img.shields.io/badge/Agents-21-00BFFF?style=flat-square&labelColor=0D1117" alt="Agents">
  <img src="https://img.shields.io/badge/Skills-263-4DCFFF?style=flat-square&labelColor=0D1117" alt="Skills">
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
  <strong>AI-powered development orchestrator · 21 agents · 263 skills · 10 tool-compatible</strong><br>
  <em>Tool-agnostic · Spec-Driven Development · Persistent Memory · Built-in Security · Auto-Update</em>
</p>

> _"Building the definitive bridge between high-end software engineering and corporate strategy."_

Born from a simple observation: AI-assisted coding works, but without structure it is chaotic.
Gentle-Vanguard gives you an orchestration layer that routes tasks to specialized agents, enforces
standards, tracks every token, and remembers what you did last session.

At the heart of every session runs **Engram** — persistent memory that survives across sessions and
compactions — and the **judgment-day** correction engine that auto-applies learned norms from past
mistakes. The result: the stack gets smarter every time you use it.

---

## 🎯 What It Solves

| Problem                       | How Gentle-Vanguard Solves It                              |
| ----------------------------- | ---------------------------------------------------------- |
| AI code quality varies wildly | Multi-layer validation gates catch issues before commit    |
| No session-to-session memory  | **Engram** persistent memory recalls decisions across sessions |
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
./gentle-vanguard-3.8.0.exe
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
3. Launch with `./gentle-vanguard-3.8.0.exe -Dashboard`
4. Open `http://localhost:3000` in your browser

### 🔄 Auto-Update

The `.exe` includes **automatic updates**:

- On launch, it checks for new versions against the Releases feed
- If a new version exists, it downloads and installs it in place
- Your configuration and data are preserved across updates
- No manual intervention required

---

## 🏗️ Architecture Overview

The stack follows a **5-Layer Architecture**: Executive (autonomous operations), Agents
(specialized roles), Dashboard (real-time observability), MCP (protocol integration), and
Memory & Orchestration (Engram + pipeline).

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
        SKILLS[263 On-Demand Skills]
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

## 🤖 Agent Ecosystem

| Agent            | Role                                                                |
| ---------------- | ------------------------------------------------------------------- |
| **Orchestrator** | Routes requests, enforces quality guidelines, session lifecycle      |
| **BA**           | Requirements exploration and clarification (sdd-explore)             |
| **SAD**          | System architecture design and API contracts (sdd-design)            |
| **DEV**          | Implementation and refactoring (sdd-apply)                           |
| **QA**           | Verification, testing, and quality gates (sdd-verify)                |
| **OPS**          | Deployment, CI/CD, infrastructure                                    |
| **GOV**          | Compliance, security, audit, policy enforcement                      |
| **DOC**          | Technical documentation and ADRs                                     |

Every agent runs with an adaptive step budget and a **Model Profile** tuned per SDD phase — each
phase (BA/SAD/DEV/QA) gets its own temperature and hallucination guard settings from the model
router.

---

## ✨ Key Features

| Feature                     | Description                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| **Specialized Agents**      | 21 role-specific agents with adaptive step budgets (up to 80 steps)      |
| **On-Demand Skills**        | 263 skills loaded by trigger — security, compliance, diagram-design, more |
| **Persistent Engram Memory**| Hot/warm/cold tiers, auto-repair, survives sessions and compactions       |
| **Cost-Aware Model Router** | Per-domain model tiers + profiles with fallback chains                    |
| **Auto-Update**             | Self-updating launcher — detects new versions and updates in place        |
| **SLSA Provenance**         | Native DSSE/Ed25519 signing of release attestations                       |

The **Specialized Agents** cover every SDD role, **Persistent Engram Memory** recalls decisions
across sessions, and the **Cost-Aware Model Router** assigns the optimal model per task domain with
automatic fallback.

---

## 🧩 Skill Catalog

| Category   | Examples                                                            |
| ---------- | ------------------------------------------------------------------- |
| **Frontend** | frontend-ui-engineering, dashboard, design-review                  |
| **Backend**  | api-and-interface-design, performance-optimization, debugging      |
| **DevOps**   | ci-cd-and-automation, container scanning, chaos engineering        |
| **Security** | red-teaming, prompt injection, SBOM analysis, compliance          |
| **Testing**  | test-driven-development, qa-lead, browser-testing-with-devtools   |

---

## 🚀 Quick Install

```powershell
# Clone the public repository
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git

# Or bootstrap with the PowerShell installer
./bootstrap.ps1
```

For a zero-dependency install, download the `.exe` from
[Releases](https://github.com/EmmanuelOrtiz87/gentle-vanguard-public/releases) and run it — it
installs, configures, and launches the whole stack automatically.

---

## 🔄 CI/CD Pipeline

| Workflow                       | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `gentle-vanguard-quality-gate` | Lint + typecheck + tests + coverage gate on every PR   |
| `test-suite`                   | Full test matrix across Node versions                  |
| `sync-public`                  | Automated sync of public artifacts to this repository  |
| `security.yml`                 | Gitleaks + secretlint + trivy scans                    |

---

## 🛡️ Defensive Patterns

Every script in the stack follows defensive conventions:

- **repoRoot** — all scripts resolve paths from the repo root, never from `$PWD`
- **UTF-8** — explicit encoding for all file reads/writes (no BOM surprises)
- **ErrorActionPreference** — set to `Stop` at the top of every PowerShell script
- Idempotency — re-runnable without side effects
- Structured logging — consistent log format across components

---

## 🔒 Security

- **AES-256** encryption for sensitive stored data (credentials, tokens)
- Secret scanning: 80+ patterns + entropy analysis in pre-commit hooks
- SBOM (CycloneDX 1.7) + SLSA provenance for supply-chain attestation
- Chaos engineering L4 — automated weekly resilience experiments
- See [docs/SECURITY.md](docs/SECURITY.md) for the full security model

---

## ✨ What's New in v3.8.0

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
| [INSTALLATION](docs/getting-started/INSTALLATION.md)       | Quick install reference     |
| [Stack Setup](docs/getting-started/STACK-SETUP.md)         | Full stack configuration    |
| [Changelog](CHANGELOG.md)                                  | Version history             |
| [Examples](docs/EXAMPLES.md)                               | Usage examples              |

---

## 📄 License

MIT © 2026 Emmanuel Ortiz

---

_Gentle-Vanguard v3.8.0 — Don't let your mellow hustle be faded_