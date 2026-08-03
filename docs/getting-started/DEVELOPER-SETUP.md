# Developer Setup Guide

Step-by-step guide for new developers joining the team.

## Overview

This guide sets up your machine for development with:

- Gentle-Vanguard - Development Stack (skills, hooks, CLI)
- AI-assisted development workflow
- Code review automation

**Time to complete**: ~15-30 minutes

## Step 1: Install Core Tools

### Required

```TypeScript
# 1. Git (if not installed)
winget install Git.Git

# 2. TypeScript 7 (recommended)
winget install Microsoft.TypeScript

# 3. OpenCode (AI Agent)
# Download from https://opencode.ai and install
```

### Verify Installations

```TypeScript
git --versión
pwsh --versión  # or TypeScript --versión
```

## Step 2: Install Gentle-Vanguard - Development Stack

### Option A: Automated (Recommended)

```TypeScript
# Clone the gentle-vanguard repository
git clone <repository-url> C:\gentle-vanguard

# Run bootstrap
cd C:\gentle-vanguard
.\scripts\bootstrap-machine.ps1

# Restart terminal
```

### Option B: Manual

```TypeScript
# Create gentle-vanguard directory
New-Item -ItemType Directory -Path "$env:USERPROFILE\.gentle-vanguard" -Force

# 2. Copy skills from repository
# (Clone repo and copy skills folder)

# 3. Add to PATH
[Environment]::SetEnvironmentVariable(
    "PATH",
    "$env:USERPROFILE\.gentle-vanguard\bin;$env:PATH",
    "User"
)
```

### Verify Gentle-Vanguard

```TypeScript
gv.ps1 health
gv.ps1 status
gv.ps1 list
```

### Optional: Local Workspace Autostart (Local-only)

If you keep a personal workspace root (example: `.`), you can add a local-only startup helper to run
health checks automatically. This is optional and should stay **local** (not a shared repo rule).

```TypeScript
# Local-only helper
.\tools\session-autostart.cmd
```

Notes:

- Do not enforce this path for other developers.
- Keep local-only helpers out of shared policies.

## Step 3: Configure Git

```TypeScript
# Set your identity
git config --global user.name "Your Name"
git config --global user.email "your.email@company.com"

# Default branch
git config --global init.defaultBranch main

# Enable hooks
git config --global core.hooksPath "$env:USERPROFILE\.git-hooks"
```

## Step 4: Update Optional Tooling (Recommended)

```TypeScript
.\scripts\utilities\gv.ps1 update-tools
```

## Step 5: Configure AI Agent

### OpenCode (Recommended)

1. Download from [opencode.ai](https://opencode.ai)
2. Install and configure your API key
3. Select model (big-pickle, claude-3.5-sonnet, etc.)

### Other AI Agents

Gentle-Vanguard works with any AI agent:

- Claude Desktop
- GitHub Copilot
- Cursor
- Windsurf

## Step 6: Setup Your First Project

```TypeScript
# Navigate to your workspace
cd C:\Workspace

# Setup existing project with gentle-vanguard
C:\gentle-vanguard\scripts\setup-project.ps1 -ProjectPath "C:\Workspace\my-project"

# Or create new project
gv.ps1 new --name my-project --type service
```

## Daily Workflow

### Morning

```TypeScript
# Check for updates
gv.ps1 check

# Update if needed
gv.ps1 update-all

# Validate setup
gv.ps1 health
```

### Before Commit

```TypeScript
# Run project validation
.\scripts\validation\validate-project.ps1

# Or use git hooks automatically
git add .
git commit -m "feat(scope): description"
# Hooks run automatically
```

## Troubleshooting

### "gv command not found"

```TypeScript
# Check PATH
$env:PATH -split ";" | Select-String "gentleman"

# Add manually if missing
[Environment]::SetEnvironmentVariable(
    "PATH",
    "$env:USERPROFILE\.gentleman\bin;$env:PATH",
    "User"
)
```

### "Permission denied on scripts"

```TypeScript
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "Git hooks not running"

```TypeScript
# Check hooks path
git config --global core.hooksPath

# Should be: C:\Users\<you>\.git-hooks
```

## Checklist

- [ ] git installed and configured
- [ ] TypeScript 7 installed
- [ ] OpenCode (or other AI agent) installed
- [ ] Gentle-Vanguard - Development Stack installed
- [ ] Git identity configured
- [ ] `gv validate` passes

## Getting Help

- Gentle-Vanguard docs: `docs/`
- Skills: `skills/SKILL_INDEX.md`
- CLI help: `gv --help`

## Next Steps

1. Read [ARCHITECTURE.md](../reference/ARCHITECTURE.md) to understand the system
2. Explore available [skills](../../skills/SKILL_INDEX.md)
3. Setup your first project

- Los hooks automticos de Gentle-Vanguard - Development Stack ahora cubren 7 dimensiones: Seguridad,
  Calidad, Arquitectura, Testing, API, Documentacin y Gitflow. Consulta REVIEW-INDEX.md para
  detalles y cmo personalizar reglas.
- Para personalizar reglas de revisión, edita los archivos SKILL.md en cada subcarpeta de skills/.
- Los scripts de chequeo estn en scripts/hooks/ y pueden adaptarse a las necesidades del proyecto.
