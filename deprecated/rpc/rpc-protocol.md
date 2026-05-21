# RPC Subagent Protocol

## Overview
Lightweight HTTP RPC protocol for invoking workspace tools without going through the full agent LLM loop. Reduces context cost in multi-step pipelines by allowing scripts (PowerShell, Node.js, Python) to call tools directly.

## Architecture
```
Script (PS/Node/Python)          RPC Server (Node.js)        Workspace
        |                              |                         |
        |--- POST /rpc --------------->|                         |
        |   { tool, args }            |--- executeTool() ------->|
        |                              |   read/write/search     |
        |<-- { result, duration } -----|   exec commands         |
        |                              |   git operations        |
```

## Quick Start
```powershell
# Start server
node scripts/rpc/rpc-server.js --port 8732

# Call a tool (PowerShell)
.\scripts\rpc\rpc-client.ps1 -Tool read_file -Args '{"path":"config.json"}'

# List tools
.\scripts\rpc\rpc-client.ps1 -ListTools

# Health check
.\scripts\rpc\rpc-client.ps1 -Health
```

## Endpoints
| Method | Path          | Description                    |
|--------|---------------|--------------------------------|
| POST   | /rpc          | Execute a single tool          |
| POST   | /rpc/batch    | Execute multiple tools         |
| POST   | /rpc/watch    | Poll a tool until condition    |
| GET    | /health       | Server health + stats          |
| GET    | /tools        | List all available tools       |

## Request/Response
```json
// POST /rpc
{ "tool": "read_file", "args": { "path": "config.json" }, "id": "req-001" }
// Response
{ "id": "req-001", "result": { "success": true, "output": "..." }, "duration": 12 }
// Error
{ "id": "req-001", "error": "Unknown tool: foo", "duration": 0 }
```

## Available Tools
All gateway tools (execute_command, read_file, write_file, search_files, list_directory, git_command, send_message) plus RPC-specific:

- **rpc_health** — Server stats (uptime, request count, tool count)
- **rpc_batch** — Execute tools in `sequential` or `parallel` mode
  - `{ mode, tasks: [{ tool, args }] }` → `{ results: [...] }`
- **rpc_chain** — Feed output of one tool into the next
  - `{ chain: [{ tool, args, extract }] }`
  - extract: `$` = full previous result, `.field` = field value, omit = inject as `input`
- **rpc_watch** — Poll a tool until condition met
  - `{ tool, args, intervalMs, maxPolls, condition }`
  - condition format: `"field == value"`, `"output contains done"`

## Security
- **Localhost only** — no authentication (future: API key via `X-RPC-Key` header)
- Blocked tools: none currently; `send_message` is a no-op in RPC context
- Rate limiting: none (future: configurable)

## Error Codes
| Code | Meaning                          |
|------|----------------------------------|
| 400  | Bad request (missing tool, invalid JSON) |
| 404  | Unknown endpoint                 |
| 405  | Method not allowed               |
| 500  | Tool execution error             |
| 504  | Tool timeout (30s default)       |

## Integration with Gateway
The gateway agent can delegate long-running tasks to the RPC server via `rpc_batch`/`rpc_watch`, keeping the agent's context window clean. The gateway's `tools.js` can also be configured to use `rpc-client.ps1` for heavy operations.
