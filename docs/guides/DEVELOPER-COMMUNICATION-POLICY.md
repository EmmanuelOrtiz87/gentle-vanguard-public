# Developer Communication Policy

## Purpose

Standardize agent-to-developer communication to reduce ambiguity, token waste, and unnecessary
back-and-forth.

## Default Mode

1. Default mode is `simple`.
2. Responses must be short, clear, and action-focused.
3. Use plain language and avoid unnecessary narrative.
4. Compression baseline is `ultra`.
5. This baseline remains active until the developer explicitly asks to change it.

## Minimal Mode (`simple`)

Use `simple` mode when the developer wants the lowest possible token usage and closure-first output.

Activation triggers:

- `SIMPLE`
- `RESUMEN`
- Equivalent explicit request in natural language (for example: "solo cierre", "respuesta mnima").

`simple` response contract:

1. Success: `OK: closed` (or `OK: <minimum verifiable result>`).
2. Failure: `ERROR: <brief cause> | ACTION: <minimum required step>`.
3. Do not include optional suggestións unless explicitly authorized.
4. Keep warnings only for critical risk (security/data-loss/regression).

## Local Activation (Workspace Override)

The local workspace can override the global default response mode via orchestrator config.

## Global Enforcement (Local Machine)

You can enforce `simple/ultra` globally on your machine (not per repo). This is a **local-only**
helper and should not be committed to shared repositories.

Example:

```TypeScript
.\tools\enforce-response-mode.ps1
```

File:

- `config/orchestrator.json`

Keys:

- `communication_language`: `es | pt-BR | en`
- `allowed_languages`: allowed language values for tooling checks and status visibility
- `communication_response_mode`: `simple | executive | expanded`
- `allowed_response_modes`: allowed values for local tooling checks and status visibility
- `response_profiles.active`: `lite | lleno | ultra` (compression style)
- `communication_presets.default`: default preset
  (`bugfix | refactor | docs | audit-review | executive-demo`)

Current local baseline for this workspace:

- `communication_language = es`
- `communication_response_mode = simple`
- `response_profiles.active = ultra`
- `communication_presets.default = bugfix`

Preset workflow:

1. Ask orchestrator recommendation (`orchestrator-next-steps`).
2. Apply preset (`src/cli/gv.ts response-mode preset:<name>`).
3. Escalate by risk when needed (`src/cli/gv.ts response-mode recommend:<name>:high`).

Session auto-apply workflow:

1. `start-session` reads `communication_presets.auto_apply_on_session_start`.
2. If enabled, it infers preset from task/branch and applies recommendation automatically.
3. Session brief records the exact applied combination for traceability.

## Agent Chat Enforcement Layer

To avoid relying only on runtime config/scripts, this workspace also defines explicit agent-layer
style enforcement.

File:

- `.github/copilot-instructions.md`

Behavior:

1. Enforces `simple + ultra` as default chat contract.
2. Requires closure-first output format:
   - `OK: <minimum verifiable result>`
   - `ERROR: <brief cause> | ACTION: <minimum required step>`
3. Restricts optional suggestións unless explicitly authorized.
4. Allows detail escalation only on explicit request or critical-risk context.

This complements (not replaces) `config/orchestrator.json` controls.

### Chat Levels (explicit bundles)

To make chat behavior predictable, the workspace defines explicit chat levels:

1. `chat-compact`: `simple + ultra`
2. `chat-balanced`: `executive + lleno`
3. `chat-detailed`: `expanded + lite`

Activation commands:

1. `src/cli/gv.ts response-mode chat:chat-compact`
2. `src/cli/gv.ts response-mode chat:chat-balanced`
3. `src/cli/gv.ts response-mode chat:chat-detailed`

Inspection commands:

1. `src/cli/gv.ts response-mode`
2. `src/cli/gv.ts response-mode list`

Architecture baseline for session start:

