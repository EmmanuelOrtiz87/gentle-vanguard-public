# 🏗️ Architecture Documentation

Public web release:
[mandatory artifact QA, publication and operational limits](public-web-release-gate.md).

Current public-presence/design work: [status and evidence](../status/PRESENCIA-PUBLICA-Y-DISENO.md),
[app adoption plan](visual-homologation-plan.md), [canonical brand](../brand/BRAND-KIT.md) and
[interaction standard](../design/07-motion-ux-standard.md). Corporate web and campaign rendering
reuse the stack; public exports do not include internal apps or operational data.

<p align="center">
  <b>Understanding the 5-layer topology that makes Gentle-Vanguard agnostic</b>
</p>

---

## 🗺️ Topology and Workflows

| Document                                   | Description                                                       |
| ------------------------------------------ | ----------------------------------------------------------------- |
| **[layer-topology.md](layer-topology.md)** | 5-layer topology: Agents, Commands, MCP, Skills, Memory           |
| **[role-workflows.md](role-workflows.md)** | Role-based workflows: PM, Architect, Developer, QA, DevOps, UX/UI |

---

## 📏 Architecture Standards

| Document                                                   | Description                                              |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| **[architecture-standards.md](architecture-standards.md)** | Default decision shape, common areas, repository targets |

---

## 🧭 Navigation

```
docs/architecture/
├── 📖 README.md                    # This file - architecture hub
├── 🗺️ layer-topology.md            # 5-layer topology definition
├── 🎭 role-workflows.md            # Role-based workflow mappings
└── 📏 architecture-standards.md   # Architecture governance standards
```

---

## 🔍 Quick Links

- **🌐 Topology**: Understand the 5-layer architecture that makes this workspace agnostic
- **🎭 Workflows**: See how the orchestrator delegates to specialized roles
- **📏 Standards**: Governance rules for architecture decisions

---

