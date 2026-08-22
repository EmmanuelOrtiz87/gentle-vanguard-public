---
name: branch-pr
description: >
  PR creation workflow for Agent Teams Lite following the issue-first enforcement system. Trigger:
  When creating a pull request, opening a PR, or preparing changes for review.
license: Apache-2.0
metadata:
  author: gentle-vanguard
  versión: '2.0'
metadata:
  source: GV-native
---

## When to Use

Use this skill when:

- Creating a pull request for any change
- Preparing a branch for submission
- Helping a contributor open a PR

---

## Critical Rules

1. **Every PR MUST link an approved issue** no exceptions
2. **Every PR MUST have exactly one `type:*` label**
3. **Automated checks must pass** before merge is possible
4. **Blank PRs without issue linkage will be blocked** by GitHub Actions

---

## Workflow

```
1. Verify issue has `status:approved` label
2. Create branch: type/description (see Branch Naming below)
3. Implement changes with conventional commits
4. Run shellcheck on modified scripts
5. Open PR using the template
6. Add exactly one type:* label
7. Wait for automated checks to pass
```

---

## Branch Naming

Branch names MUST match this regex:

```
^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$
```

**Format:** `type/description` lowercase, no spaces, only `a-z0-9._-` in description.

| Type        | Branch pattern           | Example                         |
| ----------- | ------------------------ | ------------------------------- |
| Feature     | `feat/<description>`     | `feat/user-login`               |
| Bug fix     | `fix/<description>`      | `fix/zsh-glob-error`            |
| Chore       | `chore/<description>`    | `chore/update-ci-actions`       |
| Docs        | `docs/<description>`     | `docs/installation-guide`       |
| Style       | `style/<description>`    | `style/format-scripts`          |
| Refactor    | `refactor/<description>` | `refactor/extract-shared-logic` |
| Performance | `perf/<description>`     | `perf/reduce-startup-time`      |
| Test        | `test/<description>`     | `test/add-setup-coverage`       |
| Build       | `build/<description>`    | `build/update-shellcheck`       |
| CI          | `ci/<description>`       | `ci/add-branch-validation`      |
| Revert      | `revert/<description>`   | `revert/broken-setup-change`    |

---

## PR Body Format

The PR template is at `.github/PULL_REQUEST_TEMPLATE.md`. Every PR body MUST contain:

### 1. Linked Issue (REQUIRED)

```markdown
Closes #<issue-number>
```

Valid keywords: `Closes #N`, `Fixes #N`, `Resolves #N` (case insensitive). The linked issue MUST
have the `status:approved` label.

### 2. PR Type (REQUIRED)

Check exactly ONE in the template and add the matching label:

| Checkbox            | Label to add           |
| ------------------- | ---------------------- |
| Bug fix             | `type:bug`             |
| New feature         | `type:feature`         |
| Documentation only  | `type:docs`            |
| Code refactoring    | `type:refactor`        |
| Maintenance/tooling | `type:chore`           |
| Breaking change     | `type:breaking-change` |

### 3. Summary

1-3 bullet points of what the PR does.

### 4. Changes Table

```markdown
| File           | Change       |
| -------------- | ------------ |
| `path/to/file` | What changed |
```

### 5. Test Plan

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
