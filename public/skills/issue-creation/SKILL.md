---
name: issue-creation
description: >
  Issue creation workflow for Agent Teams Lite following the issue-first enforcement system.
  Trigger: When creating a GitHub issue, reporting a bug, or requesting a feature.
license: Apache-2.0
metadata:
  author: gentle-vanguard
  versión: '1.0'
metadata:
  source: GV-native
---

## When to Use

Use this skill when:

- Creating a GitHub issue (bug report or feature request)
- Helping a contributor file an issue
- Triaging or approving issues as a maintainer

---

## Critical Rules

1. **Blank issues are disabled** MUST use a template (bug report or feature request)
2. **Every issue gets `status:needs-review` automatically** on creation
3. **A maintainer MUST add `status:approved`** before any PR can be opened
4. **Questions go to Discussions** of the project repository, not issues

---

## Workflow

```
1. Search existing issues for duplicates
2. Choose the correct template (Bug Report or Feature Request)
3. Fill in ALL required fields
4. Check pre-flight checkboxes
5. Submit  issue gets status:needs-review automatically
6. Wait for maintainer to add status:approved
7. Only then open a PR linking this issue
```

---

## Issue Templates

### Bug Report

Template: `.github/ISSUE_TEMPLATE/bug_report.yml` Auto-labels: `bug`, `status:needs-review`

#### Required Fields

| Field                  | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| **Pre-flight Checks**  | Checkboxes: no duplicate + understands approval workflow                    |
| **Bug Description**    | Clear description of the bug                                                |
| **Steps to Reproduce** | Numbered steps to reproduce                                                 |
| **Expected Behavior**  | What should have happened                                                   |
| **Actual Behavior**    | What happened instead (include errors/logs)                                 |
| **Operating System**   | Dropdown: macOS, Linux variants, Windows, WSL                               |
| **Agent / Client**     | Dropdown: Claude Code, OpenCode, Gemini CLI, Cursor, Windsurf, Codex, Other |
| **Shell**              | Dropdown: bash, zsh, fish, Other                                            |

#### Optional Fields

| Field                  | Description                               |
| ---------------------- | ----------------------------------------- |
| **Relevant Logs**      | Log output (auto-formatted as code block) |
| **Additional Context** | Screenshots, workarounds, extra info      |

#### Example Bug Report via CLI

```bash
gh issue create --template "bug_report.yml" \
  --title "fix(scripts): setup.sh fails on zsh with glob error" \
  --body "
### Pre-flight Checks
- [x] I have searched existing issues and this is not a duplicate
- [x] I understand this issue needs status:approved before a PR can be opened

### Bug Description
Running setup.sh on zsh throws a glob error when no matching files exist.

### Steps to Reproduce
1. Clone the repo
2. Run \`./scripts/setup.sh\` in zsh
3. See error: \`zsh: no matches found: skills/*\`

### Expected Behavior
The script should handle missing glob matches gracefully.

### Actual Behavior
Script crashes with glob error.

### Operating System
macOS

### Agent / Client
Claude Code

### Shell
zsh

### Relevant Logs
\`\`\`
zsh: no matches found: skills/*
\`\`\`
"
```

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
