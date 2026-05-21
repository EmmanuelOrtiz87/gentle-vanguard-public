---
name: codegraph-skill
description: >
  Semantic code graph for intelligent codebase exploration. Uses CodeGraph MCP tools to query
  symbols, call chains, imports, and impact analysis with 1-3 tool calls instead of 30-50+
  grep/glob/read. Trigger: "codegraph", "code graph", "symbol search", "call graph", "impact
  analysis", "find callers", "find callees", "code structure", "codebase index", "semantic search",
  "affected tests".
---

# CodeGraph Skill

## Overview

CodeGraph is a local-first semantic knowledge graph for codebases. It pre-indexes the entire
codebase into a queryable SQLite database (symbols, call chains, imports, inheritance, framework
routes) so agents can answer structural questions with 1-3 tool calls instead of 30-50+.

**Benchmark**: 92% fewer tool calls, 71% faster exploration compared to grep/glob/read.

## When to Use

- **Before modifying code**: Use `codegraph_context` to understand entry points and related symbols
- **Impact analysis**: Use `codegraph affected` to find which tests are transitively affected by
  changes
- **Code exploration**: Use `codegraph_explore` instead of multiple grep/glob/read calls
- **Symbol search**: Use `codegraph query` to find symbols by name across the entire codebase
- **Understanding architecture**: Use `codegraph files` to see project structure from the index

## MCP Tools Available

CodeGraph exposes 8 MCP tools when configured in `opencode.json`:

| Tool                 | Purpose                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| `codegraph_context`  | Build context for a task — returns entry points, related symbols, and code snippets |
| `codegraph_explore`  | Explore the codebase structure and relationships                                    |
| `codegraph_query`    | Search for symbols by name (FTS5-powered)                                           |
| `codegraph_files`    | Show project file structure from the index                                          |
| `codegraph_affected` | Find test files transitively affected by changed source files                       |
| `codegraph_status`   | Show index status and statistics                                                    |
| `codegraph_sync`     | Sync changes since last index                                                       |
| `codegraph_index`    | Re-index all files in the project                                                   |

## CLI Commands (for manual use)

```powershell
# Initialize index in a project
codegraph init -i

# Check index status
codegraph status

# Search for symbols
codegraph query "session"

# Build context for a task
codegraph context "find all session management functions"

# Show project file structure
codegraph files

# Find affected tests for changed files
codegraph affected src/architecture/resilience/ResilienceManager.ts

# Sync changes since last index
codegraph sync

# Re-index all files
codegraph index
```

## Integration with Gentle-Vanguard

### MCP Configuration

CodeGraph is configured as an MCP server in `opencode.json`:

```json
{
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": ["codegraph", "serve", "--mcp"],
      "enabled": true
    }
  }
}
```

### Index Location

- Index stored in `.codegraph/codegraph.db` (SQLite, local-only)
- `.codegraph/` is in `.gitignore` (never committed)
- Auto-sync via native OS file watcher (2-second debounced)

### Supported Languages

TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C, C++, Swift, Kotlin, Dart, Svelte,
Vue, Liquid, Pascal/Delphi, Scala (19+ languages).

### Framework Route Detection

Recognizes routing files for 13+ frameworks: Django, Flask, FastAPI, Express, Laravel, Rails,
Spring, Gin, Axum, ASP.NET, Vapor, React Router, SvelteKit.

## Best Practices

1. **Trust CodeGraph results**: When `codegraph_context` returns symbols and relationships, trust
   them — don't re-verify with grep/read
2. **Use `codegraph_context` first**: Before modifying any file, call `codegraph_context` to
   understand the impact radius
3. **Use `codegraph affected` for CI**: Before running tests, check which test files are
   transitively affected by your changes
4. **Sync after major changes**: Run `codegraph sync` after significant refactors to keep the index
   fresh
5. **Re-index on branch switch**: If you switch branches with significant changes, run
   `codegraph index` to rebuild

## Performance Notes

- **Native backend**: Uses `better-sqlite3` for 5-10x faster operations
- **WASM fallback**: If `better-sqlite3` is unavailable, falls back to WASM SQLite (functional but
  slower)
- **Index size**: Typically 1-5 MB for most projects
- **Sync speed**: Incremental sync is near-instantaneous with file watcher

## Troubleshooting

| Issue                         | Solution                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| "WASM SQLite fallback active" | Run `npm rebuild better-sqlite3` in CodeGraph's global install directory |
| Stale index                   | Run `codegraph sync` or `codegraph index`                                |
| Missing files                 | Check `.codegraph/config.json` include/exclude patterns                  |
| Lock file errors              | Run `codegraph unlock` to remove stale lock files                        |

## Related

- Repository: https://github.com/colbymchenry/codegraph
- License: MIT
- Version: 0.7.9

## Known Issues

### MCP Server Timeouts

**Error types observed**: timeout ("MCP server not responding", "Connection refused")

**Root cause**: CodeGraph MCP server must be running before tools can be called. If the server
failed to start or was not yet initialized, tool calls will time out.

**Mitigation protocol**:

1. **Pre-flight check**: Before calling any CodeGraph MCP tool, run `codegraph_status` first. If
   it returns an error or times out, the MCP server is not ready.
2. **Retry logic**: If a tool call fails with a timeout error:
   - Wait 2 seconds
   - Run `codegraph_status` to verify MCP connectivity
   - If status returns OK, retry the original call (max 2 retries)
   - If status fails, run the autostart sync script first:
     `pwsh -File scripts/utilities/codegraph-sync-autostart.ps1`
3. **Health check**: Run `codegraph_status | codegraph_files` as a connection canary before
   starting any complex exploration. If both return, MCP is healthy.
4. **Index rebuild fallback**: If retries and autostart sync both fail, run `codegraph index` to
   rebuild the index from scratch, then retry.

**Expected behavior after fix**:
- First call to any CodeGraph tool may return slow (~3-5s if server needs to initialize)
- Subsequent calls should be <500ms
- If timeouts persist despite retries, run the index rebuild

> Auto-documented by skill-auto-patch.ps1 on 2026-05-21. Retry protocol added on 2026-05-21.
