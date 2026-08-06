# Release Process

## Prerequisites

Before releasing, ensure your local machine is properly configured:

### MCP Workspace Setup

The MCP workspace (`$HOME\mcp-workspace`) must be initialized for release builds. This provides
hardened, offline-only execution of MCP servers.

**Check if setup**:

```TypeScript
# Verify MCP workspace exists
Test-Path $HOME\mcp-workspace  # Must be True
Get-Content $HOME\mcp-workspace\package-lock.json | ConvertFrom-Json | Out-Null
# Must not error (valid JSON)
```

**If missing**: Follow [FIRST-TIME-SETUP-CHECKLIST.md](FIRST-TIME-SETUP-CHECKLIST.md) Step 3 to
initialize.

### Security Tools

Verify security hardening is in place:

```TypeScript
# Check .npmrc policy loaded
npm config get ignore-scripts  # Should return: true
npm config get min-release-age  # Should return: 3

# Verify no pending vulnerabilities
npm audit  # Should return: 0 vulnerabilities
```

---

## Versioning

Gentle-Vanguard follows [Semantic Versioning](https://semver.org/):

- **MAJOR (x.0.0)**: Breaking changes
- **MINOR (0.x.0)**: New features, no breaking changes
- **PATCH (0.0.x)**: Bug fixes, documentation, minor improvements

## Release Checklist

### 1. Prepare

```TypeScript
# Ensure working tree is clean
git status

# Run full test suite
npm test

# Run audit
.\skills\gentle-vanguard-audit-skill\scripts\audit-sweep.ps1 -Scope full
```

### 2. Update Version

```TypeScript
# Update VERSION file
# Update CHANGELOG.md — move [Unreleased] → [X.Y.Z] - YYYY-MM-DD
# Update version badges in README.md, docs/README.md, marketing/*
# Update TUI installer version in gentle-vanguard-installer-tui.ps1
```

### 2.5 Homologation Gate (Mandatory — auto-runs on publish)

This gate is **automatically executed** by `src/cli/gv.ts publish` before any validation or merge attempt.
If the gate fails, publish is blocked until issues are resolved.

```TypeScript
# Run manually (same check that publish runs internally)
.\scripts\utilities\src/cli/gv.ts release-homologation

# Optional: validate with a specific release tag
.\scripts\utilities\src/cli/gv.ts release-homologation vX.Y.Z

# Skip gate on publish (not recommended — use only for emergencies)
.\scripts\utilities\src/cli/gv.ts publish -SkipHomologationGate
```

Expected outcome:

- Same release baseline in both repos (VERSION aligned)
- `main` and `develop` aligned with their remotes in both repos
- No forced tag rewrites required

### 3. Commit & Tag

```TypeScript
git add -A
git commit -m "chore: release vX.Y.Z - <summary of changes>"
git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"
```

### 4. Merge to Develop

```TypeScript
git checkout develop
git merge main --no-edit
git checkout main
```

### 5. Push

```TypeScript
git push origin main
git push origin develop
git push origin vX.Y.Z
```

### 6. Sync Public Repo

```TypeScript
.\scripts\utilities\DEPLOYMENT\sync-to-public.ps1
```

This step is a distribution/homologation stage. It complements release creation and should run after
the core release checks above are green.

Then from the public repo:

```TypeScript
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 7. Create GitHub Release (Optional)

```TypeScript
gh release create vX.Y.Z --title "vX.Y.Z" --notes "See CHANGELOG.md"
```

## Branch Strategy

- `main` — stable, production-ready
- `develop` — integration branch (fast-forward from main on release)
- `feat/*` — feature branches
- `fix/*` — bug fix branches
- `chore/*` — maintenance branches

See [BRANCH-STRATEGY.md](BRANCH-STRATEGY.md) for full details.