## 🏗️ 5-Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│  🤖 Layer 1: AGENTS (BA, DEV, QA, OPS, GOV, DOC, SAD)    │
├─────────────────────────────────────────────────────┤
│  ⚡ Layer 2: COMMANDS (src/cli/gv.ts, src/tools/pre-process-input.ts)    │
├─────────────────────────────────────────────────────┤
│  🔌 Layer 3: MCP SERVERS (Model Context Protocol)         │
├─────────────────────────────────────────────────────┤
│  🧩 Layer 4: SKILLS (263 skills, canon en registry)              │
├─────────────────────────────────────────────────────┤
│  🧠 Layer 5: MEMORY (Engram - persistent cross-session)    │
└─────────────────────────────────────────────────────┘
```

> 💡 **Agnostic**: Functions with OpenCode, Cursor, Codex, Windsurf, VS Code, Cline. You choose!

---

## 🎭 Role-Based Workflows

| Role                   | Agent Code | Primary Skill             | Workflow                          |
| ---------------------- | ---------- | ------------------------- | --------------------------------- |
| **📊 Project Manager** | PM         | `project-manager`         | Planning, tracking, delivery      |
| **🏗️ Architect**       | SAD        | `architecture-governance` | Design, standards, decisions      |
| **🛠️ Developer**       | DEV        | `sdd-lifecycle`           | Implementation, testing           |
| **🧪 QA**              | QA         | `testing-skill`           | Validation, coverage, evidence    |
| **🚀 DevOps**          | OPS        | `docker-devops-skill`     | Deployment, CI/CD, infrastructure |
| **🎨 UX/UI**           | UX         | `design-ux-researcher`    | User research, interface design   |

---

## 📏 Governance Rules

### Decision Shape

```json
{
  "decision": "description",
  "rationale": "why this was chosen",
  "alternatives": ["other options considered"],
  "impact": "what this affects",
  "timestamp": "ISO-8601"
}
```

### Common Areas

- **Architecture**: Structure, patterns, modularity
- **Security**: Authentication, authorization, vulnerabilities
- **Quality**: Code smell, complexity, error handling
- **Testing**: Coverage, patterns, edge cases

### Repository Targets

- **config/**: Configuration files (auto-delegation, DAG, tokens)
- **scripts/**: Workflow and utility scripts
- **skills/**: Specialized AI skills
- **docs/**: Documentation and guides

---

## 🔍 Key Architecture Documents

| Document            | Purpose                                 | Link                                                                           |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| **System Overview** | Full architecture rationale             | [../reference/ARCHITECTURE.md](../reference/ARCHITECTURE.md)                   |
| **SDD Governance**  | Specification-driven development policy | [../reference/SDD-GOVERNANCE-POLICY.md](../reference/SDD-GOVERNANCE-POLICY.md) |
| **Plugin System**   | Plugin development guide                | [../reference/PLUGIN-ARCHITECTURE.md](../reference/PLUGIN-ARCHITECTURE.md)     |
| **Token Tracking**  | AI token monitoring guide               | [../reference/REAL-TOKEN-TRACKING.md](../reference/REAL-TOKEN-TRACKING.md)     |

---

## Corpus de arquitectura

| Documento                                                                            | Qué resuelve                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [MCP-REGISTRY.md](MCP-REGISTRY.md)                                                   | Censo, política y ciclo de vida de los servidores MCP      |
| [MODEL-IDS-CANONICOS.md](MODEL-IDS-CANONICOS.md)                                     | Ids de modelo canónicos que consumen los hosts             |
| [MULTI-TOOL-SHARED-VS-ENCAPSULATED.md](MULTI-TOOL-SHARED-VS-ENCAPSULATED.md)         | Qué se comparte entre herramientas y qué queda encapsulado |
| [STACK-GOVERNANCE-MATRIX.md](STACK-GOVERNANCE-MATRIX.md)                             | Dónde vive cada regla y cómo se enforcea                   |
| [STACK-HYGIENE-POLICY.md](STACK-HYGIENE-POLICY.md)                                   | Higiene de artefactos, regenerables y limpieza             |
| [ai-reliability-and-performance.md](ai-reliability-and-performance.md)               | Baseline de confiabilidad y performance de IA              |
| [asset-format-policy.md](asset-format-policy.md)                                     | Formatos de assets aceptados por el stack                  |
| [codex-engram-runtime-binding.md](codex-engram-runtime-binding.md)                   | Binding de Codex con Engram                                |
| [public-web-presence.md](public-web-presence.md)                                     | Sitio público unificado y su alcance                       |
| [public-web-release-gate.md](public-web-release-gate.md)                             | Gate de publicación del sitio público                      |
| [replicated-apps-policy.md](replicated-apps-policy.md)                               | Política de apps replicadas                                |
| [skills-governance-and-conflict-policy.md](skills-governance-and-conflict-policy.md) | Gobierno de skills y resolución de conflictos              |
| [stack-latency-operating-model.md](stack-latency-operating-model.md)                 | Modelo operativo de latencia                               |
| [universal-quality-gate.md](universal-quality-gate.md)                               | Gate universal de calidad y sus controles                  |
| [stack-assessment-2026-10.md](stack-assessment-2026-10.md)                           | Evaluación integral de octubre 2026 (evidencia vigente)    |
| [visual-homologation-plan.md](visual-homologation-plan.md)                           | Plan de homologación visual de apps                        |
| [adr-0022-orchestrator-loop-guard.md](adr-0022-orchestrator-loop-guard.md)           | ADR: anti-loop nativo del orquestador                      |
| [adr-0023-guardrails-defense-in-depth.md](adr-0023-guardrails-defense-in-depth.md)   | ADR: guardrails defense-in-depth                           |

<p align="center">
  <b>🏗️ Understand the architecture. Master the stack.</b><br>
  <i>5 layers • 263 skills • 100% agnostic</i>
</p>
