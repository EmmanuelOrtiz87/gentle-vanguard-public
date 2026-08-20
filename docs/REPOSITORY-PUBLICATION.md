# Repository publication strategy

## Purpose

Gentle-Vanguard uses two repositories with different responsibilities:

| Repository | Visibility | Role |
| --- | --- | --- |
| `gentle-vanguard` | Private | Development, internal operations, telemetry and unreleased work |
| `gentle-vanguard-public` | Public | Curated distribution, examples, documentation and releases |

The public repository is the product surface for users. The private repository is the engineering
workspace. Keeping both public creates duplicated sources of truth and increases the chance that
operational details are published accidentally.

## Publication rules

1. Keep the development repository private after confirming that no public workflow depends on its
   visibility.
2. Publish only through `src/sync-to-public.ts` and `.github/workflows/sync-public.yml`.
3. Prefer an allowlist of files over a full repository mirror.
4. Never publish `.runtime/`, `.session/`, `.telemetry/`, local databases, keys, logs, or local
   provider credentials.
5. Review generated artifacts and release notes before every publication.
6. Keep `README-PUBLIC.md` as the source that becomes `README.md` in the public repository.

## Before changing GitHub visibility

Run a secret and history review, confirm branch protection and verify that `PAT_SYNC` is configured
as a GitHub Actions secret. Visibility changes are repository administration actions and should be
performed in GitHub after the working tree changes have been reviewed.

## Current sync boundary

The workflow publishes `build/`, example configuration, selected `docs/`, demos, skills index,
license, changelog, bootstrap/setup files and `README-PUBLIC.md`. The sync script is the source of
truth for the exact allowlist; update it when adding a new public component.

## Release checklist

- [ ] No secrets in the working tree or recent commits.
- [ ] Public README explains purpose, installation and limitations.
- [ ] Technical documentation links resolve.
- [ ] `npm run typecheck`, `npm run lint` and relevant tests pass.
- [ ] Public sync is dry-run reviewed.
- [ ] GitHub release points to the public repository.
