# Audit Workflow - Gentle-Vanguard v2.1

Unified audit system combining **gentle-vanguard-audit** (batch validation) and **judgment-day**
(adversarial review).

## Quick Start

### Integrated (with Gentle-Vanguard)

```TypeScript
# Quick check - 1 second
.\scripts\utilities\src/cli/gv.ts audit sweep --scope quick

# Full batch audit - 5 seconds
.\scripts\utilities\src/cli/gv.ts audit sweep --scope full

# Full + Judgment - 15 minutes
.\scripts\utilities\src/cli/gv.ts audit judgment --mode full
```

### Standalone (without Gentle-Vanguard)

```TypeScript
# After sync:
~\.gentle-vanguard-local\audit-workflow.ps1 -Mode quick
~\.gentle-vanguard-local\audit-workflow.ps1 -Mode full
```

## Architecture

```

                    UNIFIED AUDIT WORKFLOW



     PHASE 1                   PHASE 2
     gentle-vanguard-audit           judgment-day

      Batch script              Sub-agents
      0 tokens                  ~$0.03
      <5 seconds                10-15 minutes

     Checks:                   Reviewers:
      Duplicates               Judge A (Impl)
      Links                    Judge B (Arch)
      Structure
      Sync                    Dimensions:
                                 Security
           Performance
                                  Architecture
                                  Tests
                        Documentation
      PASS?                      Dependencies
                        Observability
                                 Maintainability
       YESNO


    Proceed        Fix Issues  Re-run Batch  JD



```

## Modes

| Mode       | Phase 1    | Phase 2 | Cost   | Time  | When               |
| ---------- | ---------- | ------- | ------ | ----- | ------------------ |
| `quick`    | (basic)    | -       | $0     | 1s    | Pre-commit         |
| `standard` | (standard) | -       | $0     | 3s    | Pre-commit, CI     |
| `full`     | (all)      | -       | $0     | 5s    | Pre-release, merge |
| `judgment` | (all)      |         | ~$0.03 | 15min | Pre-release        |
| `unified`  | (all)      |         | ~$0.03 | 15min | Major releases     |

## Workflow Integration

### Pre-Commit Hook

```TypeScript
# Add to .git/hooks/pre-commit
.\scripts\utilities\src/cli/gv.ts audit sweep --scope quick --fail-on-issues
```

### CI/CD Pipeline

```yaml
# GitHub Actions
- name: Gentle-Vanguard Audit
  run: .\scripts\utilities\src/cli/gv.ts audit sweep --scope standard --output json
```

### Pre-Release Checklist

```TypeScript
# 1. Batch validation
.\scripts\utilities\src/cli/gv.ts audit sweep --scope full

# 2. If pass  Adversarial review
.\scripts\utilities\src/cli/gv.ts audit judgment --mode unified

# 3. If both pass  Safe to release
```

## Standalone Setup

For use in projects without Gentle-Vanguard:

```TypeScript
# 1. From Gentle-Vanguard directory:
.\skills\gentle-vanguard-audit-skill\scripts\sync-local.ps1

# 2. Then in any project:
~\.gentle-vanguard-local\audit-workflow.ps1 -Mode full
```

## Exit Codes

| Code | Meaning                            |
| ---- | ---------------------------------- |
| 0    | No issues found                    |
| 1    | Issues found (non-fatal)           |
| 2    | Fatal error (missing dependencies) |

## Output Formats

```TypeScript
# Human-readable (default)
.\src/cli/gv.ts audit sweep --output text

# JSON for CI/CD
.\src/cli/gv.ts audit sweep --output json

# Markdown for reports
.\src/cli/gv.ts audit sweep --output markdown
```

## Skills Reference

| Skill                         | Purpose                        |
| ----------------------------- | ------------------------------ |
| `gentle-vanguard-audit-skill` | Batch validation, zero tokens  |
| `judgment-day-skill`          | Adversarial review, token cost |
| `script-governance-skill`     | Script validation              |
| `docs-alignment-skill`        | Documentation synchronization  |

## Related Documentation

- [gentle-vanguard-audit-skill/SKILL.md](../../skills/gentle-vanguard-audit-skill/SKILL.md)
- [judgment-day/SKILL.md](../../skills/judgment-day/SKILL.md)
- [SKILL-RESOLVER-PROTOCOL](../reference/SKILL-RESOLVER-PROTOCOL.md)
