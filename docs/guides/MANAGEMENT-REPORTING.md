# Management Reporting System

Unified reporting system for Gentle-Vanguard.

## Overview

Single CSV file per month containing ALL workspace activity metrics for executive visibility and
decisión-making.

Dashboard integration:

- Executive dashboard snapshot is generated as part of monthly CI and uploaded as artifact.
- See `DASHBOARD-EXECUTIVE-GUIDE.md` for complete interpretation details.

## Architecture decisión

**Unified approach**: The on-demand documentation system has been integrated into this single CSV
reporting system. This is the ONLY reporting system - no separate processes.

## Report Format

**File**: `reports/MANAGEMENT-REPORT-YYYY-MM.csv`

**Columns** (14 total):

1. SessionID - Unique session identifier
2. Date - Session date (YYYY-MM-DD)
3. User - Who ran the session
4. Project - Project worked on
5. TokensIn - Input tokens consumed
6. TokensOut - Output tokens generated
7. SkillsUsed - Skills loaded (semicolon-separated)
8. SystemsTriggered - Autonomous systems activated
9. ActionsPerformed - What was done
10. Outcome - COMPLETE/ESCALATED/PENDING
11. IssuesFound - Number of issues found
12. Duration(min) - Session duration in minutes
13. Cost(USD) - Estimated cost (tokens rate)
14. Notes - Additional context

## Monthly Rotation

When month changes:

1. Script notifies: " Month changed! Export reports/MANAGEMENT-REPORT-YYYY-MM.csv"
2. User exports old file (Excel-ready, filterable)
3. Run with `-ForceNewMonth` to create new empty file
4. New file starts fresh for new month

This preserves history (one file per month) without data loss.

## Usage

### Automated (post-session hook)

Configured in `opencode.json`:

```json
"post_session": {
  "enabled": true,
  "script": "src/telemetry/generate-management-report.ts"
<!-- REF-OBSOLETA: src/telemetry/generate-management-report.ts no existe (ruta migrada o eliminada) -->
}
```

### Automated (CI)

- `.github/workflows/monthly-management-report.yml` generates monthly report and
  `reports/dashboard.html`.
- `.github/workflows/dashboard-auto-refresh.yml` refreshes dashboard daily and on relevant pushes to
  `main`.

### On-Demand

```TypeScript
# Generate/update current month report
.\scripts\utilities\TELEMETRY-METRICS\generate-management-report.ps1

# Force new month (after exporting old file)
.\scripts\utilities\TELEMETRY-METRICS\generate-management-report.ps1 -ForceNewMonth

# On-demand mode (same as automated, but explicit)
.\scripts\utilities\TELEMETRY-METRICS\generate-management-report.ps1 -OnDemand
```

## Data Sources

- `.session/*.json` - Session data, duration, outcome
- `.telemetry/*.json` - Token usage, initialization data
- Engram memory - Skills used, actions performed, issues
- `scripts/adaptive/*` - Autonomous system triggers

## Benefits for Management

- **Single Source**: One CSV = all metrics
- **Filterable**: By date, user, project, outcome in Excel
- **Traceability**: Session ID Engram CSV Management
- **Cost Tracking**: Token usage USD conversión
- **Historical**: One file per month, never overwritten
- **Excel-Ready**: No special tools needed

## Migration from On-Demand System

The previous on-demand documentation system has been:

- **Integrated**: All on-demand requests now logged to CSV
- **Unified**: Single system instead of multiple processes
- **Preserved**: Historical on-demand data remains in Engram

## Skill

Management reporting skill: `~/.config/opencode/skills/management-reporting-skill/SKILL.md`

**Triggers**: "management report", "generar informe", "reporte gerencial", "CSV report"
