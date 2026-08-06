# Gentle-Vanguard Release Strategy

## Overview

This document defines how Gentle-Vanguard versións, releases, and manages backward compatibility
across versións.

## Semantic versióning (SemVer 2.0.0)

Gentle-Vanguard adheres to **[Semantic versióning](https://semver.org/)**: `MAJOR.MINOR.PATCH`

```
v1.0.0
           PATCH: bug fixes, security patches, minor improvements
       MINOR: backward-compatible new features, governance enhancements
   MAJOR: breaking changes, architecture shifts, incompatible APIs
```

### versión Increment Rules

| Scenario   | When                                                                | Example                              |
| ---------- | ------------------------------------------------------------------- | ------------------------------------ |
| MAJOR bump | Breaking changes to CLI, script API, or governance model            | v1.0.0 v2.0.0 (new release strategy) |
| MINOR bump | New skills, new SDD policy, new features, governance clarifications | v1.0.0 v1.1.0 (SDD gate tightened)   |
| PATCH bump | Bug fixes, security patches, documentation corrections              | v1.0.0 v1.0.1 (fixed src/cli/gv.ts bug)     |

### Examples

- **v1.0.0 v1.1.0**: Add 5 new skills; upgrade to SDD enforcement via CI gate (new but
  backward-compatible)
- **v1.1.0 v1.1.1**: Fix src/cli/gv.ts path issue; security patch in pre-commit (bug fixes)
- **v1.1.1 v2.0.0**: Change branch strategy from `develop+main` to trunk-based; remove
  `scripts/project/` folder (architecture shift)

## Release Cadence & Types

### Release Types

#### 1. **Stable Release (Recommended)**

- Created from `main` branch
- Tag format: `v1.0.0`, `v1.2.0`, `v2.1.0`
- Process: accumulate validated work on `develop`, open a release PR to `main`, then tag from `main`
- Supported for at least 3 subsequent minor versións
- **Current strategy**: develop-first with stable releases cut when a coherent batch is ready

#### 2. **Prerelease (Optional)**

- Created from feature branches or `develop`
- Tag format: `v1.1.0-beta.1`, `v1.1.0-rc.1`
- For broad early testing before stable release
- Not recommended for production use
- Visibility: Pre-releases listed separately on GitHub

#### 3. **Hotfix Release (Urgent)**

- Created from `main` for critical security/stability issues
- Branch: `hotfix/issue-description`
- PATCH versión bump (e.g., v1.0.0 v1.0.1)
- Merged back to `main` and `develop`
- Process: hotfix on branch PR to main tag PR same commit to develop

## Breaking Changes & Deprecation Policy

### Deprecation Path

When removing or changing a feature:

1. **Announce deprecation** in CHANGELOG under current versión: "Deprecated: `gv old-cmd` will be
   removed in v2.0.0"
2. **Emit warnings** in CLI/scripts when deprecated feature is used
3. **Maintain for 2+ minor versións** (e.g., deprecate in v1.1, remove in v2.0, but support in v1.2,
   v1.3)
4. **Document migration path** in MIGRATION.md

### Breaking Change Examples

**Scenario 1: CLI Command Removed**

```
v1.0.0: gv verify                          (stable)
v1.1.0: Deprecate gv verify in favor of gv validate
        gv verify still works with warning
v1.2.0: gv verify still works with warning (support continues)
v2.0.0: gv verify removed completely       (breaking change in MAJOR)
```

**Scenario 2: Governance Model Changes**

```
v1.0.0: SDD optional (advisory only)
v1.1.0: SDD mandatory for PRs (breaking for strict enforcement)
         Warrant MINOR bump because it's a governance change, not API change
```

## Compatibility & Support Matrix

| versión | Status | Support Until | Go    | Node | Python | TypeScript |
| ------- | ------ | ------------- | ----- | ---- | ------ | ---------- |
| v1.0.0  | Stable | v1.3 released | 1.19+ | 18+  | 3.9+   | 7+         |
| v1.1.0+ | Stable | TBD           | 1.19+ | 18+  | 3.9+   | 7+         |
| v2.0.0  | Future | TBD           | 1.20+ | 20+  | 3.11+  | 7+         |

**Support Rule**: Maintain backward compatibility for at least 2 minor versións after a breaking
change is announced.

## Branch Strategy for Release

### Git Flow (Current)

```
main (stable release branch)    GitHub Release points here

   Receives only release/* and hotfix/* PRs

develop (integration and publication branch)

   Receives feature/*, bugfix/*, chore/* PRs and frequent publication

Hotfix (if critical)
hotfix/*    main  (tag)
           develop
```

### Release Process (Develop -> Main -> Tag)

```bash
# 1. Ensure develop is ready
git checkout develop
git pull origin develop

# 2. Update CHANGELOG: [Unreleased]  [1.0.0]
# (manually edit or use script)

# 3. Create release branch and PR to main
git checkout -b release/v1.0.0
git add CHANGELOG.md
git commit -m "chore(release): prepare v1.0.0"
git push origin release/v1.0.0

# Use gh or GitHub UI to create PR: release/v1.0.0 -> main

# 4. Merge PR (squash or merge commit both ok)
gh pr merge <number> --squash

# 5. Tag on main
git checkout main
git pull origin main
git tag -a v1.0.0 -m "Release v1.0.0: First stable release"
git push origin v1.0.0

# 6. GitHub Release created automatically (or manual)
gh release create v1.0.0 --generate-notes

# 7. Sync back to develop (required after release)
git checkout develop
git merge main
git push origin develop
```

## Release Trigger Threshold

Cut a stable release when at least one of these conditions is met:

- `develop` accumulated 8-12 validated publications since the last stable tag.
- 3-5 coherent backlog items are complete and documented.
- A governance, security, or architecture change should not wait longer than 10-14 days.

Do not cut a release only by count. The batch must also pass `gv judgment-day`, have an updated
CHANGELOG, and be understandable as a single release story.

## Checklist Before Release

See [`RELEASE-CHECKLIST.md`](./RELEASE-CHECKLIST.md) for pre-release validation.

**Minimum**:

- [ ] CHANGELOG updated with all changes
- [ ] All governance tests pass
- [ ] Documentation updated
- [ ] No uncommitted changes on `develop`
- [ ] Multi-repo homologation gate passes: `./src/cli/gv.ts release-homologation`

## versióning Governance

### Who Decides versión Number?

- **Project Lead** (you) decides and documents in CHANGELOG before release
- **AI Agent** (me) implements the release process
- **Consumers** (Dashboard) pin to a specific versión or use "latest v1.\*"

### Where versión is Declared

- `git tag v1.0.0` Primary source of truth in Git
- `CHANGELOG.md` What changed in this versión
- `versión.txt` (optional) Can store versión for scripts if needed

### No Hardcoded versión in Code

Gentle-Vanguard does NOT store versión in `src/cli/gv.ts` or source files.

- Reason: Sync risk between code and git tags
- Instead: Query git tag at runtime if needed: `git describe --tags --abbrev=0`

## FAQ

**Q: When should I release?**

- After 8-12 validated publications to `develop`, if they form a coherent release batch
- After completing 3-5 significant backlog items with updated docs and changelog
- Immediately for security/stability fixes as a hotfix on `main`

**Q: Can I skip versións?**

- No. Always increment sequentially (v1.0.0 v1.1.0 v2.0.0)
- Reason: Consumers rely on predictable upgrade paths

**Q: What if develop is behind main?**

- Normally shouldn't happen; merge release back to develop after tagging
- If it does: `git merge main` on develop and push

**Q: How do consumers use this?**

- **Pin versión**: `git clone... && git checkout v1.0.0`
- **Latest stable**: Clone main directly
- **Follow minor updates**: Pin to v1.\* and update manually or via sync

---

**Next**: See [RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md) for step-by-step release validation.
