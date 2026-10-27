# AI tool compatibility and evidence

This matrix separates **configuration** from **execution**. A configured profile, skill, hook or MCP
server does not prove that a host can run a model or invoke a tool. The structural audit is
`npm run tools:audit`; its dated report is written to
`reports/audits/tool-interoperability-YYYY-MM-DD.{json,md}`.

## Current host matrix

Audit date: **2026-10-26**. All six configuration surfaces passed. Execution status reflects bounded
evidence available on this workstation, not feature parity across every host.

| Host           | Configuration                                         | Runtime / launcher evidence                            | Real execution evidence                                     | Remaining limit                                      |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| OpenCode       | PASS; 21 agents, 32 skills, Engram MCP, fresh assets  | CLI runtime and launcher available                     | Synthetic model inference and `sdd-apply` delegation passed | No blanket parity claim for every model or skill     |
| Codex          | PASS; 21 agents, 35 skills, Engram MCP, fresh assets  | Native desktop host and MCP tools available            | Harness k=3: 12/12 rollouts and 9/9 sessions                | Semantic judge 0/9; no verified rule adoption        |
| ZCode          | PASS; 21 agents, 29 skills, Engram MCP, safe hooks    | Desktop runtime; no stack launcher detected            | Not qualified in this run                                   | Needs a bounded host task with a verifiable artifact |
| MiniMax Code   | PASS; 29 skills, Engram MCP; agent count not reported | Desktop / pi-agent runtime; no stack launcher detected | Not qualified in this run                                   | Needs a bounded host task with a verifiable artifact |
| GitHub Copilot | PASS; 29 skills, Engram MCP, fresh assets             | VS Code Agent Mode and launcher detected               | Not qualified in this run                                   | Needs an isolated Agent Mode task and artifact check |
| Antigravity    | PASS; 29 skills, Engram MCP, fresh assets             | Desktop runtime; no stack launcher detected            | Not qualified in this run                                   | Needs a bounded host task with a verifiable artifact |

The audit output is configuration evidence only. OpenCode and Codex have the execution evidence
listed above; ZCode, MiniMax Code, Copilot and Antigravity remain execution `SKIP`. Ollama is a
local model substrate, not another host. Do not report the stack as universally homologated until
each supported host has a fresh, attributable execution result.

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
