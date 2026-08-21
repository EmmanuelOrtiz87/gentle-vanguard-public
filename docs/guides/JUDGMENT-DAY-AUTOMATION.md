# Judgment Day Automation Guide

## Overview

Judgment Day automation integrates the dual-review protocol with git hooks and the session
orchestrator to ensure code quality before push and merge operations.

**Objetivo**: Ejecutar automticamente Judgment Day antes de PR merge, integrar con git hooks, fallar
PR si Judgment Day falla, y requerir aprobacin de ambos reviewers.

## Architecture

```

                    SESSION START
              (session-autostart.cmd)




         Judgment Day Orchestrator Initialize
     (judgment-day-orchestrator.ps1 -Action initialize)

   Register git hooks (pre-push, pre-merge-commit)
   Setup event bus subscriptions
   Create logging directories
   Load configuration






   PRE-PUSH HOOK         PRE-MERGE HOOK
  (git push)             (git merge)




  Judgment Day Orchestrator
  (run-judgment -Scope changed_files)
  (run-judgment -Scope pr_files)

   Launch Judge A (async)
   Launch Judge B (async)
   Synthesize verdict
   Apply fixes if needed
   Re-judge until convergence





 APPROVED   ESCALATED


  PUSH      BLOCK MERGE
```

## Configuration Files

### 1. `config/judgment-day-automation.json`

Core automation rules for pre-push and pre-merge execution.

```json
{
  "automation_rules": {
    "pre_push": {
      "enabled": true,
      "fail_on_critical": true,
      "max_iterations": 2
    },
    "pre_merge": {
      "enabled": true,
      "require_both_reviewers": true,
      "fail_on_critical": true,
      "fail_on_real_warnings": true
    }
  }
}
```

### 2. `config/judgment-day-orchestrator-config.json`

Orchestrator integration and workflow coordination.

```json
{
  "workflow_stages": {
    "pre_push": { ... },
    "pre_merge": { ... },
    "session_start": { ... }
  },
  "reviewer_coordination": {
    "require_both_reviewers": true,
    "reviewer_approval_threshold": 2
  }
}
```

## Git Hooks

### Pre-Push Hook (`.git/hooks/pre-push`)

Executes before `git push`:

- Detects changed files
- Logs push event
- Triggers Judgment Day orchestrator
- Blocks push if CRITICAL issues found

### Pre-Merge Hook (`.git/hooks/pre-merge-commit`)

Executes before `git merge`:

- Detects files to merge
- Logs merge event
- Ensures both reviewers approved
- Blocks merge if issues found

## Workflow

### 1. Session Initialization

```bash
# Automatically runs on session start
.\tools\session-autostart.cmd

# Output:
# [INFO] Initializing Judgment Day automation...
# [JUDGMENT-DAY] Initializing Judgment Day automation...
# [JUDGMENT-DAY] Registering git hooks...
# [JUDGMENT-DAY]  pre-push hook registered
# [JUDGMENT-DAY]  pre-merge-commit hook registered
# [JUDGMENT-DAY] Initialization complete
```

### 2. Pre-Push Workflow

```bash
git push origin feature/my-feature

# Triggers:
# [JUDGMENT-DAY] Pre-push hook initiated
# [JUDGMENT-DAY] Branch: feature/my-feature
# [JUDGMENT-DAY] Changed files: 3
# [JUDGMENT-DAY] Running Judgment Day review...
# [JUDGMENT-DAY] Judge A: Working...
# [JUDGMENT-DAY] Judge B: Working...
# [JUDGMENT-DAY] Verdict: 2 CRITICAL issues found
# [JUDGMENT-DAY] Applying fixes...
# [JUDGMENT-DAY] Re-judging...
# [JUDGMENT-DAY] Verdict: APPROVED
# [JUDGMENT-DAY] Push allowed
```

### 3. Pre-Merge Workflow

```bash
git merge feature/my-feature

# Triggers:
# [JUDGMENT-DAY] Pre-merge hook initiated
# [JUDGMENT-DAY] Files to merge: 5
# [JUDGMENT-DAY] Checking reviewer approvals...
# [JUDGMENT-DAY] Reviewer 1:  Approved
# [JUDGMENT-DAY] Reviewer 2:  Approved
# [JUDGMENT-DAY] Running Judgment Day review...
# [JUDGMENT-DAY] Verdict: APPROVED
# [JUDGMENT-DAY] Merge allowed
```

## Commands

### Check Status

```TypeScript
.\scripts\utilities\judgment-day-orchestrator.ps1 -Action status

# Output:
# [JUDGMENT-DAY] Status Report
# ================================
# Configuration: Loaded
#   Pre-push enabled: True
#   Pre-merge enabled: True
# Git Hooks:
#    pre-push hook installed
#    pre-merge-commit hook installed
# Recent Sessions:
#   judgment-day-2026-04-23-14-30-45: approved
```

### Initialize Manually

