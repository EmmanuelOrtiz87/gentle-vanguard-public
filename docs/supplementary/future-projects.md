# Future Projects Guide

Use this Gentle-Vanguard as the standard starting point for new repositories.

## Start Here

1. Decide whether the project is new or already exists.
2. Decide whether you will scaffold from a template or clone an existing repository.
3. If the structure is known, choose `-Kind`, `-Preset`, `-Architecture`, `-Profile`, and the AI
   model fields up front.
4. If the structure is not known, keep the defaults and refine later with the project owner or the
   AI helper.
5. Install the workspace skills so new projects inherit the same documentation and architecture
   standards.
6. Run the workspace bootstrap once per machine.
7. Run the local memory launcher if you want isolated Engram state.
8. Create or clone the project using the project scripts.
9. Record architecture decisións and follow-up notes in `docs/project-context.md`.
10. If the project uses AI assistance, document whether it relies on a local model, a cloud model,
    or no model at all.
11. Record the selected AI provider, mode, model name, and endpoint in `docs/project-context.md`.
12. Review `docs/defaults-vs-decisións.md` before making a choice that could affect future projects.

## Recommended Order

1. Copy or clone the new project into its own repository.
2. Run `scripts/init-workspace.ps1` or `scripts/init-workspace.sh` once per machine.

<!-- REF-OBSOLETA: scripts/init-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->

3. Run `scripts/install-workspace-skills.ps1` or `scripts/install-workspace-skills.sh` so the

<!-- REF-OBSOLETA: scripts/install-workspace-skills.ps1 no tiene equivalente TS (migración PS1→TS) -->

documentation and architecture skills are available in Codex. 4. Run `scripts/run-engram.ps1` or
`scripts/run-engram.sh` if you want isolated local memory.
<!-- REF-OBSOLETA: scripts/run-engram.ps1 no tiene equivalente TS (migración PS1→TS) -->

5. Run `scripts/secrets-bootstrap.ps1` inside each application repo that uses local credentials.

<!-- REF-OBSOLETA: scripts/secrets-bootstrap.ps1 no tiene equivalente TS (migración PS1→TS) -->

6. Use `scripts/new-project.ps1 -Name <project>` or `scripts/new-project.sh -Name <project>` for

<!-- REF-OBSOLETA: scripts/new-project.ps1 no tiene equivalente TS (migración PS1→TS) -->

scaffolded repos. 7. Use `scripts/validate-workspace.ps1` or `scripts/validate-workspace.sh` before
changes are
<!-- REF-OBSOLETA: scripts/validate-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->

committed.

## Project Shape Parameters

Use parameters when the desired structure is known ahead of time:

- `-Kind service|cli|library`
- `-Preset default|dashboard|api|mcp|library`
- `-Architecture layered|clean|feature`
- `-Profile general|web|backend|automation`
- `-AiModelMode none|local|cloud`
- `-AiModelProvider ollama|openai|anthropic|google|custom`
- `-AiModelName <model-name>`
- `-AiModelEndpoint <endpoint>`
- `-AiModelNotes <free-form-notes>`

If the user has not decided yet, keep the defaults and let the AI helper or project owner refine the
choice later.

## Generated Project Context

Every scaffolded project gets a `docs/project-context.md` file with the selected defaults. That file
is intentionally safe to edit later and should be the first place to record design follow-ups,
including AI provider and model decisións.

## What Every Future Project Should Document

1. How to install prerequisites in order.
2. How to load secrets without publishing them.
3. How to start the app locally.
4. How to clean runtime leftovers.
5. How to register architecture decisións and session reviews.
6. Which documentation and architecture skills the project follows.
7. Which AI model mode, provider, and endpoint the project uses, if any.

## Default Runtime Rules

- Keep local memory outside the repository checkout.
- Keep encrypted secrets outside versión control.
- Prefer one launcher per concern:
  - workspace bootstrap
  - secrets bootstrap
  - runtime cleanup
  - app start

## Suggested Repository Files

1. `README.md`
2. `AGENTS.md`
3. `ARCHITECTURE.md`
4. `docs/setup/prerequisites.md`
5. `docs/setup/secrets.md` when credentials exist
6. `docs/ai-models.md` when AI-assisted workflows exist
7. `docs/project-context.md`
8. `docs/defaults-vs-decisións.md`
9. `scripts/start-*.ps1`
10. `scripts/secrets-*.ps1`
11. `scripts/cleanup-runtime.ps1`

<!-- REF-OBSOLETA: scripts/cleanup-runtime.ps1 no tiene equivalente TS (migración PS1→TS) -->

## Portability Checklist

- Tool versións are documented.
- External tools stay outside the project checkout.
- Secrets are encrypted locally or injected at runtime.
- Runtime cleanup is automatic or one command away.
- New developers can follow the README without tribal knowledge.
