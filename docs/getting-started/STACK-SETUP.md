# Gentle-Vanguard - Development Stack Setup & Auto-Repair Guide

## Overview

The Gentle-Vanguard - Development Stack architecture includes an **automatic stack detection and
repair system** that runs with minimal manual intervention. The stack is checked and repaired when:

- You open a terminal in a project directory
- You run `git checkout` on a branch
- You run workflow commands
- You explicitly run `.\scripts\utilities\gv.ps1 verify`

## Quick Start

### Option 1: New Project

```powershell
# In the gentle-vanguard root
.\scripts\utilities\gv.ps1 init-stack

# Or in the bitbucket-dashboard root
.\scripts\utilities\gv.ps1 init-stack
```

### Option 2: Existing Project (cloned repo, new branch, and similar cases)

```powershell
# Quick verification with auto-repair
.\scripts\utilities\gv.ps1 verify

# Or a full verification with a detailed report
.\scripts\utilities\gv.ps1 diagnose
```

### Option 3: Automatic on Terminal Entry (Recommended)

On Windows, the optional PowerShell profile can run `verify` automatically when it detects a
Gentle-Vanguard - Development Stack project. On Linux and macOS, use `./gv verify` or invoke
`gv.ps1` through `pwsh`.

## Stack Components

The stack requires these components. The system verifies them automatically:

### Critical Components (Must Be Installed)

- **Go** - Backend runtime
- **Git** - versión control
- **PowerShell 5.1+** - Script execution

Additional for bitbucket-dashboard:

- **Node.js** - Frontend runtime
- **npm** - Package manager

### Optional Components (Installed Automatically When Supported)

- **Engram CLI** - AI memory system
- **Angular CLI** - Frontend tooling (bitbucket-dashboard)
- **gh CLI** - GitHub automation

## Command Reference

### `.\scripts\utilities\gv.ps1 diagnose`

Generates a full stack status report.

```powershell
# Detailed console report
.\scripts\utilities\gv.ps1 diagnose

# JSON report for automation
.\scripts\utilities\gv.ps1 diagnose -JSON > stack-status.json
```

**Output includes:**

- Status of each component (PASS/FAIL/WARN)
- Resolved tool paths
- Workspace configuration
- Orchestrator status
- Repair recommendations

### `.\scripts\utilities\gv.ps1 verify`

Quick verification with auto-repair. Quiet by default.

```powershell
# Quiet verification with auto-repair
.\scripts\utilities\gv.ps1 verify

# Show details during repair
.\scripts\utilities\gv.ps1 verify -Verbose
```

**What `verify` does:**

1. Detects the project type
2. Verifies critical components
3. Detects the Engram CLI and installs it if missing
4. Activates development tools
5. Reports the final status

### `.\scripts\utilities\gv.ps1 health`

Health check with tool activation.

```powershell
.\scripts\utilities\gv.ps1 health
```

### `.\scripts\utilities\gv.ps1 install-engram`

Install or verify Engram CLI availability.

```powershell
.\scripts\utilities\gv.ps1 install-engram
```

## Usage Flows

### Start a Project From Scratch

```powershell
cd c:\projects
mkdir my-new-project
cd my-new-project

# Copy template
Copy-Item -Path "c:\gentle-vanguard\\*" -Destination . -Recurse

# Initialize stack
.\scripts\utilities\gv.ps1 init-stack
```

**Result:** Stack fully initialized and operational.

### Cloned Project or New Branch

```powershell
# After git clone or git checkout
cd <project-root>

# The post-checkout hook runs verify automatically
# You can also run it manually:
.\scripts\utilities\gv.ps1 verify
```

**The post-checkout hook:**

- Runs automatically after `git checkout`
- Diagnoses the stack state
- Repairs detected problems automatically
- Initializes the environment when needed

### Manual Verification at Any Time

```powershell
# Full report
.\scripts\utilities\gv.ps1 diagnose

# Report + auto-repair
.\scripts\utilities\gv.ps1 verify

# JSON report for CI/CD
.\scripts\utilities\gv.ps1 diagnose -JSON
```

## Automatic Detection

### PowerShell Profile Auto-Detection

The optional PowerShell profile (`scripts/utilities/Microsoft.PowerShell_profile.ps1`) can detect
when you are in a Gentle-Vanguard - Development Stack project and run:

```powershell
# When opening a terminal in a project directory:
if (is_gentleman_gentle-vanguard_project) {
  .\scripts\utilities\gv.ps1 verify  # Quiet automatic verification
}
```

To enable it, copy the profile:

```powershell
Copy-Item ".\scripts\utilities\Microsoft.PowerShell_profile.ps1" $PROFILE
. $PROFILE
```

### Git Post-Checkout Hook

Runs automatically after `git checkout`:

```powershell
# In .git/hooks/ (auto-configured during bootstrap)
post-checkout -> system-diagnostics.ps1 + auto-init
```

