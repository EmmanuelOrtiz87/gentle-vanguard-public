# Development Workflow

## Overview

This document defines the standardized development workflow for all projects using Gentleman
Gentle-Vanguard.

## Branch Strategy

```
main (stable release)

develop (default integration and publication)

feature/* / bugfix/* / chore/*
```

### Branch Types

| Branch      | Purpose             | Protection            |
| ----------- | ------------------- | --------------------- |
| `main`      | Stable release cut  | Required PR + review  |
| `develop`   | Daily integration   | Required PR + review  |
| `feature/*` | New features        | PR after completion   |
| `bugfix/*`  | Bug fixes           | PR after completion   |
| `chore/*`   | Maintenance         | PR after completion   |
| `hotfix/*`  | Urgent fixes        | Direct commit allowed |
| `release/*` | Release preparation | Direct commit allowed |

### GitFlow Enforcement

1. Protected branch direct push (`main`, `develop`) is blocked by default.
2. Allowed branch naming is enforced: `feature/*`, `bugfix/*`, `chore/*`, `hotfix/*`, `release/*`.
3. Expected PR base is enforced:

- `feature/*`, `bugfix/*`, `chore/*` -> `develop`
- `hotfix/*`, `release/*` -> `main`

### Publication Mode

1. `develop` is the default branch for day-to-day publication, CI validation, and frequent pushes.
2. `main` is reserved for release PRs, hotfixes, and semver tags.
3. CI push validation runs on `develop`; PR validation still runs for `develop` and release PRs
   targeting `main`.
4. For public repositories, this keeps rapid iteration on `develop` while preserving a clean release
   gate on `main`.

### Single-User Emergency Bypass

1. For `gentle-vanguard` and `gentle-vanguard-public`, the repository owner can keep a ruleset
   bypass actor on `develop` for emergency unblock scenarios.
2. This does not simulate a second reviewer; it enables administrative bypass when GitHub review
   policy blocks a time-critical merge.
3. Session autostart enforces this setting automatically through
   `scripts/utilities/SESSION-MANAGEMENT/ensure-github-bypass.ps1`.
4. Recommended usage: keep normal PR + checks flow by default; use bypass only when explicitly
   needed to avoid workflow deadlocks.

## Session Workflow

### 1. Start Session

```markdown
1. mem_context # Check memory
2. git status # Current branch
3. Load skills # Based on stack
4. Present status # Project, todos, next step
```

### 2. During Work

```markdown
1. Execute with loaded skills
2. Update todos
3. Verify each step
4. Run tests locally
```

### 3. Before End

```markdown
1. src/cli/gv.ts review # Code review
2. src/cli/gv.ts audit # Audit document
3. Validate specification
4. Ask: Create PR?
5. src/cli/gv.ts publish # Full publish flow with gated merge decisión
```

## Commit Convention

```
<type>(<scope>): <description>

feat:     New feature
fix:      Bug fix
docs:     Documentation
refactor: Code refactoring
test:     Adding tests
chore:    Maintenance
ci:       CI/CD changes
```

### Examples

```bash
feat(auth): add OAuth2 login
fix(api): handle null response
test(dashboard): add metrics tests
docs(readme): update installation
```

## Code Review Process

### Trigger Points

- Before any PR
- Manual: `src/cli/gv.ts review`
- Automatic: Pre-commit hook

### 7 Dimensions

| #   | Dimension     | Scope                    | Auto | Blocking      |
| --- | ------------- | ------------------------ | ---- | ------------- |
| 1   | Security      | Secrets, vulnerabilities | Yes  | CRITICAL/HIGH |
| 2   | Quality       | Code smells, patterns    | Yes  | HIGH          |
| 3   | Architecture  | Structure, design        | No   | MEDIUM        |
| 4   | Testing       | Coverage, quality        | No   | MEDIUM        |
| 5   | Documentation | README, comments         | No   | LOW           |
| 6   | API Design    | REST, validation         | No   | MEDIUM        |
| 7   | Git Workflow  | Commits, branches        | No   | LOW           |

### Severity Actions

