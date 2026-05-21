---
name: usage-metrics-skill
description: >
  Tracks skill usage, failure patterns, and effectiveness across sessions.
  Trigger: "usage metrics", "skill usage", "effectiveness", "failure pattern", "auto-nudge"
license: Apache-2.0
metadata:
  author: gv version: '1.0'
  allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Usage Metrics Skill

## When to Use

- During session close to record skill usage data
- After a skill execution to increment counters
- When a skill fails, to register failure patterns
- To generate nudge recommendations for underperforming skills
- To auto-patch skills with recurring failures

## Usage Data Schema

Skills register usage data in `.session/skill-usage/{skillName}.json`:

```json
{
  "skillName": "skill-name",
  "useCount": 0,
  "lastUsedAt": null,
  "failureCount": 0,
  "failurePatterns": [],
  "avgTokensUsed": 0,
  "successRate": 1.0,
  "lastOutcome": null
}
```

## Failure Pattern Schema

```json
{
  "skillName": "skill-name",
  "failures": [
    {
      "timestamp": "ISO date",
      "errorType": "timeout|syntax|logic|missing_dependency",
      "description": "brief description",
      "fixApplied": null
    }
  ]
}
```

## Auto-Nudge Triggers

| Condition                                      | Action                                      |
| ---------------------------------------------- | ------------------------------------------- |
| 3+ failures in current session                 | Generate nudge with `urgent: false`         |
| 10+ uses with declining success rate           | Generate nudge with `urgent: false`         |
| Same failure pattern across 3+ sessions        | Generate nudge with `urgent: true`          |
| Success rate below 0.5 after 5+ attempts       | Generate nudge with `urgent: true`          |

## Reference Scripts

| Script                         | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `scripts/skills/usage-tracker.ps1`     | Increment/record usage per skill              |
| `scripts/skills/skill-nudge.ps1`       | Generate post-session nudge recommendations   |
| `scripts/skills/skill-auto-patch.ps1`  | Auto-apply urgent patches to SKILL.md files   |

## Integration Points

- **Session close**: Usage tracker runs automatically, then nudge, then auto-patch
- **Manual trigger**: Run `scripts/skills/usage-tracker.ps1 -Report` for summary
- **Nudge review**: Run `scripts/skills/skill-nudge.ps1 -SessionId current`
- **Auto-patch dry-run**: Run `scripts/skills/skill-auto-patch.ps1 -Report`
