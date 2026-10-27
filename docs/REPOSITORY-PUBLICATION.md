# Repository publication strategy

## Purpose

Gentle-Vanguard uses three publication surfaces with different responsibilities:

| Repository                       | Visibility | Role                                                                       |
| -------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `gentle-vanguard`                | Private     | Development, internal operations, telemetry and unreleased work            |
| `gentle-vanguard-public`         | Public      | Curated distribution, examples, documentation, installer and releases        |
| `gentlevanguard/gentlevanguard.github.io` | Public | Brand surface: corporate site, Academy catalog and social landing pages |

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

## Pushing when the OAuth token lacks the `workflow` scope

GitHub refuses any push that creates or updates a file under `.github/workflows/` when the credential
is an OAuth token without the `workflow` scope:

```
! [remote rejected] main -> main (refusing to allow an OAuth App to create or update
  workflow .github/workflows/ci.yml without workflow scope)
```

This affects the private repository, the public distribution repository and the landing repository
alike. It is a credential problem, not a code problem.

### The rule that unlocks it

GitHub evaluates the scope against the **tree of the ref update**, not against each commit in the
push. If the workflow file in the pushed tree is byte-identical to the one already on the target
branch, the push is accepted even if an intermediate commit touched it.

That gives two workable options:

1. **Move the check into the delivery gate (preferred).** `production-gate` in CI runs
   `pnpm delivery:gate:pr`, which executes the `pre-pr` stage of `src/delivery/gate.ts`. Any check
   that belongs to CI can live there instead of in the workflow file, and the workflow file stays
   untouched. Coverage is preserved and no credential change is required.
2. **Grant the scope (required for real workflow changes).** Only the owner can do this:

   ```powershell
   $env:GH_TOKEN=''; $env:GITHUB_TOKEN=''
   gh auth refresh -h github.com -s workflow
   ```

   The environment variables must be unset in that process, otherwise `gh` refreshes the ambient
   token instead of the keyring credential that Git Credential Manager uses for `git push`. The
   one-time device code expires, so run it immediately before the push that needs it.

### Surface-specific facts

| Surface                        | Has `.github/workflows/` | Consequence                                                        |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------ |
| `gentle-vanguard` (private)   | Yes (21 files)           | Any workflow change needs the scope or option 1                     |
| `gentle-vanguard-public`      | Yes (2 files)            | Same; the two files only differ by action SHA-pinning               |
| `gentlevanguard.github.io`     | No                       | Landing pushes never hit the scope check                            |

### Operating notes

- The sync is driven by `src/infrastructure/sync-to-public.ts`. The public distribution repository
  publishes `src/` and `packages/shared` on purpose ("public distribution is executable source"),
  plus `pnpm-lock.yaml` and `pnpm-workspace.yaml`, so dependency overrides stay consistent between
  the private and the public lockfiles.
- The sync refuses to run without a current installer: build it with `npm run gv:installer`
  (NSIS at `C:\Program Files (x86)\NSIS\makensis.exe`) and place both the `.exe` and its `.sha256`
  in the `dist/` of the sync worktree.
- Use a detached worktree of `main` as the sync source, never a feature branch:
  `git worktree add .tmp/sync-main main --detach`, then create `.tmp/sync-main/dist/` before syncing.
- The pre-push gate has a **tree fence**: it compares `git status --porcelain` before and after the
  checks and fails if the working tree mutates during that window. Do not push while another agent
  or process is editing the repository.
