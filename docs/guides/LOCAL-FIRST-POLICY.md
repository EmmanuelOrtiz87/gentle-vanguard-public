# Local-First Policy

## Purpose

This document defines the **local-first** approach for AI tools in gentle-vanguard.

## Core Principle

**Prioritize local knowledge over external sources.**

AI agents must use:

1. Project skills (`skills/`)
2. Persistent memory (engram)
3. Local documentation (`docs/`, `README.md`)
4. Cached responses and context
5. External search ONLY when orchestrator requires it

## Tool Restrictions

### Deny by Default

| Tool         | Status                 | Rationale                                                               |
| ------------ | ---------------------- | ----------------------------------------------------------------------- |
| `websearch`  | **ASK** (orchestrator) | Orchestrator may ask user before external search; subagents DENY        |
| `codesearch` | **DENY**               | Use local grep and project patterns                                     |
| `webfetch`   | **ASK** (orchestrator) | Orchestrator may ask user before fetching external docs; subagents DENY |

### Allow Only for Orchestrator

External tools are **only available** when:

- User explicitly requests external research
- Orchestrator agent requires it for complex tasks
- Local knowledge proven insufficient after checking:
  - Project skills (`skills/`)
  - Engram memory (`mem_search`, `mem_context`)
  - Project documentation

**Mechanism**: In `opencode.json`, the `orchestrator` (primary) agent sets `websearch: ask` and
`webfetch: ask` — the orchestrator prompts the user for confirmation before each external call,
preserving token control. All 20 subagents keep `websearch: deny` / `webfetch: deny`.

## Configuration Files

Each AI tool has a local-first configuration:

| Tool     | Config File                             | Purpose                                             |
| -------- | --------------------------------------- | --------------------------------------------------- |
| OpenCode | `opencode.json`                         | Agent permissions for websearch/codesearch/webfetch |
| Cursor   | `.cursorrules`                          | IDE-specific local-first rules                      |
| Windsurf | `.windsurf/config.json`                 | IDE configuration with restrictions                 |
| Claude   | `CLAUDE.md`                             | Claude-specific local-first approach                |
| Cline    | `.clinerules`                           | Cline plugin restrictions                           |
| Copilot  | `.github/copilot-instructions.md`       | GitHub Copilot instructions                         |
| VS Code  | `templates/editor/vscode/settings.json` | Editor settings with Copilot config                 |

## Efficiency Settings

### Model Configuration

- **Temperature**: 0.3 (focused, deterministic)
- **Max Tokens**: 4500
- **Cache**: Enabled (setCacheKey: true)

### Context Management

- **Hot**: Active session, no compression
- **Warm**: 1 day, 90% retention
- **Cold**: 7 days, 70% retention

### Memory

- **Project**: `gentle-vanguard`
- **Engram project**: `workspace_gentle_vanguard`
- **Session pattern**: `session-YYYY-MM-DD-XX`

## Language Preference

- **Communication**: Spanish (es)
- **Technical terms**: English (preserve original terminology)

## Caching Strategy

1. **Prompt caching**: Enabled via `setCacheKey: true`
2. **Response caching**: Cache frequent patterns
3. **Skill caching**: Cache loaded skills for session
4. **Project structure**: Cache for 1 hour

## When to Bypass Local-First

Only bypass when ALL conditions met:

1. Checked local skills
2. Queried engram memory
3. Read project documentation
4. User explicitly requests external search
5. Orchestrator approves tool usage

## Implementation Status

- [x] opencode.json updated
- [x] .cursorrules created
- [x] .windsurf/config.json created
- [x] CLAUDE.md created
- [x] .clinerules created
- [x] copilot-instructions.md updated
- [x] VS Code settings.json updated
- [x] Cline configs updated
- [ ] AGENTS.md updated (in progress)
- [ ] Documentation complete

## Benefits

1. **Token savings**: No unnecessary external API calls
2. **Faster responses**: Local context loads faster
3. **Consistency**: All tools follow same policy
4. **Predictability**: No surprise external calls
5. **Cost control**: Only pay for external APIs when needed

## Maintenance

- Review tool permissions quarterly
- Update config files when new tools added
- Monitor token usage via engram logs
- Validate cross-workspace consistency monthly
