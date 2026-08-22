# Gentle-Vanguard Sync Guide

This guide explains exactly how Gentle-Vanguard sync behaves in consumer repositories.

## Scope

`gentle-vanguard-sync` does **not** update the whole repository. It only evaluates and updates files
listed in `config/gentle-vanguard-sync.json` under `assets`.

If a file is not listed in `assets`, sync does not touch it.

## Source vs Consumer Role

`config/gentle-vanguard-sync.json` defines a repository role:

1. `role: source`

- This repository is the Gentle-Vanguard source.
- `gentle-vanguard-sync` exits early with no file sync.

2. `role: consumer`

- This repository consumes Gentle-Vanguard-managed assets.
- `gentle-vanguard-sync` compares and optionally updates listed assets.

## Asset Strategy

Each asset can define a `strategy`:

1. `replace` (default)

- If drift is detected, `apply` overwrites local target file with source file.
- Local custom content in that managed file can be lost.

2. `preserve-local`

- Keep local target file unchanged.
- Useful for project-specific customizations.

## Command Modes

1. `check`

- Detects drift only.
- No file changes.

2. `apply`

- Applies updates for drifted assets with `replace` strategy.

3. `apply -CreatePR`

- Creates a sync branch.
- Commits managed updates.
- Pushes branch and opens a PR (when `gh` is available).

4. `-Force`

- Allows apply when the working tree has local changes.
- Use with caution.

## Recommended Safe Workflow

1. Run check first:

```TypeScript
.\scripts\utilities\src/cli/gv.ts gentle-vanguard-sync
```

2. Review drifted files and strategy (`replace` vs `preserve-local`).
3. Adjust `config/gentle-vanguard-sync.json` before apply if needed.
4. Ensure a clean working tree before apply:

```TypeScript
# Option A: Commit your changes
git add .
git commit -m "chore: save local changes"

# Option B: Stash temporarily
git stash push -u -m "pre-gentle-vanguard-sync"
```

5. Apply with PR for traceability:

```TypeScript
.\scripts\utilities\src/cli/gv.ts gentle-vanguard-sync apply -CreatePr
```

6. Review PR and merge.

## Will Custom Files Be Lost?

Only in this case:

1. The file is listed in `assets`.
2. Its strategy resolves to `replace`.
3. You run `apply`.

Custom files outside managed assets are not touched.

## Consumer Manifest Example

```json
{
  "schemaversión": 1,
  "role": "consumer",
  "gentle-vanguardPath": "../gentle-vanguard",
  "fromversión": "0.2.0",
  "toversión": "0.2.1",
  "assets": [
    {
      "source": "src/cli/gv.ts",
      "target": "src/cli/gv.ts",
      "strategy": "replace"
    },
    {
      "source": "AGENTS.md",
      "target": "AGENTS.md",
      "strategy": "preserve-local"
    }
  ]
}
```

## Related Files

1. `scripts/utilities/UTILITIES/gentle-vanguard-sync.ps1`

<!-- REF-OBSOLETA: scripts/utilities/UTILITIES/gentle-vanguard-sync.ps1 no tiene equivalente TS (migración PS1→TS) -->

2. `config/gentle-vanguard-sync.json`
3. `src/cli/gv.ts`
