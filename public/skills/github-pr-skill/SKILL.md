---
name: github-pr
description: >
  Create high-quality Pull Requests with conventional commits and proper descriptions. Trigger: When
  creating PRs, writing PR descriptions, or using gh CLI for pull requests.
metadata:
  author: gentle-vanguard
  versión: '1.0'
metadata:
  source: GV-native
---

## When to Use

- Creating a new Pull Request
- Writing PR titles and descriptions
- Preparing commits for review
- Using `gh pr create` command

---

## Critical Patterns

### PR Title = Conventional Commit (native-tools branch-pr adapted)

```
<type>(<scope>): <short description>

feat        New feature
fix         Bug fix
docs        Documentation
refactor   Code refactoring
test        Adding tests
chore       Maintenance
build        Build system
ci          CI configuration
style       Formatting (no logic change)
perf        Performance improvement
revert      Reverts a previous commit
```

**Breaking changes**: Add `!` after type: `feat(auth)!: rename config flag`

### Cognitive Budget (native-tools branch-pr rule)

- **Max 400 changed lines** (`additions + deletions`) per PR
- **Request `size:exception`** if unavoidable (with rationale documented)
- **Review time**: Design each PR for ≤60-minute human review

### PR Labels (native-tools branch-pr rule)

- **Exactly ONE `type:*` label** per PR:
  - `type:bug` → Bug fix
  - `type:feature` → New feature
  - `type:docs` → Documentation
  - `type:refactor` → Code refactoring
  - `type:chore` → Maintenance/tooling
  - `type:breaking-change` → Breaking change
- CI automatically rejects PRs with zero or multiple type labels

### PR Description Structure

```markdown
## Summary

- 1-3 bullet points explaining WHAT and WHY

## Changes

- List main changes

## Testing

- [ ] Tests added/updated
- [ ] Manual testing done

Closes #123
```

### Atomic Commits

```bash
# Good: One thing per commit
git commit -m "feat(user): add User model"
git commit -m "feat(user): add UserService"
git commit -m "test(user): add UserService tests"

# Bad: Everything in one commit
git commit -m "add user feature"
```

---

## Code Examples

### Basic PR Creation

```bash
gh pr create \
  --title "feat(auth): add OAuth2 login" \
  --body "## Summary
- Add Google OAuth2 authentication

## Changes
- Added AuthProvider component
- Created useAuth hook

Closes #42"
```

### PR with HEREDOC (Complex Description)

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