| Severity | Icon | Action             | Blocking |
| -------- | ---- | ------------------ | -------- |
| CRITICAL | [X]  | Block immediately  | Yes      |
| HIGH     | [!]  | Must fix before PR | Yes      |
| MEDIUM   | [-]  | User choice        | No       |
| LOW      | [*]  | Optional           | No       |

### Findings decisión

```
CRITICAL/HIGH found:
-> Must fix before proceeding

MEDIUM found:
-> Option A: Fix now (recommended)
-> Option B: Fix after PR
-> Option C: Document as tech debt

LOW found:
-> Optional fixes
-> Can proceed with PR
```

## Audit Document

Generated automatically with `src/cli/gv.ts audit`.

### Structure

```markdown
# Audit Document - [DATE]

## Summary

## Git Information

## Commits

## Tests Status

## Findings

## Specification

## Next Steps
```

## Pull Request Process

### Checklist

- [ ] All tests pass
- [ ] Code review completed
- [ ] No CRITICAL/HIGH findings
- [ ] Audit document generated
- [ ] Specification validated
- [ ] Documentation updated

### PR Description Template

See: `templates/PULL_REQUEST_TEMPLATE.md`

### PR Merging

```bash
# Squash merge into develop (recommended for feature branches)
gh pr merge --squash

# Merge with commit into main (for release or hotfix branches)
gh pr merge --admin --merge
```

### Controlled Publish decisión

Use `src/cli/gv.ts publish` for end-to-end execution with governance gates:

1. If validations pass with no alerts, PR merge is authorized automatically.
2. If alerts are detected, a summary + suggestións are shown.
3. If suggestións are accepted, automated fixes are applied and the flow re-runs.
4. If suggestións are rejected, a final explicit confirmation is required to merge with gaps under
   developer responsibility.
5. Every decisión path is documented in `docs/sessions/*-publish-decisión.md`.

## Automation

### Scripts

| Script           | Purpose                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `src/cli/gv.ts review`  | Run code review                                                                       |
| `src/cli/gv.ts audit`   | Generate audit document                                                               |
| `src/cli/gv.ts pr`      | Create PR template                                                                    |
| `src/cli/gv.ts push`    | Prepare for push                                                                      |
| `src/cli/gv.ts publish` | Validate, summarize alerts, apply suggestións, and merge according to decisión policy |
| `src/cli/gv.ts status`  | Show current status                                                                   |

### Hooks

| Hook         | Trigger      | Actions                                                               |
| ------------ | ------------ | --------------------------------------------------------------------- |
| `pre-commit` | `git commit` | Secrets scan, format check                                            |
| `pre-push`   | `git push`   | Native review + GitFlow policy + governance + homologation drift gate |
| `commit-msg` | `git commit` | Commit message validation                                             |

## Tools

### CLI Tools

```TypeScript
# Workflow CLI
.\scripts\utilities\src/cli/gv.ts <command>

# Gentle-Vanguard CLI
gv validate
gv list
gv update
gv check
```

### Git Aliases

Add to `~/.gitconfig`:

```ini
[alias]
    st = status
    co = checkout
    br = branch
    ci = commit
    unstage = reset HEAD --
    last = log -1 HEAD
    visual = log --graph --oneline --decorate --all
```

## Best Practices

### Do

- Always create feature branches
- Run `src/cli/gv.ts review` before PR
- Generate audit document on push
- Use conventional commits
- Keep PRs small and focused
- Update documentation

### Don't

- Commit directly to main/develop
- Skip code review
- Push without audit
- Leave CRITICAL/HIGH findings
- Merge PRs without approval

## Quick Reference

```bash
# Start work
git checkout -b feature/my-feature

# During work
.\scripts\utilities\src/cli/gv.ts review
go test ./...
npm test

# Before commit
git add .
git commit -m "feat(scope): description"

# Before push
.\scripts\utilities\src/cli/gv.ts audit
git push -u origin feature/my-feature

# Create PR
gh pr create
```

## Support

- Gentle-Vanguard: `~/.gentleman/`
- Documentation: `docs/`
- Skills: `.skills/`
- Scripts: `scripts/`
