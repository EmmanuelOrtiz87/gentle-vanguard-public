---
name: technical-debt-skill
description: >
  Technical debt assessment, prioritization, remediation planning, and debt documentation. Trigger:
  "technical debt", "debt audit", "refactor", "code smell", "anti-pattern", "cleanup",
  "maintainability", "architecture erosion".
license: Apache-2.0
metadata:
  author: gentle-vanguard
  versión: '1.0'
metadata:
  source: GV-native
  consolidated: tech-debt-skill (knowledge-work-plugins)
---

## When to Use

- Auditing a codebase for maintainability issues
- Prioritizing debt remediation work
- Proposing refactors with business justification
- Documenting architectural erosion, coupling, or duplication

## Debt Categories

| Type                    | Examples                                             | Risk                     |
| ----------------------- | ---------------------------------------------------- | ------------------------ |
| **Code debt**           | Duplicated logic, poor abstractions, magic numbers   | Bugs, slow development   |
| **Architecture debt**   | Monolith that should be split, wrong data store      | Scaling limits           |
| **Test debt**           | Low coverage, flaky tests, missing integration tests | Regressions ship         |
| **Dependency debt**     | Outdated libraries, unmaintained dependencies        | Security vulns           |
| **Documentation debt**  | Missing runbooks, outdated READMEs, tribal knowledge | Onboarding pain          |
| **Infrastructure debt** | Manual deploys, no monitoring, no IaC                | Incidents, slow recovery |
| **Operational debt**    | Missing alerts, manual processes, poor observability | Slow incident response   |

## Prioritization Model

Rank debt by:

1. **Impact × Risk × (6 − Effort)** — Score each item on Impact (1-5), Risk (1-5), Effort (1-5,
   inverted). Formula: Priority = (Impact + Risk) × (6 - Effort)
2. **Delivery drag**: how much it slows feature work
3. **Incident risk**: how likely it causes failures
4. **Change frequency**: how often the area changes
5. **Blast radius**: how much breaks if it fails

Address debt where all four are high.

## Debt Record Template

```markdown
# Debt Record: {title}

## Problem

{What is wrong now?}

## Impact

- Delivery drag:
- Risk:
- Scope:

## Evidence

- Files/modules:
- Incidents/bugs:
- Test gaps:

## Remediation Options

1. Minimal containment
2. Local refactor
3. Broader redesign

## Recommendation

{Chosen path and why}
```

## Anti-Patterns

- "We'll clean it up later" without a debt record
- Bundling debt cleanup into unrelated features with no scope control
- Large refactors without specs, tests, or rollback plan
- Treating documentation debt as low priority when onboarding or incident recovery suffers

# hook-test: verify multi-file hook with -Command
