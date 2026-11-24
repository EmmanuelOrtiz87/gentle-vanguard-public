# Desktop IDE compatibility and evidence

This matrix separates **workspace configuration** from **execution in the desktop IDE**. A profile,
skill, hook or MCP declaration does not prove that the IDE loaded it or completed a task. The
structural audit is `npm run tools:audit`; its dated report is written to
`reports/audits/tool-interoperability-YYYY-MM-DD.{json,md}`. The audit must not search for or execute
product commands, infer installed-app versions, or substitute command-line products for desktop
sessions. Existing CLIs may be evaluated separately when they close a concrete capability gap; that
evidence never qualifies a desktop session. Installing tools or changing host authentication or
configuration requires prior owner approval.

## Current desktop scope — 2026-11-16

Windows Start-menu inventory found entries for OpenCode, ZCode, MiniMax Code, GitHub Copilot,
Antigravity, Kimi, Qoder and Visual Studio Code. This is only an application-entry inventory; it
does not prove current use, version, skill loading or task execution. Codex was not returned by that
name filter, which is not sufficient evidence that it is absent.

The project audit checks declared IDE/workspace files, skill-tree hashes and persistent MCP
configuration without reading server values. Qoder's user settings at `~/.qoder/settings.json`
contain the `mcpServers.engram` entry; the audit verifies only that structural declaration. Its
`mcp-router.json` remains ephemeral. This confirms configuration, not that Qoder loaded or invoked
Engram in a desktop session. No product-command fallback is used.

| IDE surface | Configuration evidence | Desktop-session qualification |
|---|---|---|
| OpenCode | Project skills/instructions and declared Engram integration | Not established by this structural audit |
| Codex | Workspace instructions, profile, MCP declaration and fresh skills | Not established by this structural audit |
| ZCode | Desktop profile, agents, hooks, MCP declaration and fresh skills | Not established by this structural audit |
| MiniMax Code | Desktop/pi-agent profile, MCP declaration and fresh skills | Not established by this structural audit |
| GitHub Copilot / VS Code | Workspace MCP, instructions and fresh skills | Not established by this structural audit |
| Antigravity | Workspace MCP, Memory Protocol and fresh skills | Not established by this structural audit |
| Kimi | Workspace MCP declaration and fresh project skills | Not established by this structural audit |
| Qoder IDE | Fresh project skills; `mcpServers.engram` declared in user IDE settings | Native read-only task verified on 2026-11-24; see dated evidence below |

The previously recorded model/harness experiments remain historical evidence only. They are not
counted as desktop-IDE qualification unless the host session and in-IDE operation are attributable.

## Qualification protocol

For each IDE, use its desktop application and record the date, product version shown by the app,
workspace, model, synthetic prompt, observed native skill/MCP operation, resulting artifact and
independent verification. Do not include project/client data in synthetic probes.

1. The IDE opens the intended workspace and loads its workspace instructions and skills.
2. A minimal task completes in the IDE and produces the expected artifact.
3. If Engram MCP is supported, a native IDE tool invocation reads/writes a disposable test item.
4. Failures are visible; configuration presence alone never upgrades execution to PASS.

Qoder's official IDE guide describes MCP configuration through **Qoder IDE Settings > MCP** and
project skills in `.qoder/skills`: <https://docs.qoder.com/user-guide/chat/model-context-protocol>
and <https://docs.qoder.com/extensions/skills>. The audit checks only the server key in
`~/.qoder/settings.json`; it does not display configuration values or edit user-level settings.

## Operating defaults

- ODD is inline-first for small, understood work. SDD remains available for multi-session or
  high-risk work, or when the owner requests it.
- Model selection and failover must use fresh health evidence and qualified targets. A configured
  provider is not proof that it is reachable or suitable.
- Keep project data local by default. Qualification uses minimal synthetic inputs.
- `npm run tools:audit:write` can update the dated audit report; review its diff before committing.

## Scope

This matrix covers the eight desktop IDE/workspace integration surfaces currently maintained by
Gentle-Vanguard. Existing product CLIs may be assessed in a separate evidence track when a concrete
capability gap requires it; their results do not qualify desktop IDE sessions. New installations or
host authentication/configuration changes require prior owner approval.

## Desktop evidence — 2026-11-24

