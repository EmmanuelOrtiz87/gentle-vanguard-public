# Gentle-Vanguard Release Checklist

Use this checklist every time before publishing a release to ensure consistency, completeness, and
quality.

## Pre-Release Validation (1-2 hours)

### Documentation & Changelog

- [ ] **CHANGELOG.md Updated**
  - [ ] `[Unreleased]` section renamed to `[X.Y.Z] - YYYY-MM-DD`
  - [ ] All changes grouped: Added, Changed, Deprecated, Removed, Fixed, Security
  - [ ] Links section at bottom includes `[X.Y.Z]` URL
  - [ ] Spellcheck completed
  - [ ] Technical accuracy verified (versións, tool names correct)

- [ ] **README.md Current**
  - [ ] Prerequisites reflect current tool versións
  - [ ] Installation steps tested on fresh clone
  - [ ] Quick-start commands work (or noted as manual-only)
  - [ ] Links point to correct branches/docs

- [ ] **MIGRATION.md (if applicable)**
  - [ ] If MAJOR versión bump: migration guide from previous major versión
  - [ ] If new deprecations: clear upgrade path documented
  - [ ] Examples provided (before/after code)
  - [ ] CLI command changes listed

### Governance Validation

- [ ] **Git Workflow**
  - [ ] `develop` branch is clean (no uncommitted changes): `git status`
  - [ ] `develop` is up-to-date with origin: `git pull origin develop`
  - [ ] No stray feature branches with critical code
  - [ ] All PR merges complete and squashed/cleaned up

- [ ] **Code Quality**
  - [ ] Pre-push governance checks pass: `.\scripts\project\project-pre-push.ps1`
  - [ ] SDD governance passes: `.\scripts\diagnostics\validate-sdd-governance.ps1`
  - [ ] Script registry current: `docs/reference/script-registry.md`
  - [ ] No critical TODO/FIXME comments in core scripts

- [ ] **Compatibility**
  - [ ] Scripts tested on Windows 10/11 + TypeScript 7+
  - [ ] Cross-platform paths use forward slashes (or `Join-Path` where needed)
  - [ ] Go versión pinned in `go.mod` matches README prerequisites
  - [ ] Node/Python versións in templates match README

### Skills & Features

- [ ] **Skill Index Updated**
  - [ ] `skills/SKILL_INDEX.md` lists all shipped skills
  - [ ] New skills in this release are documented
  - [ ] Deprecated skills marked as such
  - [ ] Each skill has valid `name`, `description`, `file` path

- [ ] **Core Skills Validated**
  - [ ] `project-orchestrator-skill/SKILL.md` syntax valid
  - [ ] `code-review-orchestrator/SKILL.md` syntax valid
  - [ ] All markdown links working (test 3-5 links)
  - [ ] No circular dependencies in skill imports

### Templates

- [ ] **Project Templates**
  - [ ] At least 3 templates tested (service, frontend, fullstack)
  - [ ] Scaffolded project builds without errors
  - [ ] `.gitignore`, CI config files present
  - [ ] ESLint/TypeScript configs valid

### CI/CD & Automation

- [ ] **GitHub Workflows**
  - [ ] `.github/workflows/*.yml` files are valid YAML
  - [ ] No hardcoded secrets or API keys
  - [ ] Workflows triggered on expected events (push to main/develop, PR, tag)
  - [ ] Recent workflow runs show green

- [ ] **Pre-Commit Hooks**
  - [ ] `.githooks/pre-push` runs without blocking on clean code
  - [ ] `.githooks/post-commit` runs without errors
  - [ ] Secret scanning pattern updated (if applicable)

### Multi-Repo Homologation (Complementary Gate)

Run before tagging:

```TypeScript
.\scripts\utilities\src/cli/gv.ts release-homologation
# Optional tag-aware check:
.\scripts\utilities\src/cli/gv.ts release-homologation vX.Y.Z
```

- [ ] **Version Baseline Alignment**
  - [ ] `VERSION` is aligned in `gentle-vanguard` and `gentle-vanguard-public`
  - [ ] Planned release tag exists only when intentionally created for this release
  - [ ] No tag force-move is required

- [ ] **Branch Alignment**
  - [ ] `main` is clean and up to date in both repos
  - [ ] `develop` is clean and up to date in both repos
  - [ ] Post-release propagation plan `main -> develop` is confirmed for both repos

- [ ] **Distribution Consistency**
  - [ ] `sync-to-public.ps1` reviewed for expected artifacts (protected/public/docs/bootstrap)
  - [ ] Public repo does not contain plain-text protected assets

### Security & Terms

- [ ] **License & CODEOWNERS**
  - [ ] LICENSE file present and unchanged (or updated if needed)
  - [ ] CODEOWNERS file current (if using code ownership rules)
  - [ ] No security warnings from GitHub:
        https://github.com/EmmanuelOrtiz87/gentle-vanguard/security

