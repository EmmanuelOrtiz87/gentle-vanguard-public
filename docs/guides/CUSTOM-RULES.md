# Custom Rules for Orchestrator Extension

This guide explains how to add project-specific rules that complement the base stack skills.

## Why This Exists

Custom rules let teams extend behavior for:

1. Code generation.
2. Documentation standards.
3. Code review criteria.
4. Incident/risk checks.
5. Domain-specific business constraints.

## Directory Layout

Use these folders:

1. `rules/custom/technical/`
2. `rules/custom/business/`
3. `rules/custom/review/`

Add one or more `.md` files per scope. Other formats are not loaded.

## File Format Mandatory

All rule files **must** be Markdown (`.md`). This is enforced by the loader and ensures:

- Consistent structure readable by both humans and AI context injection.
- Predictable parsing and truncation in `context-pack` output.
- Clear section headers that AI agents can interpret without ambiguity.

`README.md` files inside scope directories are reserved for scope documentation and are **excluded**
from rule loading automatically.

### Required Template

Every rule file must follow this structure:

```markdown
# [Rule Title]

## Metadata

| Field    | Value                 |
| -------- | --------------------- |
| Rule ID  | SCOPE-NNN             |
| Scope    | [target]              |
| Severity | [HIGH / MEDIUM / LOW] |

## Requirement

Clear, actionable statement of what is required.

## Why It Matters

Rationale explain the risk or business reason.

## Validation

How to verify the rule is being followed (command, checklist, or acceptance criteria).
```

### Rule ID Convention

| Scope        | Prefix  | Example    |
| ------------ | ------- | ---------- |
| `technical/` | `TECH-` | `TECH-001` |
| `business/`  | `BIZ-`  | `BIZ-001`  |
| `review/`    | `REV-`  | `REV-001`  |

### Severity Levels

| Level  | Meaning                                       |
| ------ | --------------------------------------------- |
| HIGH   | Must be enforced; blocks merge or deployment. |
| MEDIUM | Should be enforced; flag in review.           |
| LOW    | Advisory; informational in context output.    |

## Configuration

`config/orchestrator.json` controls custom rule loading:

```json
"custom_rules": {
  "enabled": true,
  "root": "rules/custom",
  "include": ["technical", "business", "review"],
  "file_format": "md",
  "max_files_per_scope": 20
}
```

## Runtime Integration

Custom rules are loaded by:

1. `scripts/utilities/custom-rules.ps1`
<!-- REF-OBSOLETA: scripts/utilities/custom-rules.ps1 no tiene equivalente TS (migración PS1→TS) -->
2. `scripts/utilities/context-pack.ps1`
<!-- REF-OBSOLETA: scripts/utilities/context-pack.ps1 no tiene equivalente TS (migración PS1→TS) -->
3. `scripts/utilities/start-session.ps1`
<!-- REF-OBSOLETA: scripts/utilities/start-session.ps1 no tiene equivalente TS (migración PS1→TS) -->
4. `scripts/utilities/orchestrator-status.ps1`
<!-- REF-OBSOLETA: scripts/utilities/orchestrator-status.ps1 no tiene equivalente TS (migración PS1→TS) -->

## Commands

Check loaded rules:

```TypeScript
.\scripts\utilities\custom-rules.ps1 -Mode status
.\scripts\utilities\src/cli/gv.ts custom-rules-status
```

Export rule digest:

```TypeScript
.\scripts\utilities\custom-rules.ps1 -Mode export
```

## Operational Notes

1. Custom rules complement existing skills, not replace safety/compliance policy.
2. Keep rule files concise and actionable prefer short, explicit statements over long prose.
3. Review rule changes via normal PR workflow.
4. Prefer advisory language unless a rule is truly blocking.
5. Files that do not match the `.md` extension are silently ignored by the loader.
