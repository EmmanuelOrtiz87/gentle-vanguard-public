---
name: multi-platform-gateway
description: >
  Multi-platform messaging gateway for Telegram, Discord, and WhatsApp. Manages
  inbound message processing, outbound delivery, NL scheduler, auto-inbox,
  ReAct agent, and RPC subagent protocol.
---

# Multi-Platform Gateway

## Activation

Use when user mentions "gateway", "telegram", "discord", "whatsapp", "mensaje",
"notificación", "notificaciones", "alerta", "reporte automático", "schedule",
"programar", "recordatorio", or when processing inbound messages from external
platforms or managing scheduled tasks.

## Architecture

```
Telegram ─┐
Discord  ─┤── gateway.js ──► agent (ReAct) ──► tools (12)
WhatsApp ─┘     │                │
                │                ├── gateway_status / process_inbox
                │                ├── list_schedules / schedule_*
                │                ├── load_skill / session_info
                │                └── execute_command / read|write|search
                │
           scheduler.js (cron) ──► .session/gateway/outbox/
                │
           auto-inbox (sessionIntegration) ──► agent.processMessage()
                │
           RPC server (opcional) ──► scripts/rpc/rpc-server.js
```

## How It Works

The gateway runs as a persistent Node.js process. It connects to messaging
platforms, runs a ReAct agent with 12+ tools, and has a cron scheduler. The
agent can also be reached via RPC protocol for zero-context-cost tool calls.

**NL Scheduler**: Users say "send me metrics every morning at 9" or "cada 5
minutos mandame el estado" via any platform — the agent parses NL to cron and
creates recurring tasks.

**Auto-Inbox**: When `sessionIntegration.autoProcessInbox` is true (config),
unprocessed inbox messages are automatically fed to the agent.

## Hard Rules

- ALL inbound messages saved to `.session/gateway/inbox/` as JSON
- ALL outbound messages go through `.session/gateway/outbox/` as JSON
- Scheduler tasks persist in `.session/gateway/schedules.json`
- Gateway config: `config/gateway.json`
- Auto-reply only to `allowedNumbers` / `allowedChatIds`
- RPC server (port 8732) is optional, start with `gv gateway rpc start`

## Commands

| Command | Description |
|---------|-------------|
| `gv gateway start` | Start gateway process in background |
| `gv gateway stop` | Stop gateway process |
| `gv gateway status` | Show gateway status and stats |
| `gv gateway process` | Load pending inbound messages into session |
| `gv gateway send <platform> <to> <msg>` | Queue a message to send |
| `gv gateway logs` | Show last 50 log lines |
| `gv gateway install` | Install as Windows scheduled task |
| `gv gateway uninstall` | Remove scheduled task |
| `gv gateway setup` | Show setup instructions |
| `gv gateway tools` | List all 12 gateway agent tools |
| `gv gateway rpc start [port]` | Start RPC subagent server |
| `gv gateway rpc stop` | Stop RPC server |
| `gv gateway rpc status` | Check RPC server health |

## NL Scheduler

The gateway agent can create scheduled tasks via NL:

- "every 5 minutes send me a report to whatsapp"
- "every day at 9 AM send git status to telegram"
- "cada hora mandame las metricas"
- "lunes a viernes a las 10 enviar reporte"
- "remind me to review PRs every morning"

Supported formats:
- Minutes: `every X min`, `cada X minutos`
- Hours: `every X hours`, `cada X horas`
- Daily: `every day at HH:MM`, `todos los dias a las HH`
- Weekdays: `weekdays at HH`, `lunes a viernes a las HH`
- Weekly/monthly: `weekly`, `monthly`, `semanal`, `mensual`
- Specific day: `every Monday at HH`, `cada lunes a las HH`
- Time of day: `morning/afternoon/night`, `manana/tarde/noche`
- AM/PM: `9 AM`, `2:30 PM`, `10:00`

## Agent Tools (12)

The ReAct agent has these tools:

**Execution & Files:**
- `execute_command` — shell/pwsh/git commands
- `read_file` / `write_file` — file I/O
- `search_files` — regex search
- `list_directory` — explore structure
- `git_command` — git operations

**Gateway & Agent:**
- `gateway_status` — gateway state + platform status
- `process_inbox` — process pending messages
- `list_schedules` — list cron tasks
- `load_skill` — load skill/<name>/SKILL.md
- `session_info` — session context

**Scheduler:**
- `schedule_create` — create task from NL or cron
- `schedule_list` / `schedule_remove` — manage tasks
- `schedule_parse_time` — debug NL time parsing

**Communication:**
- `send_message` — respond to user's platform

## RPC Protocol (scripts/rpc/)

Start the RPC server for zero-context-cost tool calls:

```powershell
gv gateway rpc start        # Start on port 8732
.\scripts\rpc\rpc-client.ps1 -Health          # Check
.\scripts\rpc\rpc-client.ps1 -Tool read_file -Args '{"path":"config/gateway.json"}'
.\scripts\rpc\rpc-client.ps1 -ListTools       # List all tools
```

Endpoints: POST /rpc, POST /rpc/batch, POST /rpc/watch, GET /health, GET /tools

## Session Integration

Auto-inbox (config `sessionIntegration.autoProcessInbox: true`):
- Gateway polls inbox every N ms and feeds unprocessed messages to the agent
- No manual `gv gateway process` needed if enabled

When session-autostart runs:
1. Check if gateway is running
2. If `isPeakHour=false`, auto-process inbox
3. Notify user of unread messages count

## Platform Setup

### Telegram
1. Chat @BotFather → `/newbot` → get token
2. Get chat ID: message @userinfobot
3. Set `telegram.token` and `telegram.allowedChatIds`

### Discord
1. https://discord.com/developers/applications
2. New Application → Bot → Copy token → Message Content Intent
3. Invite bot with `bot` + `messages.read` scopes
4. Set `discord.token` and `discord.allowedChannelIds`

### WhatsApp
1. Set `whatsapp.enabled: true` in config
2. Start gateway — QR code appears in terminal
3. Scan with WhatsApp (Settings → Linked Devices)
4. Session persists in `.session/gateway/whatsapp-session/`
5. Set `whatsapp.allowedNumbers` (sin prefijo pais)

## References

| File | Purpose |
|------|---------|
| `scripts/gateway/gateway.js` | Main process + auto-inbox |
| `scripts/gateway/gateway-manager.ps1` | CLI manager (start/stop/status/rpc) |
| `scripts/gateway/agent/agent.js` | ReAct agent + NL scheduler routing |
| `scripts/gateway/agent/tools.js` | 12 tool definitions + handlers |
| `scripts/gateway/agent/system-prompt.js` | Dynamic system prompt |
| `scripts/gateway/agent/context.js` | Gateway state + project context |
| `scripts/gateway/agent/scheduler.js` | Cron scheduler engine |
| `scripts/gateway/agent/nl-time-parser.js` | NL→cron (EN/ES, 24 patterns) |
| `scripts/gateway/agent/scheduler-integration.js` | NL schedule bridge |
| `scripts/rpc/rpc-server.js` | HTTP RPC server |
| `scripts/rpc/rpc-client.ps1` | PowerShell RPC client |
| `scripts/rpc/rpc-protocol.md` | Protocol spec |
| `config/gateway.json` | Gateway configuration |
