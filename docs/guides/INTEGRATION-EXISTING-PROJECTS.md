# Integration Guide: Existing Projects

How to integrate Gentle-Vanguard into existing repositories and projects.

## Overview

Gentle-Vanguard is **designed to be additive**, meaning it adds capabilities without modifying
existing code. This guide covers integration into:

- Local repositories
- Cloud repositories (GitHub, Bitbucket, GitLab)
- Projects with existing structure
- Multi-repository environments

## Prerequisites

### Required

| Tool       | versión | Purpose            |
| ---------- | ------- | ------------------ |
| Git        | 2.30+   | versión control    |
| TypeScript | 7+      | Automation scripts |

### Optional (Recommended)

| Tool        | Purpose                                          |
| ----------- | ------------------------------------------------ |
| Go 1.21+    | Go-based tooling (Engram and automation support) |
| Node.js 20+ | Node.js projects                                 |
| Docker      | Containerized development                        |

### Verify Installation

```TypeScript
# Check prerequisites
git --versión
pwsh --versión

# If TypeScript 7 not installed:
winget install Microsoft.TypeScript
```

## Integration Scenarios

### Scenario 1: Local Repository

```
Existing Project          Gentle-Vanguard Integration

C:\my-project\           C:\my-project\
 src/                   src/
 tests/                 tests/
 README.md              README.md (kept)
 package.json           package.json (kept)
                         .audit/ (NEW)
                         AGENTS.md (NEW)
                         scripts/ (NEW)
                         docs/ (NEW)
```

**Steps:**

```TypeScript
# 1. Navigate to your existing project
cd C:\my-existing-project

# 2. Verify it's a Git repository
git status

# 3. Initialize Gentle-Vanguard
.\path\to\gentle-vanguard\\scripts\init-workspace.ps1

# 4. The script will:
#    - Detect existing project structure
#    - Add .audit/ directory
#    - Add AGENTS.md
#    - Configure native workflow tooling
#    - Initialize audit system
```

### Scenario 2: Cloud Repository (Clone + Integrate)

```
GitHub/Bitbucket          Local + Gentle-Vanguard

my-repo.git       my-repo/
                               src/
                               .audit/ (NEW)
                               ...
```

**Steps:**

```TypeScript
# 1. Clone the repository
git clone https://github.com/your-org/your-project.git
cd your-project

# 2. Integrate Gentle-Vanguard
.\path\to\gentle-vanguard\\scripts\init-workspace.ps1

# 3. Commit the Gentle-Vanguard files
git add .
git commit -m "feat: integrate Gentle-Vanguard"
git push
```

### Scenario 3: Multiple Existing Projects

```
C:\Projects\
 project-alpha\       Integrate Gentle-Vanguard
 project-beta\        Integrate Gentle-Vanguard
 project-gamma\      Integrate Gentle-Vanguard
```

**Steps:**

```TypeScript
# Each project is independent
cd C:\Projects\project-alpha
.\path\to\gentle-vanguard\\scripts\init-workspace.ps1

cd C:\Projects\project-beta
.\path\to\gentle-vanguard\\scripts\init-workspace.ps1

# Each project has its own:
# - .audit/ directory
# - AGENTS.md
# - AI configuration
# - Audit history
```

## What Gets Added

### Files Added (Safe - Never Overwrite Existing)

```
Your Project
 .audit/                     NEW: Audit system
    sessions/              Session logs
    metrics/               Aggregated metrics
    reports/                Weekly reports
 AGENTS.md                   NEW: AI agent rules
 scripts/                    NEW: Helper scripts
    init-workspace.ps1     Bootstrap
    finalize-session.ps1    Session end
    ...
 docs/                       NEW: Gentle-Vanguard docs
     audit-system.md
```

### Files That Stay Untouched

```
Your existing files are NEVER modified:
 src/                        NO CHANGE
 tests/                       NO CHANGE
 package.json                 NO CHANGE
 README.md                   NO CHANGE (content kept)
 .gitignore                  NO CHANGE (may merge if needed)
 package-lock.json           NO CHANGE
 ...                         NO CHANGE
```

### Template Files (Optional)

```
You CAN apply project templates to add missing structure:
 templates/project-types/service/
    src/
       main/              Only if you don't have src/main/
    Dockerfile              Only if you don't have one
```

## Handling Conflicts

## Gentle-Vanguard Sync Safety Model

Gentle-Vanguard sync updates only managed assets. It does not overwrite the entire repository.

Rules:

1. Only files listed in `config/gentle-vanguard-sync.json` under `assets` are considered.
2. Strategy `replace` updates drifted managed files during `apply`.
3. Strategy `preserve-local` keeps local files unchanged.
4. For safe rollout, prefer `check` first and `apply -CreatePr` for review.

