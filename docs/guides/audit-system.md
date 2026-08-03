# Audit System

## Overview

The audit system captures and stores structured records of AI-assisted development activity directly
in the project repository. This provides transparency, metrics, and compliance tracking without
requiring a central platform.

## Quick Start

The system runs **automatically** - no manual intervention required:

```TypeScript
# Just finalize your session normally
.\scripts\finalize-session.ps1

# The system automatically:
# 1. Closes the session audit
# 2. Aggregates daily metrics
# 3. Generates weekly report (if Sunday/Monday)
```

## How It Works

```

                    AUDIT WORKFLOW


start-session.ps1           finalize-session.ps1



 Session Start             Session End

 - Timestamp              - Capture metrics
 - User info             - Git changes
 - AI tools              - Lines added/removed




                           Automatic Processing

                           - Session saved
                           - Daily metrics
                           - Weekly report       (Sun/Mon only)




                           docs/ Directory

                           audits/
                           sessions/metrics/

```

## Directory Structure

```
docs/
 audits/                # Audit reports (Markdown)
    2026-04-15-202322-audit.md
 sessions/
     metrics/           # Aggregated metrics (CSV)
         agent-usage.csv
         context-usage.csv
         token-guard-usage.csv
```

## Automatic Execution

| When                     | What           | Output               |
| ------------------------ | -------------- | -------------------- |
| `start-session.ps1`      | Session starts | Session file created |
| `finalize-session.ps1`   | Session ends   | Metrics captured     |
| Every finalize (Sun/Mon) | Weekly report  | Report generated     |

## Manual Commands

```TypeScript
# View session audit
.\scripts\generate-session-audit.ps1 -Start
.\scripts\generate-session-audit.ps1 -End

# View metrics (CSV)
Import-Csv docs/sessions/metrics/context-usage.csv | Format-Table

# Generate report manually
.\scripts\generate-audit-report.ps1 -Period weekly

# Aggregate specific period
.\scripts\aggregate-metrics.ps1 -Period monthly
```

## Data Captured

### Session Records

| Field     | Description                             |
| --------- | --------------------------------------- |
| timestamp | Session start time                      |
| user      | Developer machine and username          |
| aiTools   | Usage per tool (requests, tokens)       |
| activity  | Actions, files modified, lines changed  |
| metrics   | Duration, files created/updated/deleted |

### Metrics (CSV)

- **agent-usage.csv:** Agent invocation counts and durations
- **context-usage.csv:** Context pack efficiency metrics
- **token-guard-usage.csv:** Token budget tracking

### Reports

- **Velocity:** Commits, lines of code, files, PRs
- **AI Usage:** Requests per tool, tokens consumed
- **Costs:** Estimated API costs with projections

## Reports

### Weekly Report Contents

Generated automatically on Sundays/Mondays:

- Executive summary with key metrics
- Activity highlights (top contributors, most used actions)
- Pull request statistics
- AI effectiveness metrics
- Cost analysis and projections
- OKR/KPI alignment

### Report Distribution

| Audience        | Report Type | Contents                     |
| --------------- | ----------- | ---------------------------- |
| Product Owners  | Weekly      | Sprint progress, AI adoption |
| Technical Leads | Weekly      | Detailed metrics, quality    |
| Management      | Monthly     | Executive summaries, trends  |

## OKR/KPI Integration

The metrics directly support development KPIs:

| KPI                  | Metric Source                    |
| -------------------- | -------------------------------- |
| Development Velocity | `docs/sessions/metrics/` CSVs    |
| AI Adoption Rate     | Session count with AI usage      |
| Code Quality         | Issues found/resolved in reviews |
| Cost Management      | Audit report cost sections       |

## Archival Process

Historical audit files are archived to `docs/.local-archive/audits/` for retention. Archives
preserve historical data while keeping the active `docs/audits/` directory focused on recent work.

## Privacy

- Only metadata is stored (not code content)
- User-identifiable info is limited to username
- No prompts or AI responses are captured
- Data stays within the project repository

## Troubleshooting

### No sessions found

```TypeScript
# Check if docs/audits directory exists
Test-Path docs/audits

# Run audit manually
.\scripts\generate-session-audit.ps1 -Start
```

### Report not generating

```TypeScript
# Check day of week
(Get-Date).DayOfWeek
# Reports only generate on Sunday or Monday

# Generate manually
.\scripts\generate-audit-report.ps1 -Period weekly
```

## Best Practices

1. Run `finalize-session.ps1` consistently at end of work
2. Review weekly reports with team
3. Track trends over time
4. Use insights to optimize AI tool usage