FTD continuation of slice B in `docs/features/GB-2026-11-21-operacion-total-pendientes.md`.
Done predicate: an observed native tool receipt must support each verified operation; a model's
summary or a configuration audit alone cannot establish execution. All probes used synthetic
read-only instructions in `C:/Workspace_local/gentle-vanguard`. No host configuration was edited.
These are dated observations, not live health checks or blanket desktop qualification.

| Desktop / selected model | Observed result | Scoped verdict |
|---|---|---|
| Qoder / Auto (resolved model not shown) | `GV_QODER_20261124`: successful native receipts for `Skill` (`engram-memory`), `Read file` (`config/tool-qoder.json`), `Load tool`, `Call tool` (`mcp__engram__mem_list_projects`). Expanded MCP receipt contained valid JSON, count 11, including the expected project. | **VERIFIED** skill loading, file reading and read-only MCP. |
| Kimi Work / K3 Alto | `GV_KIMI_20261124`: native `Read` returned the profile; Engram MCP and the memory skill were unavailable in that session. Separate `GV_KIMI_BRIDGE_20261124` completed through native `Bash`, exit 0, with a matching independent bridge receipt. | **VERIFIED** file reading and terminal bridge; direct MCP and native skill loading **NOT VERIFIED**. |
| Antigravity / Gemini 4 Hydrogen High | `GV_ANTIGRAVITY_20261124`: expanded native activity showed reads of the profile, lazy MCP schema and `engram-memory/SKILL.md`; expanded `mem_list_projects: engram` receipt contained a real JSON response, count 11. | **VERIFIED** file/skill reading and read-only MCP through `call_mcp_tool`; automatic skill loading was not established. |
| ZCode / GLM-5.3-Flash Vision selector | `GV_ZCODE_20261124`: provider returned `[1113][Insufficient balance or no resource package. Please recharge.]` before tool execution. | **NOT VERIFIED** today: external provider balance/package. |
| MiniMax Code / M3.1-Flash | `GV_MINIMAX_20261124`: task returned to `Resume execution` after one resume, without a completed inference or tool receipt. UI warned fewer than 1,000 credits remained; that does not establish exhaustion or the cause. | **INCONCLUSIVE**; no successful tool execution observed. |
| GitHub Copilot desktop / Copilot Fusion | Opened the existing workspace; task was not submitted because its default `New worktree` isolation was not changed successfully through the available UI surface. Opening the app nevertheless created two worktrees automatically; see cleanup outcome below. | **NOT VERIFIED**. This desktop observation does not qualify the VS Code extension. |

The supported Kimi fallback uses the existing native bridge, from the repository root:

```sh
npm run mcp:call -- --server engram --tool mem_list_projects --args "{}"
```

Independent receipt: `.runtime/mcp-calls.jsonl`, `2026-11-24T18:21:34.754Z`,
`via: bridge`, `server: engram`, `name: mcp__engram__mem_list_projects`, `ok: true`,
`isError: false`. This establishes the terminal route, not direct MCP exposure in Kimi.
The native Qoder and Antigravity receipts remain in their dated desktop conversations; raw
project listings and host settings are deliberately excluded from this document.

OpenCode's verified 2026-11-21 write/delegation evidence remains in
`rules/HOMOLOGACION-MULTI-TOOL.md` §9.2; it was not repeated here. Codex's historical binding
evidence remains in `docs/features/GB-20261117-tool-parity-runtime.md`. Neither is a fresh health
assertion. Today's read-only probes do not qualify memory writes, editing, delegation, restart,
or compaction. `tools:audit` remains a structural check; `tools:qualify` must retain its own
current evidence requirements rather than treating this historical table as live authority.

Copilot startup side effect: `worktrees:check` found `emmanuelortiz87-curly-lamp` and
`emmanuelortiz87-super-guide`, both clean and homologated at `7da7c6d0f`. After `guard:snapshot`,
`worktrees:clean` removed both registrations; `super-guide` was fully removed. For `curly-lamp`,
Git reported `Permission denied` and left an empty directory held open by another process;
an empty-only deletion confirmed the Windows lock. Both merged local branches were removed
with `git branch -d`. Only the primary registered worktree remains. The empty residual directory
(verified with zero entries) was removed on 2026-11-24 via `rmdir` once the process released it;
physical cleanup of this side effect is complete for the registered worktrees observed.
