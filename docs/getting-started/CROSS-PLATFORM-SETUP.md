# Cross-Platform Setup Guide

## Overview

The Gentle-Vanguard - Development Stack now supports **all platforms** through
orchestrator-coordinated shell routing:

- **Windows**: TypeScript 5.1+ or TypeScript Core (pwsh)
- **Linux**: Bash, sh, zsh
- **macOS**: Bash, zsh, sh
- **WSL**: Full support via bash

## Support Model

1. The workspace is platform-aware for Windows, Linux, macOS, and WSL.
2. The wrapper commands are shell-aware and route to the correct entrypoint.
3. The tool activation and update scripts are TypeScript-based, but they now resolve
   platform-specific paths, home directories, and install metadata dynamically.
4. This means the stack is highly portable across OSes, while TypeScript remains the canonical
   implementation runtime for automation.

## Quick Start

### Windows / Linux / macOS (TypeScript)

```TypeScript
# First time setup (installs deps, inits Nexus DB, installs hooks, generates graph)
npm run stack:setup

# Then use workflow commands
npm run gv -- info
npm run gv -- health
```

> **Note**: The legacy `bootstrap.ps1` / `setup.sh` / `gv.ps1` / `gv.sh` shell wrappers were
> migrated to TypeScript. Use `npm run stack:setup` for first-time setup and `npm run gv` for the
> workflow CLI (`src/cli/gv.ts`).

## How It Works

### Node.js Runtime

All scripts are TypeScript executed via `npx tsx`, so Node.js is the single runtime
dependency. No shell-specific scripts or wrappers are required:

```bash
# All scripts run through Node.js
npx tsx src/cli/gv.ts info
npm run health:check
```

### Unified TypeScript Runtime

The stack is fully migrated to TypeScript, so the same commands work on **all platforms**:

1. Runs via `npm run` (cross-platform by design)
2. No shell-specific wrappers or platform detection needed
3. Windows, Linux, macOS, and WSL behave identically

### Unified Command Interface

Same commands work on **all platforms** via the TypeScript CLI (`npm run gv`):

```bash
npm run gv -- info      # Show project info
npm run gv -- health    # Run health checks
npm run gv -- validate  # Verify configuration
npm run gv -- prune     # Prune old data
npm run gv -- optimize  # Optimize database
```

## Scripts Provided

### Setup Scripts

| Script                          | Platform        | Purpose                                   |
| ------------------------------- | --------------- | ----------------------------------------- |
| `npm run stack:setup`           | All             | One-command first-time stack installation |
| `src/stack-setup.ts`            | All             | TypeScript implementation of setup steps  |

### Diagnostic Scripts

| Script                    | Platform | Purpose                                          |
| ------------------------- | -------- | ------------------------------------------------ |
| `npm run health:check`    | All      | Full stack health check (TypeScript)             |
| `npm run self-diagnosis`  | All      | Detailed diagnostics for Windows/Linux/macOS     |
| `src/self-diagnosis.ts`   | All      | TypeScript diagnostics entrypoint                |

### Initialization Scripts

| Script                    | Platform | Purpose                                        |
| ------------------------- | -------- | ---------------------------------------------- |
| `npm run stack:setup -- --yes` | All | Non-interactive auto-install of the full stack |
| `src/stack-setup.ts`      | All      | TypeScript auto-init with auto-install support |

### Workflow CLI

| Script             | Platform | Purpose                        |
| ------------------ | -------- | ------------------------------ |
| `npm run gv`       | All      | Main workflow CLI (`src/cli/gv.ts`) |
| `src/cli/gv.ts`    | All      | Commands: info, check, validate, list, health, prune, backup, optimize, new, update, sync |

## Command Reference

### info

Shows project information and installed tools:

```bash
npm run gv -- info
```

Output:

- Project root
- Operating system
- Current shell
- Installed tools (Go, Git, Node.js, Engram)
- Project-specific info

### health

Runs health checks and auto-installs missing tools:

```bash
npm run gv -- health
```

Actions:

- Checks Go, Git, Engram CLI
- Auto-installs Engram CLI via `go install`
- Initializes Engram data directory
- Auto-links orchestrator skill

Additional behavior:

- Resolves system dependency installation metadata per platform from `config/workspace.config.json`
- Detects `bash` as a cross-platform capability for shell-based helper tooling
- Uses platform-aware PATH refresh logic after installation attempts

### diagnose

Detailed system diagnostics (verbose):

```bash
npm run self-diagnosis
```

Checks:

- Go compiler versión
- Git versión
- Node.js / npm (if applicable)
- Engram CLI versión
- Engram data directory size
- Workspace configuration
- Orchestrator state
- Skills directory
- MCP server status

