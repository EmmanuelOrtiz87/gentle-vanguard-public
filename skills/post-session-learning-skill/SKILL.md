---
name: post-session-learning
description: >
  Post-session learning analysis — detects patterns, identifies gaps, proposes improvements.
  Trigger: "post-session", "learning", "auto-aprendizaje", "improvement proposals", "mejora continua"
license: Apache-2.0
metadata:
  author: gv version: '1.0'
  allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task, EngramMemSave
---

# Post-Session Learning Skill

## When to Use

AFTER completing significant work, before or during session closure:

1. User triggers "cerrar sesion", "close session", "guardar sesion"
2. After `mem_session_summary` is saved
3. Before `mem_session_end`

## Learning Analysis Workflow

### Step 1 — Collect Session Data

```powershell
pwsh -NoProfile -File scripts/utilities/session-learning-capture.ps1 -Trigger close
```

This script reads:

- `scripts/.session/startup-summary.json` — platform, tool, peak hour
- Recent engram session summary — what was accomplished
- Git log for the session — files changed, patterns
- Past improvement proposals — what was already identified

### Step 1b — Update Skill Usage Metrics

```powershell
pwsh -NoProfile -File scripts/skills/usage-tracker.ps1
pwsh -NoProfile -File scripts/skills/usage-tracker.ps1 -Nudge
```

Scans all registered skills and initializes or updates `.session/skill-usage/*.json` files.
The `-Nudge` flag checks for auto-nudge conditions (3+ failures, declining success rate).

### Step 1c — Generate Skill Nudges

```powershell
pwsh -NoProfile -File scripts/skills/skill-nudge.ps1 -SessionDir ".session"
```

Reads usage metrics, identifies skills with failure patterns in the current session,
and generates structured nudge JSON files in `.session/skill-nudges/`.

### Step 2 — Analyze for Gaps

The script returns structured data. Review these categories:

| Category                | What to Look For                                  | Action                      |
| ----------------------- | ------------------------------------------------- | --------------------------- |
| **Missing skills**      | User asked for something not covered by any skill | Create new skill            |
| **Repeated errors**     | Same command failed multiple times                | Fix script or config        |
| **Config gaps**         | Configuration that would have saved tokens        | Update config               |
| **Token waste**         | Commands that failed and were retried             | Add OS check, doc, or guard |
| **Pattern opportunity** | Repetitive manual steps                           | Create skill or script      |

### Step 3 — Generate Proposals

For each identified gap, create a structured proposal saved to
`.local/improvement-proposals/YYYY-MM-DD-proposal-N.json`:

```json
{
  "id": "prop-2026-05-14-001",
  "date": "2026-05-14",
  "category": "missing-skill",
  "severity": "medium",
  "description": "User asked for X but no skill covers it",
  "evidence": "Session logs show 3 requests for X",
  "proposedAction": "Create skills/business/X-skill/SKILL.md",
  "autoApply": false,
  "applied": false
}
```

### Step 4 — Apply or Queue

- **Auto-apply**: If severity is `low` and `autoApply` is true, apply immediately
- **Queue**: If severity is `medium`/`high`, save for user review
- **Already fixed**: If proposal matches a previous one that was applied, skip

### Step 4b — Auto-Apply Skill Patches

```powershell
pwsh -NoProfile -File scripts/skills/skill-auto-patch.ps1 -AutoApply
```

Reads `.session/skill-nudges/*.json` for pending nudge recommendations.
Appends a "## Known Issues" section to the skill's SKILL.md for urgent or repeated failures.
Use `-Report` flag for a dry run without applying.

### Step 5 — Save Learnings

```powershell
# Save key findings to engram for cross-session memory
engram_mem_save -title "Learning: {key finding}" -type "learning"
```

## Integration Points

- **Session close**: Run automatically during session closure (step between summary and end)
- **Manual trigger**: User can run `gv learning` to analyze current session anytime
- **Proposal executor**: Run `gv learning apply` to auto-execute pending proposals (scaffold skills, patch configs)
- **Auto mode**: `gv learning auto` runs analysis + auto-applies low-severity proposals in one step
- **PR mode**: `gv learning auto-pr` auto-applies + creates a git branch and commit with changes
- **Startup check**: At session start, check `.local/improvement-proposals/` for pending items

## Command Flow

```
session-learning-capture.ps1  →  usage-tracker.ps1  →  skill-nudge.ps1  →  skill-auto-patch.ps1  →  mem_save
```

## Output Files

| File                                              | Purpose                              |
| ------------------------------------------------- | ------------------------------------ |
| `.local/improvement-proposals/*.json`             | Structured improvement proposals     |
| `.local/improvement-proposals/learning-log.jsonl` | Append-only log of all learning runs |
| `.session/skill-usage/*.json`                     | Per-skill usage metrics              |
| `.session/skill-nudges/*.json`                    | Auto-generated nudge recommendations |
