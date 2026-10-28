# AI tool compatibility and evidence

This matrix separates **configuration** from **execution**. A configured profile, skill, hook or MCP
server does not prove that a host can run a model or invoke a tool. The structural audit is
`npm run tools:audit`; its dated report is written to
`reports/audits/tool-interoperability-YYYY-MM-DD.{json,md}`.

## Current host matrix

Configuration audit date: **2026-10-28**. The dated audit at
[`reports/audits/tool-interoperability-2026-10-28.md`](../../reports/audits/tool-interoperability-2026-10-28.md)
records **6/6 configuration PASS**, 28 expected critical skills and fresh assets on all six hosts.
Execution evidence below is still the bounded 2026-10-26 set (not re-run). Caveat from the
2026-10-28 regeneration: a first run at 13:16Z returned OpenCode `WARN` with
`runtimeVariant=unsupported` (the audit reads `opencode --version` with a 3 s timeout and does not
grant PASS when the variant is unreadable); the reported run at 13:24Z and a repeat gave PASS/`v1`
(CLI 1.19.4). The failure was not reproduced; the WARN was not hidden by inheriting capabilities.
Separately, `config/tool-opencode.json` was aligned the same day (`version: 1.19.4`, the CLI the
stack launches); the audit still gates on major `v1`/`v2`, so profile metadata never grants PASS.

| Host           | Configuration                                         | Runtime / launcher evidence                            | Real execution evidence                                                                        | Remaining limit                                                                   |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| OpenCode       | PASS; 21 agents, 32 skills, Engram MCP, fresh assets, variant `v1` (CLI 1.19.4) | CLI runtime and launcher available                     | Synthetic `glm-5.3-flash-free` inference returned `READY`; prior `sdd-apply` delegation passed | Qualification fixture for delegated SDD timed out at 45s; no blanket parity claim |
| Codex          | PASS; 21 agents, 35 skills, Engram MCP, fresh assets  | Native desktop host and MCP tools available            | Harness k=3: 12/12 rollouts and 9/9 sessions                                                   | Semantic judge 0/9; no verified rule adoption                                     |
| ZCode          | PASS; 21 agents, 29 skills, Engram MCP, safe hooks    | ZCode desktop 3.16.3 installed; no `zcode` command     | Not qualified                                                                                  | App is present, but no fresh synthetic execution was run                          |
| MiniMax Code   | PASS; 29 skills, Engram MCP; agent count not reported | Desktop / pi-agent runtime; no stack launcher detected | 2026-10-26, M3.1-Flash: synthetic `READY` returned in 5s                                       | Only inference qualified; native tool/MCP execution remains untested              |
| GitHub Copilot | PASS; 29 skills, Engram MCP, fresh assets             | Copilot CLI 1.0.103 installed; MCP config and skills load | Inference attempt blocked: monthly Copilot quota exceeded; no model result                   | Retry inference after quota reset; native tool execution remains untested         |
| Antigravity    | PASS; 29 skills, Engram MCP, fresh assets             | Desktop runtime; no stack launcher detected            | 2026-10-26, Gemini 3.8 Flash High: synthetic `READY` returned in 7s                            | Only inference qualified; native tool/MCP execution remains untested              |

The audit output is configuration evidence only. OpenCode, Codex, MiniMax Code and Antigravity have
the bounded execution evidence listed above; ZCode remains execution `SKIP` because no fresh task was
run, and Copilot remains `SKIP` because the model request was rejected by the monthly quota before
inference. The OpenCode SDD qualification
fixture timed out after 45 seconds even though simple inference works; the timeout does not qualify
delegated execution. Ollama is a local model substrate, not another host. Do not report the stack as
universally homologated until each supported host has a fresh, attributable execution result.

## Qualification protocol

For each host, record the date, host/runtime version, selected model, task prompt, tool/MCP calls,
resulting artifact, independent verification and limitations. Use a small synthetic task that does
not expose project or client data. Qualify separate capabilities separately:

1. Model inference completes and returns a valid response.
2. A native agent/tool call runs and produces an expected artifact.
3. Engram MCP can read and write a disposable test observation when that capability is in scope.
4. Skills and hooks load from the intended project scope.
5. A failure can be surfaced without silently claiming success or switching to an unqualified model.

Configuration audits can run with:

```sh
npm run tools:audit
```

The audit must remain explicit that it does not execute model or tool tasks. Never convert
configuration `PASS` or execution `SKIP` into execution `PASS`.

## Operating defaults

- ODD is inline-first for small, understood work. SDD remains available for multi-session or
  high-risk work, or when the owner requests it.
- Model selection and failover must use fresh health evidence and qualified targets. A configured
  provider is not proof that it is reachable or suitable.
- Keep project data local by default. Remote qualification uses minimal synthetic inputs.
- `npm run tools:audit:write` can update the dated audit report; review its diff before committing.

## Scope

This matrix covers the six integrations currently audited by Gentle-Vanguard. Other editors may
consume generic instructions or skills, but they are outside the current execution qualification set
until the same evidence is collected.