## Auto-Repair Scenarios

The system detects and repairs the following automatically:

| Problem                      | Detection | Repair                          |
| ---------------------------- | --------- | ------------------------------- |
| Missing Engram CLI           |           | Installs via `go install`       |
| Missing workspace config     |           | Creates it from the template    |
| Orchestrator not activated   |           | Activates and initializes it    |
| Unsatisfied dependencies     |           | Attempts automatic installation |
| Missing Node/npm (dashboard) |           | Warns for manual installation   |
| Go not installed             |           | Warns for manual installation   |

## Status Codes

The system returns these exit codes:

```
0 = Stack HEALTHY
1 = Stack DEGRADED (warnings, but still operational)
2 = Stack CRITICAL (errors, not operational)
```

## JSON Output Example

For CI/CD and automation:

```powershell
.\scripts\utilities\gv.ps1 diagnose -JSON | ConvertFrom-Json
```

```json
{
  "timestamp": "2026-04-11T14:30:00Z",
  "projectRoot": "C:\\Workspace_local\\bitbucket-dashboard",
  "projectType": "bitbucket-dashboard",
  "overallStatus": "HEALTHY",
  "checks": [
    {
      "name": "Go",
      "status": "PASS",
      "message": "go versión go1.21.5 windows/amd64",
      "critical": true
    },
    {
      "name": "Engram CLI",
      "status": "PASS",
      "message": "C:\\Users\\emman\\go\\bin\\engram.exe",
      "critical": false
    }
  ],
  "errors": [],
  "warnings": [],
  "suggestións": []
}
```

## Standard Developer Procedure

### Every Time You Open the Project

```powershell
# 1. Open a terminal in the project directory
cd C:\projects\my-project

# 2. Automatic verification may run from the profile or hook
# Wait 2-3 seconds if it does

# 3. The stack is ready to use
.\scripts\utilities\gv.ps1 status  # Confirm project status
```

### When You Change Branches

```powershell
git checkout feature/new-feature

# The post-checkout hook runs:
# - system-diagnostics.ps1
# - auto-init-dev-environment.ps1

# Wait for completion; the stack is then ready
.\scripts\utilities\gv.ps1 review  # Continue with normal work
```

### When You Suspect Problems

```powershell
# Full report
.\scripts\utilities\gv.ps1 diagnose

# Auto-repair
.\scripts\utilities\gv.ps1 verify

# Re-verify
.\scripts\utilities\gv.ps1 diagnose
```

## Troubleshooting

### "Stack is CRITICAL - Go not found"

**Solution:**

```powershell
# Install Go from https://go.dev/
# Add it to PATH
# Restart PowerShell or pwsh

# Verify
.\scripts\utilities\gv.ps1 verify
```

### "Engram CLI NOT FOUND (can auto-install)"

**Solution:**

```powershell
# Auto-install
.\scripts\utilities\gv.ps1 install-engram

# Or verify and repair everything
.\scripts\utilities\gv.ps1 verify
```

### "Orchestrator NOT ACTIVATED"

**Solution:**

```powershell
.\scripts\utilities\gv.ps1 orchestrator-status

# Or use verify to activate it
.\scripts\utilities\gv.ps1 verify
```

### Post-checkout hook does not run

**Cause:** Git hooks are not configured correctly.

**Solution:**

```powershell
# Reconfigure the hooks path
git config core.hooksPath scripts/git-hooks

# Verify
git config core.hooksPath
# Expected value: scripts/git-hooks
```

## CI/CD Integration

For continuous integration pipelines:

```powershell
# In the setup step:
.\scripts\utilities\gv.ps1 diagnose -JSON | ConvertFrom-Json | Select-Object overallStatus

# If overallStatus != "HEALTHY", fail the pipeline
if ($status.overallStatus -ne "HEALTHY") {
    exit 1
}

# Proceed with tests and builds
```

## Best Practices

1. **Run `verify` after cloning or downloading a project**
2. **Treat the PowerShell profile as an optional Windows convenience, not the only activation path**
3. **Use `diagnose` when you need a detailed report**
4. **Let the system repair common problems automatically when possible**
5. **Critical components such as Go, Git, and Node may still require manual installation**

## See Also

- [scripts/utilities/docs/README.md](../../scripts/utilities/docs/README.md) - Available commands
- [scripts/core/bootstrap.ps1](../../scripts/core/bootstrap.ps1) - Full initialization
- [scripts/diagnostics/system-diagnostics.ps1](../../scripts/diagnostics/system-diagnostics.ps1) -
  Diagnostics engine
- [hooks/post-checkout.ps1](../../hooks/post-checkout.ps1) - Automatic verification on checkout

- Los hooks automticos de Gentle-Vanguard - Development Stack ejecutan chequeos de 7 dimensiones
  (seguridad, calidad, arquitectura, testing, API, documentacin, gitflow) en cada commit/push. Ver
  REVIEW-INDEX.md para detalles.
