# Day End Closure Process

## Purpose

This guide explains how to properly close a work session or end-of-day for maximum knowledge
retention and continuity.

Two modes available:

1. **Automatic**: Triggered by system events (scheduled or on shell exit)
2. **Manual**: Explicitly run when ready to close the day

## Quick Start

### Manual Closure (Explicit)

```TypeScript
# Close the day with full automation: closure artifact + validation + Engram capture
.\scripts\utilities\src/cli/gv.ts day-end-closure

# Or run end-session separately if you prefer more control
.\scripts\utilities\src/cli/gv.ts end-session
```

### What Gets Captured

1. **Delivery Closure Artifact** (`docs/sessions/*delivery-closure-*.md`)
   - Review results
   - Audit results
   - Governance validation
   - Git state snapshot
   - Pending action checklist

2. **Closure Report** (`docs/sessions/closure-report-*.md`)
   - Timestamp and owner
   - Stage completion status
   - Repository state
   - Artifacts summary

3. **Engram Memory** (Persistent)
   - Session summary with key learnings
   - All discoveries and decisións
   - Files changed during session
   - Status: session marked complete for continuity

## Architecture

```
Day End Closure Flow

 Stage 1: Operational Closure (end-session.ps1)
    Review: Check code quality
    Audit: Generate audit document
    Governance: Validate structure compliance

 Stage 2: Workspace Validation (validate-script-governance.ps1)
    Checks policy compliance, tool availability

 Stage 3: Memory Capture (Engram)
    Session summary saved
    Learnings persisted
    Session marked complete

 Stage 4: Report Generation
     Creates closure-report-*.md artifact
```

## Files Involved

| File                                    | Purpose                                    | Trigger                   |
| --------------------------------------- | ------------------------------------------ | ------------------------- |
| `scripts/utilities/day-end-closure.ps1` | Main orchestrator for daily closure        | Manual or automatic       |
<!-- REF-OBSOLETA: scripts/utilities/day-end-closure.ps1 no tiene equivalente TS (migración PS1→TS) -->
| `scripts/utilities/end-session.ps1`     | Operational checks and artifact generation | Called by day-end-closure |
<!-- REF-OBSOLETA: scripts/utilities/end-session.ps1 no tiene equivalente TS (migración PS1→TS) -->
| `src/cli/gv.ts`                         | CLI entry point                            | User command              |
| `docs/sessions/`                        | Artifact storage                           | Auto-created on closure   |

## Manual Execution Examples

### Close day with full checks

```TypeScript
.\scripts\utilities\src/cli/gv.ts day-end-closure
```

### Skip validation (fast closure)

```TypeScript
.\scripts\utilities\src/cli/gv.ts day-end-closure -SkipValidation
```

### Bypass Engram capture (operational only)

```TypeScript
.\scripts\utilities\src/cli/gv.ts day-end-closure -SkipEngram
```

### Force closure even with failures

```TypeScript
.\scripts\utilities\src/cli/gv.ts day-end-closure -Force
```

## Automatic Closure (Future)

Currently manual-trigger only. To enable automatic closure:

### Option A: Scheduled Task (Windows)

```TypeScript
# Create scheduled task to run at shift end (e.g., 5:30 PM)
$trigger = New-ScheduledTaskTrigger -Daily -At "17:30"
$action = New-ScheduledTaskAction -Execute "TypeScript" -Argument "-NoProfile -ExecutionPolicy Bypass -File .\gentle-vanguard\\scripts\utilities\src/cli/gv.ts day-end-closure -Quiet"
Register-ScheduledTask -TaskName "Gentleman-DayEndClosure" -Trigger $trigger -Action $action
```

### Option B: TypeScript Profile Hook

```TypeScript
# Add to your $PROFILE to run on shell exit
Register-EngineEvent -SourceIdentifier TypeScript.Exiting -Action {
    Push-Location ".\gentle-vanguard"
    & .\scripts\utilities\src/cli/gv.ts day-end-closure -Quiet -AutoTriggered
    Pop-Location
} | Out-Null
```

