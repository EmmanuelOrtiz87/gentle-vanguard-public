# AUTO-CONTRIBUTION.md — Agent Self-Modification Protocol

## Purpose

Define how the agent modifies its own configuration, rules, skills, and scripts to improve autonomy
over time. Every session should leave the agent slightly better than it found it.

## Principles

1. **Self-modification is INHERENTLY dangerous** — always validate before committing
2. **All changes must be reversible** — keep a change log
3. **Prefer additive changes** (new skills, rules) over destructive ones (deleting)
4. **Document WHY** in Engram via `mem_save` — not just WHAT changed
5. **Respect the config hierarchy**: orchestrator > workspace > session > user

## Permitted Self-Modifications (No Approval Needed)

| Action                               | Guard                                     |
| ------------------------------------ | ----------------------------------------- |
| Add new skill under `skills/<name>/` | Must register in `.atl/skill-registry.md` |
| Append to `AGENTS.md` section        | Must not break existing structure         |
| Create new rule under `rules/`       | Must not contradict existing rules        |
| Fix bug in `scripts/utilities/`      | Must pass `validate-configs.ps1`          |
| Update `docs/` for accuracy          | Must not remove user-authored content     |
| Add/modify `TODO:` comments          | Must be actionable                        |

## Forbidden Self-Modifications (Requires External Approval)

| Action                                             | Reason                 |
| -------------------------------------------------- | ---------------------- |
| Delete or modify `CLAUDE.md`                       | Bootstrap integrity    |
| Change `config/orchestrator.json`                  | System architecture    |
| Modify `rules/DEVELOPMENT-STANDARDS.md`            | Development foundation |
| Change `.gitignore`                                | Security boundary      |
| Delete user-created files                          | Data loss risk         |
| Disable or modify guard scripts (verify, validate) | Safety net             |

## Workflow

### Before modifying yourself

```powershell
# 1. Read what you're about to change
Get-Content -LiteralPath "path/to/target" | Select-Object -First 20

# 2. Check for existing patterns (don't reinvent)
Get-ChildItem -Recurse -Filter "*.md" -LiteralPath "skills/" | Select-Object -First 5

# 3. Validate current state
pwsh -NoProfile -File scripts/utilities/validate-configs.ps1

# 4. Run codegraph impact if modifying shared files
# codegraph_context "impact of changes to X" (tool call)
```

### After modifying yourself

```powershell
# 1. Validate configs
pwsh -NoProfile -File scripts/utilities/validate-configs.ps1

# 2. Rebuild skill registry if skills changed
pwsh -NoProfile -File scripts/utilities/build-skill-registry.ps1

# 3. Save to Engram
# mem_save -title "Self-mod: <summary>" -type "config" (tool call)

# 4. Record in change log (manages expectations for rollback)
# Append to .local/auto-contribution-log.md
```

## Change Log Format (`.local/auto-contribution-log.md`)

```markdown
## 2026-05-21 — <brief description>

- **What**: <what changed>
- **Why**: <motivation>
- **Files**: <paths>
- **Rollback**: <revert command or git command>
```

## Engram Save Template

```
title: "Self-mod: <short description>"
type: "architecture"
content: |
  **What**: <what was changed>
  **Why**: <why it was necessary>
  **Where**: <file paths>
  **Learned**: <gotchas or decisions>
```

## Integration with Session Lifecycle

- **Startup**: Check `.local/auto-contribution-log.md` for pending rollbacks
- **During work**: Follow this protocol when you detect an improvement opportunity
- **Close**: Include self-modifications in `mem_session_summary`

## Examples

| Trigger                                   | Action                                   | Protocol                                       |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| "This skill always fails with X error"    | Fix the script, add Known Issues section | Read → Validate → Edit → Validate → Engram     |
| "We keep typing the same commands"        | Create a new skill or script             | Check existing → Create → Register → Engram    |
| "The AGENTS.md startup is missing a step" | Add the step                             | Read structure → Append → Validate → Engram    |
| "Config X is wrong for this platform"     | Fix config value                         | Read → Check impact → Edit → Validate → Engram |
