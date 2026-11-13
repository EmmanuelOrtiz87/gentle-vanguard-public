# Demo 3 min — GentleVanguard (guion para video + copy pack)

> Campaña: lanzamiento del onboarding con plan firmado. Datos reales de Nexus al 2026-11-12. Fuente
> de números: `token_transactions` (5.06B tokens/60d, 48.166 calls), watchtower (154 checks),
> quickstart (survey → SHA-256 → apply). Producción: pipeline gv-shorts (job #3 en cola; requiere
> key de stock — ver "Producción" al final).

## Guion (180s, inglés, tono directo, sin hype)

### [0:00–0:20] The problem — hook

**Visual**: terminal con un AI agent escribiendo código rápido; luego un `$ git log` caótico.
**VO**: "Your AI agent writes code all day. But ask it why it made a decision yesterday — it has no
idea. Nobody re-checks the guardrails while it ships. And nobody can tell you what that session
actually cost."

### [0:20–0:45] What GentleVanguard adds

**Visual**: logo + diagrama simple: agent → orchestration / memory / verification / observability.
**VO**: "GentleVanguard is a local-first layer that wraps the agents you already use — Claude Code,
Codex, Cursor, Copilot. It adds four things they don't have: work orchestration, persistent memory
with Engram, automated verification, and full observability. Everything runs locally. Nothing leaves
your machine."

### [0:45–1:30] The signed-plan quickstart (the differentiator)

**Visual**: terminal real ejecutando `npx tsx src/quickstart/quickstart.ts` — mostrar el plan
SELECTED/deferred/excluded y el "Plan id (SHA-256)". **VO**: "Here's how onboarding works. You run
the quickstart. It surveys your machine — read-only — and prints a visible plan: what it would do,
what it won't, and why. The plan is signed with a SHA-256 id. Nothing gets written until you accept
that exact plan. If your environment changed, the old id is rejected. You never approve something
you didn't see."

### [1:30–2:15] Observability — measure everything

**Visual**: dashboard con métricas de sesión; números reales: 154 checks, tokens por modelo, costo
por sesión. **VO**: "Once it's running, everything becomes data. This stack processed five billion
tokens in sixty days — every session, every token, every dollar measured in a local SQLite database.
154 automated health checks verify the stack against its own declared quality gates. Your AI output
stops being scrollback and starts being evidence."

### [2:15–2:45] Memory — continuity between sessions

**Visual**: Engram guardando una decisión; nueva sesión recuperándola. **VO**: "Decisions persist.
Close a session, open a new one — the context, the constraints, the reasoning all survive. Your
agent finally remembers why."

### [2:45–3:00] CTA

**Visual**: README del repo con la sección "Signed-plan onboarding". **VO**: "It's MIT licensed,
open source. Clone it, run the quickstart, accept the plan — you're operational in ten minutes. Link
in the description."

## Copy pack

### YouTube description

```
GentleVanguard — the local-first governance, memory and verification layer for AI-assisted
engineering. Wraps Claude Code, Codex, Cursor and Copilot with orchestration, Engram
persistent memory, 154 automated quality checks and full token/cost observability.

In this demo: the signed-plan quickstart — a read-only survey prints a visible plan signed
with SHA-256; nothing is written until you accept it.

Open source, MIT: https://github.com/EmmanuelOrtiz87/gentle-vanguard-public
Site: https://gentlevanguard.github.io/

#aiagents #llm #developerproductivity #localfirst #observability
```

### LinkedIn post

```
Most teams measure AI coding agents by vibes. We measured ours: 5.06B tokens in 60 days,
every session, every cost — in a local database.

That's why we built GentleVanguard: the local-first layer that adds what AI agents don't
have — orchestration, persistent memory (Engram), 154 automated verification checks, and
full observability around Claude Code, Codex, Cursor and Copilot.

Our favorite part: the signed-plan onboarding. The quickstart surveys your machine
read-only, prints what it would do — and signs the plan with SHA-256. Nothing is written
until you accept that exact plan. Stale plan? Rejected. You never approve something you
didn't see.

MIT, open source, 10-minute onboarding:
→ https://github.com/EmmanuelOrtiz87/gentle-vanguard-public

#AI #DeveloperTools #EngineeringExcellence
```

### X thread (3 posts)

```
1/ Your AI agent writes code all day and remembers none of it. Nobody re-checks the
guardrails. Nobody knows the cost. We built the layer that fixes this — local-first:

2/ GentleVanguard: orchestration + Engram persistent memory + 154 automated checks +
full token/cost observability around Claude Code, Codex, Cursor, Copilot.

Onboarding is a signed plan: read-only survey → visible plan → SHA-256 → nothing
writes until you accept that exact id. Stale plan = rejected.

3/ 5B tokens measured in 60 days. MIT, open source, 10-minute setup:
https://github.com/EmmanuelOrtiz87/gentle-vanguard-public
```

## Producción (pipeline gv-shorts) — RESUELTO 2026-11-12

| Paso                                        | Estado                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Brief validado + job #3 en cola (ContentOS) | ✅ 2026-11-12                                                                              |
| LLM (Gemini)                                | ✅ key funcionando; runner honra `geminiModel` de Settings (`gemini-flash-lite-latest`)    |
| TTS                                         | ✅ GeminiTtsProvider nativo (`gemini-2.5-flash-preview-tts`); Edge TTS da 403 desde server |
| Stock footage                               | ✅ **Pixabay** (ya configurada). **Pexels NO**: emisión de keys pausada por Pexels ("New   |
|                                             | API key issuance is currently paused") — no reintentar hasta aviso                         |
| **Video generado**                          | ✅ **job #3 done**: mp4 1.6MB, 32s, 9:16 (formato Short real de YouTube) en                |
|                                             | `apps/content-cms/.runtime/shorts/`                                                        |

El guion de arriba queda como referencia para una versión extendida (3 min) o grabación en vivo
(screen capture de los comandos reales). Para variantes nuevas: encolar brief desde Content Studio
(:5175, tab Shorts) o `content_shorts_workflow`.