### Option C: Git Hook (On Commit)

```bash
#!/bin/bash
# .git/hooks/post-commit or .git/hooks/post-push
# Runs closure at end of major commits

if [[ $(($(date +%H)*100 + $(date +%M))) -ge 1700 ]]; then
    pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts day-end-closure -Quiet
fi
```

## What Happens Automatically on Resume

When you start the next session:

1. **Tools Auto-Activate**
   - TypeScript profile detects Gentle-Vanguard project
   - `ensure-tools-active.ps1` runs in background
   - Required and optional tools verified from workspace policy (engram, skills, AI runtime)

2. **Context Restores**
   - `src/cli/gv.ts start-session` (or manual entry) loads prior Engram context
   - Session memory available for AI agents
   - Findings and learnings from yesterday are loaded

3. **Status Shows Where You Left Off**
   - `src/cli/gv.ts status` displays pending from prior session
   - Delivery artifacts remain visible
   - Continue work without context loss

## Session Lifecycle

```
START SESSION                END OF DAY

gv start-session          gv day-end-closure

[WORK]                    [Operational Checks]

Engram captures           [Workspace Validation]
learnings during
                         [Memory Capture]
[More work]
                         Reports & Artifacts
Developer choice:         Generated
 Manual closure         Ready for resume
 Auto closure
 Continue to next session
```

## Best Practices

1. **Do not close sessions with unpublished changes**
   - `end-session.ps1` now enforces publication policy by default.
   - Closure is blocked when there are uncommitted changes, no upstream, or local commits ahead of
     upstream.
   - Recommended flow: `src/cli/gv.ts publish` before closure.
   - Explicit override only when intentional: `src/cli/gv.ts end-session -AllowUnpublishedClose`.

1. **Run day-end-closure before truly leaving for the day**
   - Ensures all learnings are captured
   - Validates state before next session
   - Prevents context loss

1. **Use explicit session IDs if tracking multiple projects**

   ```TypeScript
   .\scripts\utilities\src/cli/gv.ts day-end-closure -SessionId "bitbucket-dashboard-2026-04-14"
   ```

1. **Keep closure artifacts for audit trail**
   - Never delete `docs/sessions/closure-report-*.md`
   - Useful for retrospectives and root cause analysis

1. **Monitor closure reports weekly**
   - Check `closure-report-*.md` for patterns
   - High failure rates may indicate process issues
   - Use as input for process improvements

## Troubleshooting

### Closure cannot save to Engram

**Expected behavior**: `day-end-closure` now calls Engram directly and saves:

1. `session-summary:<session_id>` observation
2. `session-end:<session_id>` observation

**Checks**:

```TypeScript
# Verify launcher and CLI
.\scripts\utilities\run-engram.ps1 --help

# Inspect recent project context
.\scripts\utilities\run-engram.ps1 context gentle-vanguard
```

**Fallback (manual save)**:

```TypeScript
engram save "session-summary:<session_id>" "<summary_text>" --project gentle-vanguard
engram save "session-end:<session_id>" "<end_message>" --project gentle-vanguard
```

### Delivery closure artifact not created

**Check**: Verify end-session.ps1 ran successfully.

```TypeScript
# Run end-session explicitly to debug
.\scripts\utilities\end-session.ps1 -Verbose
```

### Validation failures block closure

**Allow**: Use `-Force` to proceed despite validation issues for now.

```TypeScript
.\scripts\utilities\src/cli/gv.ts day-end-closure -Force
```

## See Also

- [Session Guide](SESSION-GUIDE.md) Daily workflow orchestration
- [DEVELOPER-COMMUNICATION-POLICY.md](DEVELOPER-COMMUNICATION-POLICY.md) Response modes and
  escalation
- [TOOL-ACTIVATION.md](TOOL-ACTIVATION.md) Tool setup and verification
