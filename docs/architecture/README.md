# 🏗️ Architecture Documentation

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
│  ⚡ Layer 2: COMMANDS (src/cli/gv.ts, pre-process-input.ps1)    │
├─────────────────────────────────────────────────────┤
│  🔌 Layer 3: MCP SERVERS (Model Context Protocol)         │
├─────────────────────────────────────────────────────┤
│  🧩 Layer 4: SKILLS (125+ specialized skills)              │
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

<p align="center">
  <b>🏗️ Understand the architecture. Master the stack.</b><br>
  <i>5 layers • 127 skills • 100% agnostic</i>
</p>
