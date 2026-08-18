# Runtime State

This workspace automates isolation of Engram state so it is never written inside a source checkout.

## Goal

- Prevent `.engram/` from appearing inside any tool or project repository.
- Keep local databases and temporary files in a dedicated workspace directory.
- Reduce manual steps when installing or using Engram for the first time.

## Automatic flow

1. Run `scripts/init-workspace.ps1` or `scripts/init-workspace.sh` once per machine.
<!-- REF-OBSOLETA: scripts/init-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->
2. The init cleans runtime leftovers with `scripts/clean-runtime.ps1` or `scripts/clean-runtime.sh`.
<!-- REF-OBSOLETA: scripts/clean-runtime.ps1 no tiene equivalente TS (migración PS1→TS) -->
3. Run `scripts/run-engram.ps1` or `scripts/run-engram.sh` to open Engram with isolated state.
<!-- REF-OBSOLETA: scripts/run-engram.ps1 no tiene equivalente TS (migración PS1→TS) -->
4. The launcher reads `config/workspace.config.json`.
5. The launcher resolves `dataRoot`.
6. A dedicated subdirectory for Engram is created inside that `dataRoot`.
7. `ENGRAM_DATA_DIR` is exported only for that process.
8. Engram starts using that isolated path.

## Operational rule

- Do not run `engram` manually from inside repositories if you want to keep them clean.
- Always use the workspace launcher when the state must be reproducible and outside the checkout.
- If you need to clean old leftovers, run `scripts/clean-runtime.ps1` or `scripts/clean-runtime.sh`
<!-- REF-OBSOLETA: scripts/clean-runtime.ps1 no tiene equivalente TS (migración PS1→TS) -->
  manually.
- `scripts/validate-workspace.ps1` fails if `.engram/` appears again inside known repositories.
<!-- REF-OBSOLETA: scripts/validate-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->

## Effect on repositories

- Tool and project repositories stay clean from Engram runtime state.
- Runtime state should only live under the workspace data root.
- If `.engram/` appears in any repository, it can be removed without touching source code.
