# Artifact Retention Policy

## Overview

Gentle-Vanguard automatically manages artifact retention to balance **historical context** with
**repository cleanliness**. The system keeps recent files in the repo for AI agent context while
archiving older files locally.

## Retention Limits

| Category         | Repo (Git) | Local Archive | Purpose                 |
| ---------------- | ---------- | ------------- | ----------------------- |
| **Audits**       | 5 files    | 30 files      | Weekly trend analysis   |
| **Sessions**     | 1 file     | 30 files      | Current session context |
| **Code Reviews** | 1 file     | 30 files      | Latest review reference |

### Why These Limits?

- **5 Audits**: Allows AI agents to analyze weekly patterns, velocity trends, and recurring issues
- **1 Session**: Only the active session-start is needed for current context
- **30 Local**: Provides 1-2 months of history for manual reference without bloating the repo

## Configuration

Edit `config/artifacts-retention.json`:

```json
{
  "defaultMaxRepo": 1,
  "defaultMaxLocal": 30,
  "categories": {
    "audits": {
      "maxRepo": 5,
      "maxLocal": 30
    },
    "sessions": {
      "maxRepo": 1,
      "maxLocal": 30
    }
  }
}
```

## Automation

### Automatic Triggers

Rotation runs automatically during:

- `end-session` - Session closure
- `day-end-closure` - End-of-day wrap-up

### Manual Execution

```TypeScript
# Run with config file defaults
.\scripts\utilities\rotate-artifacts.ps1

# Override limits temporarily
.\scripts\utilities\rotate-artifacts.ps1 -MaxRepoFiles 3 -MaxLocalFiles 20

# Force rotation (bypass safety checks)
.\scripts\utilities\rotate-artifacts.ps1 -Force

# Use custom config
.\scripts\utilities\rotate-artifacts.ps1 -ConfigPath "C:\path\to\custom-config.json"
```

## Directory Structure

```
docs/
 audits/                      # Active audits (kept in git)
    2026-04-17-125757-audit.md
    2026-04-17-125605-audit.md
    ... (up to 5 files)
 sessions/                    # Active sessions (kept in git)
    2026-04-17-143636-session-start.md
 .local-archive/              # Archived files (gitignored)
     audits/
        ... (up to 30 files)
     sessions/
         ... (up to 30 files)
```

## AI Agent Context

### How Agents Use Artifacts

1. **Audit Analysis** (5 files):
   - Compare current vs past audit results
   - Identify recurring issues
   - Track velocity trends
   - Analyze AI usage patterns

2. **Session Context** (1 file):
   - Current session brief
   - Active task scope
   - Session goals

3. **Historical Research**:
   - Agents can access `.local-archive/` for deeper history
   - Manual reference for troubleshooting

### Best Practices for Agents

```markdown
## When analyzing project health:

1. Read latest 5 audits from `docs/audits/`
2. Compare metrics across time period
3. If deeper context needed, check `.local-archive/audits/`

## When starting new task:

1. Read current session brief from `docs/sessions/`
2. Update session brief as scope changes
3. Archive on session close (automatic)
```

## Safety Features

### Pre-Rotation Checks

The rotation script includes safety mechanisms:

1. **Non-artifact change detection**: Blocks rotation if there are uncommitted changes in other
   `docs/` files
2. **Force override**: Use `-Force` flag to bypass checks
3. **Error handling**: Continues on individual file errors, reports at end

### Bypassing Safety

```TypeScript
# Only use -Force when:
# - You've already committed other docs changes
# - You're sure about the rotation
# - Emergency cleanup needed

.\scripts\utilities\rotate-artifacts.ps1 -Force
```

## Metrics CSV Files

CSV metrics files in `docs/sessions/metrics/` are **NOT rotated**:

- `agent-usage.csv`
- `context-usage.csv`
- `token-guard-usage.csv`

These files are append-only and critical for long-term trend analysis.

## Troubleshooting

### Rotation Not Running

```TypeScript
# Check if script exists
Test-Path scripts\utilities\rotate-artifacts.ps1

# Check config file
Test-Path config\artifacts-retention.json

# Run with verbose output
.\scripts\utilities\rotate-artifacts.ps1 -Verbose
```

### Too Many Files in Repo

```TypeScript
# Force immediate rotation
.\scripts\utilities\rotate-artifacts.ps1 -Force

# Verify result
git status
```

### Archived Files Missing

```TypeScript
# Check archive directory
ls docs\.local-archive\

# Check .gitignore (should include .local-archive/)
cat .gitignore | Select-String "local-archive"
```

## versión History

| versión | Date       | Changes                                       |
| ------- | ---------- | --------------------------------------------- |
| 1.0.0   | 2026-04-17 | Initial policy: 5 audits, 1 session, 30 local |

## Related Documents

- [`ARCHITECTURE.md`](../reference/ARCHITECTURE.md) - Dual-scope retention model
- [`SESSION-GUIDE.md`](./SESSION-GUIDE.md) - Session lifecycle
- [`audit-system.md`](./audit-system.md) - Audit generation details
