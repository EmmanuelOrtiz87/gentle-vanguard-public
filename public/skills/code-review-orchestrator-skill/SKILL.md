---
name: code-review-orchestrator
description:
  'Trigger: code review, review all, quality check, orchestrator, full review, check code, analyze
  code, audit code. Unified code quality and security review system across 7 dimensions.'
metadata:
  source: GV-native
---

## Activation Contract

Triggered on pre-commit hook or when user says "code review", "review all", "quality check", "audit
code", "orchestrator", or similar.

## Hard Rules

- MUST run Security + Quality quick scan on every pre-commit
- MUST run all 7 dimensions pre-merge
- MUST block commit on CRITICAL findings (exit code 1)
- MUST generate a report at docs/code-reviews/
- MUST classify every finding by severity
- MUST NOT modify source files during review
- MUST keep quick scan under 30 seconds

## Decision Gates

| Gate            | Options                                                      | Rule                                   |
| --------------- | ------------------------------------------------------------ | -------------------------------------- |
| Scope           | all, security, quality, testing, docs, api, git, quick, full | quick = Security+Quality; full = all 7 |
| Severity action | CRITICAL block, HIGH warn+review, MEDIUM info, LOW suggest   | CRITICAL always blocks (exit 1)        |
| Trigger         | pre-commit auto vs manual                                    | Auto runs quick scope only             |

## Execution Steps

1. Detect trigger (pre-commit hook or manual request)
2. Resolve scope — quick (Security+Quality) or full (all 7)
3. Load config from configs/review-config.json
4. Execute scans for selected dimensions
5. Classify each finding by severity
6. Generate report (console + file at docs/code-reviews/)
7. Block if CRITICAL found (exit 1), otherwise allow (exit 0)

## Output Contract

Return severity breakdown, categorized issues (file:line, description, recommendation), report file
path, and exit code (1 if blocked).

## References

- `references/seven-dimensions.md` — Dimension descriptions and scope mapping
- `references/severity-matrix.md` — Severity levels with actions
- `references/commands.md` — Full command reference and performance
- `references/report-format.md` — Console and file report templates
- `references/judgment-day.md` — Dual review protocol
- `references/config-example.md` — Review configuration JSON
- `references/integration.md` — Git hooks and CI/CD setup

> **See also**: [code-review-skill](../code-review-skill/SKILL.md) for structured
> security/performance/correctness reviews
