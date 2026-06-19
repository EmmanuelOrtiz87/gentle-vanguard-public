---
name: skill-factory-skill
description: >
  Automated skill creation and cross-platform synchronization. Trigger: "skill factory", "bulk
  skill", "sync skills", "update instructions"
metadata:
  source: GV-native
---

## Purpose

Automate the creation of new skills and synchronize base instructions across all AI agents
(OpenCode, Claude, Copilot, Gemini).

## Skill Creation Workflow

1. **Intake:** User requests a new skill or agent detects repetitive patterns.
2. **Validation:** Check if skill already exists or if it overlaps with existing ones.
3. **Generation:** Create `skills/{skill-name}/SKILL.md` using the standard template.
4. **Registration:** Update `skills/SKILL_INDEX.md` and `config/orchestrator.json` if needed.
5. **Documentation:** Add entry to `docs/reference/script-registry.md` if scripts are involved.

### Standard Skill Template

```markdown
---
name: { skill-name }
description: >
  {Brief description}. Trigger: "{keyword1}", "{keyword2}"
---

## When to Use

[Specific triggers for this skill]

## Core Rules

1. [Rule 1]
2. [Rule 2]

## Workflow

1. [Step 1]
2. [Step 2]

## Output Expectations

[What the user should see]
```

## Cross-Platform Synchronization

Maintain consistency across all AI tools by syncing from a single source of truth.

### Source of Truth

`docs/reference/master-instructions.md` contains the global baseline for all agents.

### Target Files

| Platform       | Path                              | Sync Strategy  |
| -------------- | --------------------------------- | -------------- |
| OpenCode       | `AGENTS.md`                       | Full overwrite |
| GitHub Copilot | `.github/copilot-instructions.md` | Full overwrite |
| Claude Code    | `.claude/CLAUDE.md`               | Full overwrite |
| Gemini CLI     | `.gemini/instructions.md`         | Full overwrite |

### Sync Script

Use `scripts/utilities/sync-agent-instructions.ps1` to propagate changes.

```powershell
# Sync all platforms
.\scripts\utilities\sync-agent-instructions.ps1 -All

# Sync specific platform
.\scripts\utilities\sync-agent-instructions.ps1 -Target Copilot
```

## Automation Rules

- **Duplicate Detection:** Before creating a skill, search `skills/` for similar names or keywords.
- **Naming Convention:** Use `kebab-case` for skill directories and `PascalCase` for internal
  references.
- **Validation:** Every new skill must pass `gv validate` before being committed.
