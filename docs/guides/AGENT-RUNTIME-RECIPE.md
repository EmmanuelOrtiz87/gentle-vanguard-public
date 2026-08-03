# Agent Runtime Recipe

Practical setup guide to run agents consistently across local, cloud/self-hosted, and SaaS
environments.

## Objective

Ensure these capabilities work together without conflicts:

- Orchestrator (`project-orchestrator-skill`)
- Skills registry / multi-agent lanes (`agent-router.ps1`)
- Memory (`engram`)
- Native runtime router (`runtime-router.ps1`)
- Session governance (start/closure, token guard, compatibility checks)

## Prerequisites

- `go`, `git`, `node` available
- `gentle-vanguard` cloned
- `engram` installed and reachable in `PATH`

Quick validation:

```TypeScript
.\gentle-vanguard\scripts\utilities\gv.ps1 orchestrator-status
.\gentle-vanguard\scripts\utilities\gv.ps1 runtime-route
.\gentle-vanguard\scripts\utilities\agent-router.ps1 status
```

3. Run session start + explicit checks in pipeline bootstrap:

```TypeScript
.\tools\session-autostart.cmd
```

4. End with closure artifact + memory save:

```TypeScript
.\tools\session-manual-end.cmd
```

Operational tip:

- Keep `strictCompatibilityChecks: true` in stable environments.
- If environment has intermittent outbound restrictions, classify network update warnings as
  non-blocking (already supported by current flow).

### 3) SaaS-Contracted Agent Environments

Use this when core reasoning/runtime is external but repo governance remains local.

Integration baseline:

1. Keep repository-side governance active:
   - `gv.ps1 start-session`
   - `gv.ps1 end-session` or `gv.ps1 day-end-closure`
2. Keep `engram` as shared memory source from repo side.
3. Use `agent-router.ps1 status` as readiness contract for role lanes.
4. Capture artifacts in `docs/sessions`, `docs/audits`, `docs/code-reviews`.

decisión rule:

- SaaS agent can execute reasoning, but repository remains source of truth for:
  - policy checks
  - session lifecycle
  - closure evidence
  - docs/spec updates

## Conflict Matrix

| Component A                  | Component B                     | Conflict Risk | Notes                                                                          |
| ---------------------------- | ------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| Runtime router               | Orchestrator skills             | Low           | Router selects native available runtime; orchestrator governs workflow/skills. |
| `engram`                     | Orchestrator memory integration | Low           | Native complement; required by token guard policy.                             |
| Agent lanes (`agent-router`) | Session governance              | Low           | Registry status is used as readiness gate.                                     |
| Update checks (network)      | Strict startup                  | Medium        | Treat as non-critical; avoid blocking startup on update warnings.              |

## Recommended Default Policy

- `strictCompatibilityChecks: true`
- `autoStartPrimaryRuntime: true`
- `enableIdleAutoClose: true`
- `idleTimeoutMinutes: 60`

If startup fails in strict mode:

1. Run diagnostics:

```TypeScript
.\gentle-vanguard\scripts\utilities\gv.ps1 orchestrator-status
.\gentle-vanguard\scripts\utilities\gv.ps1 runtime-route
.\gentle-vanguard\scripts\utilities\agent-router.ps1 status
```

If startup fails in strict mode:

2. Resolve missing pieces and retry startup.
3. Use degraded mode only as temporary workaround.

## Operational Checklist

- [ ] Session starts via `session-autostart.cmd`
- [ ] Compatibility checks pass
- [ ] Orchestrator status is green
- [ ] Agent lanes are `READY`
- [ ] Engram memory path available
- [ ] Session closure artifact generated at end of cycle