```TypeScript
.\scripts\utilities\judgment-day-orchestrator.ps1 -Action initialize
```

### Check PR Status

```TypeScript
.\scripts\utilities\judgment-day-orchestrator.ps1 -Action check-pr
```

### Run Judgment Day

```TypeScript
.\scripts\utilities\judgment-day-orchestrator.ps1 -Action run-judgment -Scope pr_files
```

## decisión Tree

### No Issues Found

- **Status**: APPROVED
- **Action**: Allow push/merge
- **Message**: Code passes Judgment Day review

### CRITICAL Issues Found

- **Status**: BLOCK
- **Action**: Block push/merge
- **Message**: CRITICAL issues must be fixed
- **Auto-fix**: No (requires manual intervention)

### Real WARNINGs Found

- **Status**: BLOCK (pre-merge only)
- **Action**: Block merge
- **Message**: Real WARNINGs must be fixed
- **Auto-fix**: Yes (if enabled)

### Theoretical WARNINGs Found

- **Status**: INFO
- **Action**: Allow push/merge
- **Message**: Theoretical WARNINGs reported
- **Auto-fix**: No

### Suggestións Found

- **Status**: SUGgestión
- **Action**: Allow push/merge
- **Message**: Suggestións for improvement
- **Auto-fix**: Yes (if enabled)

## Reviewer Requirements

### Both Reviewers Must Approve

- Reviewer 1: Approval required
- Reviewer 2: Approval required
- Approval pattern: `LGTM`, `Approved`, ``
- Self-approval: Not allowed

### PR Labels

- `judgment-day-approved`: Judgment Day passed
- `judgment-day-failed`: Judgment Day failed
- `judgment-day-pending`: Judgment Day in progress
- `judgment-day-escalated`: Judgment Day escalated

## Escalation Policy

### After 2 Fix Iterations

If issues remain after 2 fix iterations:

1. Ask user: "Continue iterating or escalate?"
2. If YES: Continue fix+judge cycle (max 5 total iterations)
3. If NO: Escalate to manual review

### Escalation Actions

- Flag PR as `judgment-day-escalated`
- Require manual reviewer decisión
- Log escalation reason
- Notify team

## Logging

### Log Location

```
.session/judgment-day-logs/
 pre-push-2026-04-23-14-30-45.log
 pre-merge-2026-04-23-14-31-20.log
 judgment-day-2026-04-23-14-30-45.json
 ...
```

### Log Format

```
=== JUDGMENT DAY PRE-PUSH ===
Timestamp: 2026-04-23-14-30-45
Branch: feature/my-feature
Changed files:
  src/auth.go
  src/db.go
  tests/auth_test.go
=== END PRE-PUSH LOG ===
```

## Integration Points

### Event Bus

Publishes events:

- `judgment-day-initiated`
- `judgment-day-judges-started`
- `judgment-day-verdict-ready`
- `judgment-day-fixes-applied`
- `judgment-day-approved`
- `judgment-day-escalated`

### Session Orchestrator

- Coordinates with workflow stages
- Updates session status
- Tracks Judgment Day results

### CI/CD

- Fails build on Judgment Day failure
- Reports results to CI system
- Blocks merge on CI failure

## Best Practices

### 1. Keep Judgment Day Enabled

Always keep pre-push and pre-merge automation enabled for production branches.

### 2. Review Findings Carefully

Even if Judgment Day auto-fixes issues, review the fixes to ensure correctness.

### 3. Require Both Reviewers

Always require both reviewers to approve before merge to catch edge cases.

### 4. Monitor Escalations

Track escalated Judgment Days to identify patterns and improve code quality.

### 5. Archive Logs

Regularly archive old logs to keep `.session/judgment-day-logs` clean.

## Troubleshooting

### Pre-Push Hook Not Running

```bash
# Make hook executable
chmod +x .git/hooks/pre-push

# Verify hook exists
ls -la .git/hooks/pre-push
```

### Pre-Merge Hook Not Running

```bash
# Make hook executable
chmod +x .git/hooks/pre-merge-commit

# Verify hook exists
ls -la .git/hooks/pre-merge-commit
```

### Configuration Not Loaded

```TypeScript
# Check config file exists
Test-Path config/judgment-day-automation.json

# Validate JSON
Get-Content config/judgment-day-automation.json | ConvertFrom-Json
```

### Judgment Day Not Initializing

```TypeScript
# Run initialization manually
.\scripts\utilities\judgment-day-orchestrator.ps1 -Action initialize

# Check status
.\scripts\utilities\judgment-day-orchestrator.ps1 -Action status
```

## References

- **Judgment Day Skill**: `skills/judgment-day/SKILL.md`
- **Project Orchestrator**: `skills/project-orchestrator-skill/SKILL.md`
- **Git Workflow**: `skills/git-workflow-skill/SKILL.md`
- **Code Review**: `skills/code-review-orchestrator-skill/SKILL.md`