See: `docs/guides/GENTLE_VANGUARD-SYNC.md` for full behavior and examples.

### What Happens If...

| Conflict                  | Resolution                 |
| ------------------------- | -------------------------- |
| `.audit/` exists          | Skip (keep existing)       |
| `AGENTS.md` exists        | Skip (keep existing)       |
| `scripts/` has same name  | Rename with prefix (`gv-`) |
| `.gitignore` needs update | Merge prompt               |
| Template file exists      | Skip (keep existing)       |

### Force Apply (If Needed)

```TypeScript
# If you want to overwrite existing Gentle-Vanguard files
.\scripts\init-workspace.ps1 -Force

# This will:
# - Overwrite .audit/ if exists
# - Overwrite AGENTS.md if exists
# - Update scripts/
```

## Post-Integration Checklist

```TypeScript
# 1. Verify audit system
Test-Path .audit\sessions

# 2. Verify AI tools configured
claude --versión

# 3. Start a session
.\scripts\generate-session-audit.ps1 -Start

# 4. Make some changes
# ... work normally ...

# 5. Finalize session
.\scripts\finalize-session.ps1

# 6. Verify metrics captured
Get-Content .audit/metrics/daily.json
```

## Project-Specific Configuration

### Adjusting AGENTS.md

Edit `AGENTS.md` to match your project standards:

```markdown
# Project Agent Rules

## Project Context

- Language: TypeScript
- Framework: Next.js 14
- Architecture: App Router

## Code Standards

- Use functional components only
- TypeScript strict mode
- ESLint + Prettier enforced

## AI Tool Configuration

- Default: Claude Sonnet 4
- For complex tasks: Claude Opus 4
```

### Configuring AI Tools

```TypeScript
# Set default AI provider
opencode config set default-model claude-sonnet-4

# Verify configuration
opencode config show

# Test connectivity
claude "Hello, verify you're working"
```

## Multi-Environment Setup

### Development Machine Configuration

```TypeScript
# Local config (not committed)
.env.local
 AI_PROVIDER=claude
 AI_MODEL=claude-sonnet-4
 AUDIT_ENABLED=true
```

### Team Consistency

All team members integrate Gentle-Vanguard the same way:

```TypeScript
# 1. Clone repo
git clone https://github.com/team/project.git

# 2. Run bootstrap
.\scripts\init-workspace.ps1

# 3. Everyone has:
#    - Same AGENTS.md
#    - Same AI configuration
#    - Same audit system
#    - Same code standards
```

## Verification Commands

### Quick Health Check

```TypeScript
# Run validation script
.\scripts\validate-workspace.ps1

# Expected output:
# [OK] Git repository detected
# [OK] Audit system initialized
# [OK] AI tools configured
# [OK] Session tracking active
```

### Detailed Verification

```TypeScript
# 1. Check Gentle-Vanguard files exist
Get-ChildItem .audit/
Get-ChildItem AGENTS.md
Get-ChildItem scripts/

# 2. Check Git configuration
git config --get user.name
git config --get user.email

# 3. Check AI tools
claude --versión
opencode --versión

# 4. Check audit is working
Get-ChildItem .audit/sessions/
```

## Rollback (If Needed)

### Remove Gentle-Vanguard (Keep Code)

```TypeScript
# This removes Gentle-Vanguard but keeps your code
Remove-Item -Recurse .audit/
Remove-Item AGENTS.md
Remove-Item -Recurse scripts/

# Commit the removal
git add .
git commit -m "chore: remove Gentle-Vanguard"
git push
```

### Re-Integrate

```TypeScript
# To bring Gentle-Vanguard back
cd your-project
.\path\to\gentle-vanguard\\scripts\init-workspace.ps1
```

## Troubleshooting

### "Git repository not found"

```TypeScript
# Initialize Git first
git init
git remote add origin your-repo-url
```

### "Permission denied"

```TypeScript
# Check execution policy
Get-ExecutionPolicy

# If restricted:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "AI tools not found"

```TypeScript
# Re-run bootstrap with tool installation
.\scripts\init-workspace.ps1 -RunToolInstallers
```

### "Audit not capturing"

```TypeScript
# Manually start session
.\scripts\generate-session-audit.ps1 -Start

# Check if environment variables are set
$env:WFS_SESSION_ID
$env:WFS_SESSION_FILE
```

## Summary

| Step | Action                           |
| ---- | -------------------------------- |
| 1    | Navigate to existing project     |
| 2    | Run `init-workspace.ps1`         |
| 3    | Review AGENTS.md                 |
| 4    | Start working normally           |
| 5    | Run `finalize-session.ps1` daily |

**Result:** Gentle-Vanguard adds capabilities without touching existing code.