### validate

Quick environment verification:

```bash
npm run gv -- validate
```

Verifies:

- Critical tools installed
- Configuration files present
- Workspace readiness

### init

Full environment initialization:

```bash
npm run stack:setup
```

Actions:

- Runs diagnostics
- Installs Engram CLI if missing
- Initializes data directories
- Installs npm dependencies (dashboard)
- Seeds configurations

## Orchestrator Integration

### Configuration

The orchestrator is configured in `config/orchestrator.json`:

```json
{
  "platform_aware": true,
  "cross_platform_routing": true,
  "communication_response_mode": "simple",
  "supported_shells": ["TypeScript", "pwsh", "bash", "sh"],
  "shell_routing": {
    "windows": ["TypeScript", "pwsh"],
    "linux": ["bash", "sh"],
    "macos": ["bash", "zsh", "sh"]
  },
  "bootstrap": {
    "primary_entry": "npm run stack:setup",
    "fallback_entry": "npm run setup:complete"
  }
}
```

### Commands

The orchestrator maps commands to the TypeScript CLI:

```json
{
  "commands": {
    "info": "npm run gv -- info",
    "health": "npm run gv -- health",
    "validate": "npm run gv -- validate"
  }
}
```

## Git Hooks

Post-checkout and pre-commit hooks automatically manage environment state:

### Post-Checkout Hook

On each branch checkout, automatically:

- Runs diagnostics
- Detects missing dependencies
- Offers to auto-install Engram CLI
- Re-initializes environment if needed

```bash
# Git hooks are installed by lefthook (managed via `npm run stack:setup`)
# See .lefthook.yml for the configured hooks and actions
```

### Pre-Commit Hook

Before each commit:

- Verifies environment state
- Checks critical tools
- Aborts commit if configuration is broken

## Troubleshooting

## Compatibility Notes

1. The TypeScript CLI (`src/cli/gv.ts`) and `npm run stack:setup` are the canonical automation
   entrypoints (replacing the legacy `gv.ps1`/`gv.sh`/`bootstrap.ps1` wrappers).
2. On Linux or macOS, `npm run` works with any shell (bash, zsh, pwsh).
3. Health and diagnostics are unified in `npm run health:check` and `npm run self-diagnosis`.
4. AI tooling is configurable and optional; the workspace does not require a single IDE or AI
   provider to be hardcoded.

### Problem: "Setup scripts not executable"

**Linux/macOS:** All setup runs through `npm`/`pnpm`, so no chmod is required:

```bash
npm run stack:setup
```

**Windows:** Same commands work (handled by Node.js runtime)

### Problem: "Go not found"

Install Go: https://go.dev/dl/

### Problem: "Engram CLI won't install"

Check Go installation:

```bash
go versión
go env GOPATH
```

Manually install:

```bash
go install github.com/gentle-vanguard/engram/cmd/engram@latest
```

### Problem: "Wrong shell detected"

The TypeScript CLI is shell-agnostic:

```bash
# Works identically in bash, pwsh, zsh, cmd
npm run gv -- health
npm run health:check
```

## Development

### Adding New Commands

1. Add a new case in `src/cli/gv.ts`:

```TypeScript
// src/cli/gv.ts
case 'mycommand':
  runMyCommand();
  break;
```

2. Implement the handler function in the same file.

3. Register any new npm script in `package.json` if needed:

## File Structure

```
project-root/
 src/
    cli/gv.ts                    # Workflow CLI (TypeScript)
    stack-setup.ts               # One-command first-time setup
    self-diagnosis.ts            # Detailed diagnostics
    health-check.ts              # Full stack health check
 config/
    session-autostart.config.json  # Session pipeline config
    workspace.config.json          # Workspace configuration
 scripts/
    database/                    # DB lifecycle scripts (TS)
    recovery/                    # Recovery scripts (TS)
 hooks/                         # Git hook scripts
 .engram-data/                   # Engram CLI data directory
```

## Performance Notes

- **First setup**: ~30-60 seconds (depends on Engram installation)
- **Health checks**: ~2 seconds
- **Auto-initialization**: ~5-10 seconds (includes npm install for dashboard)
- **Diagnostics**: ~1 second

## What's Next

1. Run setup: `npm run stack:setup`
2. Verify installation: `npm run health:check`
3. Start development: See project-specific README
4. Monitor via CLI: `npm run gv -- health`

- Los hooks automticos de Gentle-Vanguard - Development Stack ejecutan chequeos de seguridad,
  calidad, arquitectura, testing, API, documentacin y gitflow en cada commit/push. Ver
  REVIEW-INDEX.md.
