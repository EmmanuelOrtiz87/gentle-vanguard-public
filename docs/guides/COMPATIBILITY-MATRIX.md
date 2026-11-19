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
| Qoder IDE | Fresh project skills; `mcpServers.engram` declared in user IDE settings | Native task and MCP invocation still need in-app qualification |

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
