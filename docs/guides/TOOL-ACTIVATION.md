# Tool Activation

This guide describes the current tool activation model for Gentle-Vanguard.

## Start Here

1. Run the workflow health check from the repository root.
2. Let the config decide which tools are required, optional, or shell-dependent.
3. Use the shell wrapper on Linux or macOS, or run the TypeScript entrypoint directly when
   preferred.

## Primary Commands

Windows TypeScript:

```TypeScript
.\scripts\utilities\src/cli/gv.ts health
.\scripts\utilities\src/cli/gv.ts health -Force
.\scripts\utilities\update-tools.ps1 -DryRun
```

Linux, macOS, or WSL:

```bash
./gv health
pwsh -NoProfile -File ./src/cli/gv.ts health
pwsh -NoProfile -File ./scripts/utilities/update-tools.ps1 -DryRun
<!-- REF-OBSOLETA: scripts/utilities/update-tools.ps1 no tiene equivalente TS (migración PS1→TS) -->
```

## Activation Model

1. `src/cli/gv.ts health` is the canonical tool activation entrypoint.
2. `ensure-tools-active.ps1` reads `config/workspace.config.json` and resolves platform-specific
   installation metadata for Windows, Linux, and macOS.
3. Missing system dependencies are checked before tool installation.
4. Tool activation is tolerant of optional tools and non-blocking installer failures when the tool
   is not required.

## Runtime Priority Model

1. Session startup uses the native runtime router to select the primary runtime.
2. The stack CLI (`stack-on-demand.ps1`) is used as fallback when primary startup fails or is
   unavailable.
3. Runtime preference is persisted in `config/orchestrator.json` under `runtime_preference`.
4. Fallback remains deterministic and policy-driven to avoid runtime inconsistency.

## Platform and Shell Behavior

1. Platform selection is dynamic: `windows`, `linux`, or `macos`.
2. Tool install metadata is resolved from the config per platform instead of hardcoded `.windows`
   paths.
3. Bash is treated as a capability, not a Windows-only implementation detail.
4. TypeScript remains the canonical automation runtime for these scripts, even when invoked through
   `pwsh` on Linux or macOS.

## Current Agnosticism Status

High portability is implemented for these areas:

1. OS-aware dependency and tool install selection.
2. Cross-platform home directory and PATH refresh handling.
3. Bash detection for shell-based utilities when required by optional tooling.
4. Optional AI tool handling when a provider or CLI is missing.

The remaining intentional constraint is:

1. The activation and update workflows are still authored in TypeScript, so the stack is
   shell-compatible through routing, but not shell-neutral at the implementation layer.

## Tools Covered

1. `engram`
2. `opencode`

Optional MCP integrations are validated separately through `config/workspace.config.json`.

## Validation Scope

The activation flow validates:

1. Tool availability.
2. Minimum system dependencies.
3. Platform-specific installer metadata.
4. Workflow CLI readiness.
5. Optional MCP integration readiness when enabled.

## Troubleshooting

1. If a required dependency is missing, run the health check again with `-Force`.
2. If a bash-based tool cannot install, verify that `bash` is available in `PATH`.
3. If a tool installs but is not detected immediately, restart the terminal and re-run the health
   check.
4. If you need a non-destructive check, use `update-tools.ps1 -DryRun`.
