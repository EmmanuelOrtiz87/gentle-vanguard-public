---
name: session-workflow
description: >
  Trigger: "guardar sesion", "continuar", "estado", "pr", "push", "review", "auditar". Session
  workflow executor handling session management mechanics. Coordinates with project-orchestrator for
  technical guidance.
---

# Session Workflow

## Activation Contract

Load when user triggers session commands: "continuar" / "continue", "estado" / "status", "push" /
"guardar", "review" / "auditar", or "PR" / "create PR". Coordinates with project-orchestrator for
technical decisions.

## Hard Rules

- MUST generate AUDIT DOCUMENT before any push
- MUST run code review before PR creation
- MUST create todowrite at session start
- MUST save session summary via mem_save after significant work
- MUST coordinate with project-orchestrator for technical guidance
- MUST run self-improving pipeline during session close (usage-tracker → skill-nudge → skill-auto-patch)

## Notes

- **Session start** (`inicia sesion` / `start session`) is handled by the canonical startup protocol
  defined in `CLAUDE.md` (Phase A + Phase B). This skill handles all other session commands.
- **Self-improving pipeline**: at session close, run usage-tracker → skill-nudge → skill-auto-patch
  to maintain skill health and auto-fix failure patterns.

## Decision Gates

| Command  | Trigger Words           | Action                                                     |
| -------- | ----------------------- | ---------------------------------------------------------- |
| Continue | "continuar", "continue" | mem_context, git status, show next step, resume            |
| Status   | "estado", "status"      | Show project, git branch/status, todos, suggest next       |
| Push     | "push", "guardar"       | Review todos, generate audit doc, commit, push, mem_save   |
| Review   | "review", "auditar"     | Quick scan (Security + Quality), classify, present, decide |
| PR       | "pr"                    | Validate spec, run review, handle findings, create PR      |

## Execution Steps

1. **Continue session**: `mem_context` → `git status` → show next step → resume work
2. **Show status**: Show project info → git branch/status → todos → suggest next step
3. **Push / Guardar**: Review todos completed → generate audit doc → git status/diff → commit → push
   → mem_save summary
4. **Review / Auditar**: Run code review (7 dimensions) → classify findings by severity → present
   summary → ask decision options → execute choice
5. **Create PR**: Validate spec → run code review → handle findings → ask: met spec? → ask: create
   PR? → branch → commit → push → create PR with template

## Output Contract

- **Push**: Audit document + session summary + git commit/push + mem_save
- **Review**: Findings summary with severity classification (CRITICAL/HIGH/MEDIUM/LOW)
- **PR**: GitHub PR created with template
- **Session start**: todowrite + status presentation
- **Session summary**: Structured mem_save with goal, accomplishments, findings, next steps

## References

- Templates (audit doc, code review, session summary, todo): `references/templates.md`
- Scripts: `scripts/utilities/session-autostart.cmd`
- Coordination: `../project-orchestrator-skill/SKILL.md`
