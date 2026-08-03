# Judgment Guide

## Overview

The Judgment system provides automated auditing, quality validation, and self-healing capabilities
for the Gentle-Vanguard stack.

## Quick Start

```TypeScript
# Run full judgment with remediation
.\scripts\utilities\invoke-judgment.ps1 -Scope Full -Remediate

# Run quick judgment (no critic/remediation)
.\scripts\utilities\invoke-judgment.ps1 -Scope Quick

# Run bounded Judgment Day flow (max 3 passes, asks before extra pass)
.\scripts\utilities\judgment-day.ps1 -MaxPasses 3
```

## Default Pass Policy

Judgment Day now runs with a bounded policy to avoid loops:

1. Default max passes: **3**
2. After each non-approved pass, it shows findings and suggestións
3. It asks the user whether to run another pass or stop

Connection/credential issues for unconfigured providers (Difi/Bedrock/other external providers) are
treated as **warnings** and are not blocking by default.

## How It Works

```

                    JUDGMENT WORKFLOW


invoke-judgment.ps1



 ACTOR Agent    Generates draft-report.md




 CRITIC Agent   Validates against governance rules


        APPROVED  Update dashboard.csv

        REJECTED + Remediate



       REMEDIATOR     Attempts automated fixes



      Re-run Critic (max 3 iterations)
```

## Output Artifacts

| File                                  | Purpose                                    |
| ------------------------------------- | ------------------------------------------ |
| `docs/judgment/dashboard.csv`         | Historical record of all judgment sessions |
| `docs/judgment/draft-report.md`       | Initial analysis by Actor agent            |
| `docs/judgment/final-verdict.md`      | Final verdict from Critic agent            |
| `docs/judgment/remediation-report.md` | Actions taken by Remediator                |

## Dashboard CSV Format

```csv
Timestamp,SessionID,Category,Status,Agent,Message,SLO_ms
2026-04-17T10:30:00,session-001,Governance,OK,CRITIC,All rules met,0
```

### Columns

- **Timestamp:** ISO 8601 timestamp of the check
- **SessionID:** WFS session identifier (or 'manual-run')
- **Category:** Type of check (Initial Scan, Governance, Remediation)
- **Status:** OK, WARN, or FAIL
- **Agent:** Which agent performed the check (ACTOR, CRITIC, REMEDIATOR)
- **Message:** Details about the result
- **SLO_ms:** Execution time in milliseconds (for performance tracking)

## Using Judgment Trends

```TypeScript
# View trends (future implementation)
.\scripts\utilities\gv.ps1 judgment-trends

# This will read dashboard.csv and show:
# - Failure rate over last 7 days
# - Most common failure categories
# - Agent effectiveness metrics
```

## When to Run Judgment

| Scenario                        | Command                  |
| ------------------------------- | ------------------------ |
| Before committing major changes | `-Scope Full -Remediate` |
| Daily health check              | `-Scope Full`            |
| Quick validation                | `-Scope Quick`           |
| After tool updates              | `-Scope Full -Remediate` |

## Troubleshooting

### "File locked" errors

Multiple concurrent executions can lock `draft-report.md`. Wait for previous execution to complete.

### "Judgment stuck" warning

If remediation fails after 3 iterations, run manual recovery:

```TypeScript
.\scripts\utilities\manual-recovery.ps1
```

### Missing session artifact warning

The `*-session-start.md` warning is normal when running judgment outside an active session.