- [ ] **No Secrets Exposed**
  - [ ] Run `git log --all --full-history --oneline` and scan for suspicious commits
  - [ ] Or use: `gitleaks detect --source git --verbose` (if available)
  - [ ] Example: no API keys, tokens, passwords in commits

### Documentation Completeness

- [ ] **Reference Docs**
  - [ ] `docs/reference/SUITE-OVERVIEW.md` describes all major components
  - [ ] `docs/reference/project-types.md` current with scaffold types
  - [ ] `docs/reference/script-registry.md` includes all scripts
  - [ ] `docs/guides/` folder has at least 3-5 guides (getting-started, deployment, troubleshooting,
        etc.)

- [ ] **Architecture Docs**
  - [ ] `docs/reference/ARCHITECTURE.md` or equivalent architecture overview is present and current
  - [ ] Gentle-Vanguard-Dashboard homologation documented (if applicable)
  - [ ] Skill distribution model documented

---

## Release Execution (30 minutes)

### Step 1: Create Release Branch

```TypeScript
cd .\gentle-vanguard
git checkout -b release/v1.0.0
```

### Step 2: Update CHANGELOG

Edit `CHANGELOG.md`:

- Change `## [Unreleased]` to `## [1.0.0] - 2026-04-13`
- Ensure all changes are listed
- Add link at bottom:
  `[1.0.0]: https://github.com/EmmanuelOrtiz87/gentle-vanguard/releases/tag/v1.0.0`

### Step 3: Commit Release

```TypeScript
git add CHANGELOG.md
git commit -m "chore(release): prepare v1.0.0 - Gentle-Vanguard stable release"
git push -u origin release/v1.0.0
```

### Step 4: Create & Merge Release PR

```TypeScript
gh pr create --base main --head release/v1.0.0 \
  --title "chore(release): v1.0.0 - First stable Gentle-Vanguard release" \
  --body "## Release: v1.0.0

First stable release of Gentle-Vanguard.

### What's Included
- AI orchestration framework
- Skill distribution model
- SDD governance enforcement
- Global-vs-repo boundary protocols
- Gentle-Vanguard-Dashboard homologation

See CHANGELOG.md for full details.

### Ready for
- Production use
- Consumer adoption (Dashboard, etc.)
"
```

Merge PR:

```TypeScript
gh pr merge <number> --squash --delete-branch
```

### Step 5: Tag Release

```TypeScript
git checkout main
git pull origin main
git tag -a v1.0.0 -m "Release v1.0.0: First stable release of Gentle-Vanguard"
git push origin v1.0.0
```

Verify:

```TypeScript
git tag -l v1.0.0 -n5
```

### Step 6: Create GitHub Release

```TypeScript
gh release create v1.0.0 --target main \
  --title "v1.0.0 - Gentle-Vanguard Stable Release" \
  --notes "First stable release. See CHANGELOG.md for full details."
```

Or use GitHub UI: https://github.com/EmmanuelOrtiz87/gentle-vanguard/releases/new

### Step 7: Sync Back to Develop (Optional)

```TypeScript
git checkout develop
git pull origin develop
git merge main
git push origin develop
```

---

## Post-Release (1 hour)

### Communication

- [ ] **Announce Release** (pick one or all):
  - [ ] GitHub Discussions: Create announcement post
  - [ ] README badge updated with versión link
  - [ ] Email/Slack notification to team

- [ ] **Update Dependent Projects**
  - [ ] Dashboard: If using Gentle-Vanguard skills, note that v1.0.0 is available
  - [ ] Workspace root docs: Link to v1.0.0 release

### Feedback & Monitoring

- [ ] **Monitor for Issues** (next 24-48 hours):
  - [ ] GitHub Issues: Watch for bug reports
  - [ ] Pre-commit hook: Ensure no new failures from consumers
  - [ ] Skill usage: Track if new consumers start using v1.0.0

- [ ] **Next Backlog**
  - [ ] Move resolved items from FF-001..FF-006 to "done" status
  - [ ] Add new items from user feedback
  - [ ] Pin next release date (target v1.1.0 for when 3+ new features ready)

---

## Rollback Plan (If Critical Issue Found)

If a critical bug is found post-release:

```TypeScript
# Option 1: Issue a hotfix (v1.0.1)
git checkout main
git pull origin main
# Fix bug
git checkout -b hotfix/critical-bug
# Make fix
git push origin hotfix/critical-bug
# Create PR hotfix/critical-bug  main
# After merge:
git tag -a v1.0.1 -m "Hotfix: Critical bug fix"
git push origin v1.0.1

# Option 2: Yank release (if catastrophic)
gh release delete v1.0.0
git push origin :v1.0.0  # Delete tag from remote
```

---

**Ready to release? Run this checklist, confirm all boxes, then proceed to Release Execution
section.**