1. `chat_response.default_level = chat-compact`
2. `chat_response.enforce_on_session_start = true`
3. `response_policy.strict_mode = true`
4. `response_policy.enforce_baseline = true`

Meaning:

1. The orchestrator starts each session in the lowest-detail chat level (`simple + ultra`).
2. This is treated as an architecture decisión for token-efficiency and closure-first operation.
3. Baseline is mandatory by default; out-of-policy changes require explicit override command.

Override paths (controlled):

1. Command:
   `response-mode.ps1 -Mode set-chat-level -ChatLevel <level> -AllowPolicyOverride -OverrideReason "<reason>"`
2. Detail/profile override:
   `response-mode.ps1 -Mode set-detail -Detail <level> -AllowPolicyOverride -OverrideReason "<reason>"`
3. Return to baseline: `response-mode.ps1 -Mode enforce-baseline`

Default rule:

1. No free-mode operation outside `simple + ultra + chat-compact` unless override is explicit and
   traceable.

## Engram Traceability for Communication Mode

Communication mode changes executed through `scripts/utilities/response-mode.ps1` are persisted as
<!-- REF-OBSOLETA: scripts/utilities/response-mode.ps1 no tiene equivalente TS (migración PS1→TS) -->

Engram observations.

Observation key:

- `communication-response-mode`

Recorded fields:

1. `language`
2. `detail`
3. `profile`
4. `preset`
5. `reason` (change action source)

## Detail Escalation

Use extended detail only when the developer explicitly requests it.

Approved triggers:

- `EXTENDER`
- `DETALLE`
- Explicit equivalent request in natural language.

Without one of those triggers, keep simple mode.

## Risk-Based Escalation (Orchestrator)

The orchestrator may request a temporary response-level escalation when risk is high.

Escalation model:

1. Minimal on request: `simple`.
2. Default: `executive`.
3. Escalate to `expanded` for medium/high explanation needs:
   - ambiguous requirement with implementation impact
   - non-trivial integration or migration risk
   - handoff or decisión documentation requested explicitly
4. Keep risk warnings mandatory in all modes:
   - security, data-loss, compliance, or critical regression risk
   - architecture decisións with broad blast radius

When escalation is applied, the agent must:

1. State why escalation is needed in one short line.
2. Ask for developer authorization before keeping the higher level for subsequent responses.

## Authorization Gate for Suggestións

The agent must not proactively push optional improvements, refactors, or scope expansions unless the
developer authorizes suggestións.

Approved trigger examples:

- `AUTORIZO SUGERENCIAS`
- `PROPON MEJORAS`

If no authorization is given, deliver only what was requested.

## Critical Exceptions

Even in executive mode, the agent must immediately warn about:

1. Security risks.
2. Potential data loss or destructive operations.
3. High-confidence behavioral regressions.

Warnings must remain concise and actionable.

## Stable Response Contract

For normal operational responses:

1. decisión.
2. Action taken.
3. Result.
4. Next step only if needed.

## Documentation Scope Optimization

Optimization applies selectively, not globally.

Optimize for concise output (executive-first + optional details) in:

1. Review reports.
2. Audit/session closure outputs.
3. Operational status and handoff notes.

Do not compress core knowledge documents that require full traceability and technical depth:

1. Architecture and design documentation.
2. Implementation and technical guides.
3. Business and product documentation.

Rule: keep gentle-vanguardal/technical/business documents complete; optimize only
operational/transient artifacts.

## Language Scope

The supported communication languages for this workspace are:

1. `es`
2. `pt-BR`
3. `en`

Classical Chinese variants are deprecated and out of scope for Gentle-Vanguard audiences.

## Governance

This policy is enforced as a required governance artifact by:

- `scripts/diagnostics/validate-script-governance.ps1`

<!-- REF-OBSOLETA: scripts/diagnostics/validate-script-governance.ps1 no tiene equivalente TS (migración PS1→TS) -->

Any removal or relocation must be approved by the developer and updated in governance rules.
