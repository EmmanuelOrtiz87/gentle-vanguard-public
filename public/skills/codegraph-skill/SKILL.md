---
name: codegraph-skill
description: >
  Semantic code graph for intelligent codebase exploration. Uses CodeGraph MCP tools to query
  symbols, call chains, imports, and impact analysis with 1-3 tool calls instead of 30-50+
  grep/glob/read. Trigger: "codegraph", "code graph", "symbol search", "call graph", "impact
  analysis", "find callers", "find callees", "code structure", "codebase index", "semantic search",
  "affected tests".
metadata:
  source: GV-native
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

## Semantic Search Capabilities

Beyond standard FTS5 keyword search, GV provides semantic enhancement wrappers:

| Script                          | Purpose                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `codegraph-semantic-search.ps1` | Dual-tier search: FTS5 + fuzzy synonym matching with relevance scoring        |
| `codegraph-enrich.ps1`          | Enriches CodeGraph output with layer detection, complexity tags, and metadata |

### Usage Examples

```powershell
# Semantic search
.\scripts\codegraph\codegraph-semantic-search.ps1 -Query "where is auth handled" -MaxResults 10

# Enrich query results
.\scripts\codegraph\codegraph-enrich.ps1 -Query "session" -EnrichLevel full
```

### Synonym Map

The semantic search includes an expandable synonym map for common dev terms: auth, error, config,
db, api, test, ui, cache, net — each maps to 5-10 related terms.

### Integration Note

When using `codegraph_context` for task context, first run a semantic search via
`codegraph-semantic-search.ps1` to identify the most relevant symbols, then pass those to
`codegraph_context` for deeper exploration.

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

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)

## Known Issues

The following failure pattern has been detected and documented automatically:

- **Issue**: Add timeout configuration and retry logic
- **Error types observed**: timeout

> Auto-documented by skill-auto-patch.ps1 on 2026-05-25.
