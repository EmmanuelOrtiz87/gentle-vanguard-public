# Repository Rename Migration

This guide documents how to migrate from `gentle-vanguard` to `gentle-vanguard` safely across
machines and local clones.

## Current State

1. New canonical repository name: `gentle-vanguard`
2. Existing public mirror repository: `gentle-vanguard-public`

## Migration Checklist

1. Rename repository on GitHub.
2. Update local remote URLs on every machine.
3. Verify branch protections or rulesets after rename.
4. Validate sync workflows still target `gentle-vanguard-public`.

## Local Remote Migration

Use this script in each machine where you have local clones:

```TypeScript
.\scripts\utilities\DEPLOYMENT\migrate-gentle-vanguard-remotes.ps1
```

Dry run mode:

```TypeScript
.\scripts\utilities\DEPLOYMENT\migrate-gentle-vanguard-remotes.ps1 -DryRun
```

## Sync Configuration for gentle-vanguard-public

`sync-public.yml` now supports repository variables:

1. `PUBLIC_REPO` (example: `EmmanuelOrtiz87/gentle-vanguard-public`)
2. `PUBLIC_REPO_DEFAULT_BRANCH` (optional override)

If variables are missing, workflow defaults remain safe.

## Validation Commands

```TypeScript
git remote -v
gh repo view EmmanuelOrtiz87/gentle-vanguard --json name,url,defaultBranchRef
pwsh -NoProfile -ExecutionPolicy Bypass -File src/agent-verify.ts
<!-- REF-OBSOLETA: src/agent-verify.ts no existe (ruta migrada o eliminada) -->
```

## Notes

1. Rename does not migrate branch rules automatically in all cases.
2. Re-check branch rulesets after the rename.
3. For public repositories, keep untrusted PR jobs on GitHub-hosted runners.
