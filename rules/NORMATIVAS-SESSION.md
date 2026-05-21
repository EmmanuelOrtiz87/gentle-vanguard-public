# NORMATIVAS-SESSION.md — Session Lifecycle Standards

Version: 1.1.0 Last updated: 2026-05-12

---

## 1. PROPOSITO

Define el lifecycle completo de sesiones en Gentle-Vanguard. Aplica a todos los agentes AI que
operan sesiones de desarrollo.

---

## 1.1 DOCUMENTOS LOCAL-ONLY — PROHIBICIÓN DE COMMIT

> **REGLA CRÍTICA**: Los artefactos de sesión son información de trabajo interna. **NUNCA** deben
> ser commiteados al repo ni publicados.

### Documentos que NUNCA van al repo

| Tipo                            | Ejemplos                                                    | Ubicación local                   |
| ------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| Closure reports                 | `PROJECT-CLOSURE-REPORT.md`, `closure-report-*.md`          | `.local/session-artifacts/`       |
| Delivery checklists             | `FINAL-DELIVERY-CHECKLIST.md`                               | `.local/session-artifacts/`       |
| Implementation logs             | `IMPLEMENTATION-LOG.md`, `README-IMPLEMENTATION.md`         | `.local/session-artifacts/`       |
| Session start/context packs     | `*-session-start.md`, `*-context-pack.md`                   | `docs/sessions/` (local-only)     |
| Next session guides             | `NEXT_SESSION_GUIDE.md`                                     | `.local/session-artifacts/`       |
| Strategic/phase plans de sesión | `STRATEGIC-OPTIMIZATION-PLAN.md`, `PHASE-*-ARCHITECTURE.md` | `.local/session-artifacts/`       |
| Lessons learned temporales      | `LESSONS-LEARNED-*.md`                                      | `.local/session-artifacts/`       |
| Session tasks pendientes        | `docs/tasks/*session*.md`                                   | `.local/session-artifacts/`       |
| Telemetry runtime               | `.telemetry/initialization-session-*.json`                  | Local — cubierto por `.gitignore` |
| Session logs                    | `logs/session-*.json`, `session/*.json`                     | Local — cubierto por `.gitignore` |
| Engram session data             | `.engram/session-*.md`, `.engram-data/`                     | Local — cubierto por `.gitignore` |
| Métricas de sesión CSV          | `docs/sessions/metrics/*.csv`                               | Local — cubierto por `.gitignore` |

### Criterio de decisión: ¿Va al repo o no?

```
¿El documento es permanente y útil para CUALQUIER desarrollador futuro?
   → SÍ: Puede ir al repo (normativas, guías de referencia, scripts, skills)
   → NO: Queda en .local/ o en ruta cubierta por .gitignore
```

### Regla de enforcement

1. Todo patrón local-only está declarado en `.gitignore` (sección "Session artifact docs")
2. El directorio `.local/` es local-only: está en `.gitignore`, **nunca** se trackea
3. Si un agente genera estos archivos durante una sesión, **DEBE** guardarlos en
   `.local/session-artifacts/` o en las rutas cubiertas por `.gitignore`
4. No commitear con `git add .` sin revisar — siempre usar `git add <archivo>` explícito o revisar
   `git status` primero

---

## 2. SESSION LIFECYCLE

### 2.1 Estados de Sesión

```
INACTIVE → STARTING → ACTIVE → CLOSING → CLOSED
                        ↓
                     COMPACTED (recoverable)
                        ↓
                     ACTIVE (restored)
```

| State     | Description                     | Transitions            |
| --------- | ------------------------------- | ---------------------- |
| INACTIVE  | No session active               | → STARTING             |
| STARTING  | Session init in progress        | → ACTIVE               |
| ACTIVE    | Session operational             | → CLOSING, → COMPACTED |
| COMPACTED | Context compressed, recoverable | → ACTIVE (restore)     |
| CLOSING   | Shutdown in progress            | → CLOSED               |
| CLOSED    | Session terminated              | → INACTIVE             |

### 2.2 Startup Protocol

When starting a session, execute ALL steps in order:

#### Phase A — Init

1. **MUST** run `scripts/utilities/pre-process-input.ps1 -UserInput "<message>" -WorkspaceRoot "."`
   BEFORE first response (AI-NORMATIVES.md #1, CRITICAL)
2. **MUST** run `scripts/utilities/session-autostart.cmd` (Windows) or equivalent
3. **MUST** call `engram_mem_session_start` with unique session ID
4. **MUST** call `engram_mem_context` to restore previous context
5. **MUST** check `git status` for dirty workspace

Session ID pattern: `session-YYYY-MM-DD-XX` (e.g., `session-2026-05-10-01`)

#### Phase B — Analysis & Reporting

6. **MUST** read `scripts/.session/startup-summary.json` — parse `isPeakHour`, `sessionId`,
   `workspaceClean`, `engramRunning`
7. **MUST** create `todowrite` for tracking work
8. **SHOULD** run `scripts/utilities/agent-verify.ps1` to validate state
9. **MUST** report startup summary to user in compact block (peak hour, session ID, workspace state)
10. **MUST** run `mem_search "lessons learned"` and incorporate recent observations into working
    state
11. **SHOULD** review Watchtower output (autostart Phase 10) for any issues detected

### 2.3 Active Session

During active session:

1. **MUST** call `mem_save` after significant work (architecture, bugfix, pattern, config)
2. **MUST** call `mem_search` before starting work that may have been done before
3. **SHOULD** maintain `todowrite` with current progress
4. **SHOULD** validate work with `agent-verify.ps1` periodically
5. **MUST** save lessons to Engram proactively — do NOT wait for user instruction. Triggers for
   automatic `mem_save`:
   - Bug found and fixed (what was wrong, why, how fixed)
   - Non-obvious gotcha discovered (edge case, platform quirk, tool limitation)
   - Architectural decision made (tradeoffs, alternatives considered)
   - Integration pattern that works (what connected, how)
   - Something broke and why (root cause, prevention)
   - Config change with non-obvious implications
   - Performance insight or optimization discovered

### 2.4 Close Protocol

When closing a session:

1. **MUST** run `mem_session_summary` with structured summary
2. **MUST** save key decisions to Engram via `mem_save`
3. **MUST** update `NEXT_SESSION_GUIDE.md` with current state
4. **SHOULD** run `git status` to verify clean state
5. **SHOULD** validate configs with `validate-configs.ps1`
6. **MUST** call `engram_mem_session_end` (built-in tool, NOT a standalone script) to mark session
   complete in Engram. Only available from tool-capable clients (OpenCode, Claude Code, Cline). Do
   NOT attempt to call from PowerShell.
7. **MUST** detect concurrent active sessions and close by explicit `SessionId` when count > 1
8. **MUST** run `scripts/utilities/session-learning-capture.ps1 -Trigger close` to capture session
   lessons
9. **SHOULD** run `scripts/utilities/self-diagnosis-autonomous.ps1 -Depth quick` to detect issues
   for next session
10. **SHOULD** run the Self-Improving Pipeline (usage-tracker → skill-nudge → skill-auto-patch):
    ```powershell
    pwsh -NoProfile -File scripts/skills/usage-tracker.ps1
    pwsh -NoProfile -File scripts/skills/usage-tracker.ps1 -Nudge
    pwsh -NoProfile -File scripts/skills/skill-nudge.ps1
    pwsh -NoProfile -File scripts/skills/skill-auto-patch.ps1 -AutoApply
    ```
    Updates skill usage metrics, detects failure patterns, and auto-applies patches for
    urgent/repeated issues.

#### Concurrent Session Safety (MANDATORY)

If multiple active sessions exist, closure MUST be explicit and non-destructive:

1. List active sessions (`session-*.json` with `status=active`)
2. Emit a close notification indicating concurrent sessions are active
3. Require explicit target session ID for closure
4. Do NOT auto-close "latest active" without target when more than one session is active

Recommended command:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/utilities/session-manager.ps1 -Mode End -TargetSessionId <session-id>
```

---

## 3. SESSION CONTINUITY

### 3.1 Cross-Session State

Preserved between sessions:

| Artifact             | Location                                   | Purpose                 |
| -------------------- | ------------------------------------------ | ----------------------- |
| Engram memory        | `.engram-data/`                            | Persistent knowledge    |
| Session files        | `.session/session-*.json`                  | Session state snapshots |
| Orchestrator state   | `.session/orchestrator-state.json`         | Agent dispatch state    |
| Token budget         | `.session/token-autopilot-state.json`      | Token tracking          |
| Constraint retention | `.session/constraint-retention-state.json` | Earned trust state      |
| NEXT_SESSION_GUIDE   | `docs/NEXT_SESSION_GUIDE.md`               | Session handoff doc     |

### 3.2 Recovery from Compaction

When recovering from context compaction:

1. Read `mem_context` immediately after compaction
2. Restore from `.session/orchestrator-state.json` if exists
3. Continue working ONLY after state restoration confirmed

### 3.3 Crash Recovery

If session terminates unexpectedly:

1. Start new session with `session-autostart.cmd`
2. Check `.session/` for latest state files
3. Read `engram_mem_context` for recent context
4. Read `docs/NEXT_SESSION_GUIDE.md` for handoff notes
5. Run `agent-verify.ps1` to validate workspace integrity

---

## 4. SESSION ROUTING

### 4.1 Auto-Delegation

Session commands are routed via `config/auto-delegation.json`:

| Trigger                           | Agent   | Skill                  |
| --------------------------------- | ------- | ---------------------- |
| "guardar sesion", "close session" | SESSION | session-workflow-skill |
| "continuar", "continue"           | SESSION | session-workflow-skill |
| "estado", "status"                | SESSION | session-workflow-skill |
| "cerrar sesion", "fin de sesion"  | SESSION | session-workflow-skill |

> **Note**: "iniciar sesion" / "start session" is handled directly by the canonical startup protocol
> in `CLAUDE.md` — NOT routed via auto-delegation.

### 4.2 BA/SDD Activation During Session

BA + sdd-lifecycle is **automatically activated** when user triggers project/component creation:

| Trigger                             | Context                          | SDD Phase | Action                                       |
| ----------------------------------- | -------------------------------- | --------- | -------------------------------------------- |
| "create project", "nuevo proyecto"  | User wants new project           | EXPLORE   | Gather requirements, constraints, tech stack |
| "new component", "nueva componente" | User wants new feature/component | EXPLORE   | Understand needs, acceptance criteria        |
| "bootstrap", "scaffold", "template" | User wants project template      | EXPLORE   | Specify project structure and conventions    |

**Important**: These triggers skip directly to BA/SDD EXPLORE. The user is NOT asked "do you want BA
first?" — BA activation is automatic and transparent.

Pre-process-input.ps1 detects these keywords → routes to BA agent + sdd-lifecycle skill → EXPLORE
phase begins.

See: `config/auto-delegation.json#keywordMappings.BA` for complete trigger list.

---

### 4.2 SESSION Agent Profile (unchanged)

```json
{
  "temperature": 0.1,
  "hallucinationGuard": "high",
  "hedgingBlocked": true,
  "maxRetries": 1,
  "escalateOnFailure": "orchestrator",
  "requiredEvidence": ["session state captured", "git status verified"]
}
```

---

## 5. SESSION AUDIT

### 5.1 What Gets Logged

Each session tracks:

- Session ID and start/end timestamps
- Key decisions made
- Files changed
- Tests run and results
- Blockers encountered
- Token consumption

### 5.2 Session Summary Structure

```markdown
## Goal

[One sentence: what was built/worked on]

## Accomplished

- ✅ [Completed tasks]
- 🔲 [Pending tasks]

## Discoveries

- [Technical learnings, gotchas, edge cases]

## Relevant Files

- path/to/file — what changed
```

---

## 6. COMPLIANCE CHECKPOINTS

TODO sesión DEBE verificar:

1. `pre-process-input.ps1` executed BEFORE first response
2. Session ID follows `session-YYYY-MM-DD-XX` pattern
3. `startup-summary.json` read and peak hour reported to user
4. Watchtower output reviewed from autostart Phase 10
5. `mem_session_start` called before work
6. `todowrite` created at session start
7. `agent-verify.ps1` run at session start (SHOULD)
8. Significant decisions saved to Engram
9. Session state recoverable after compaction
10. `mem_session_summary` called before close
11. Post-session learning analysis — run `gv learning` to detect gaps and generate improvement
    proposals
12. Auto-execute proposals — run `gv learning apply` to scaffold missing skills, patch configs, etc.
13. Self-healing check — run `gv heal` post-watchtower if issues detected, or `gv watchtower heal`
    for combined check + auto-heal
14. NEXT_SESSION_GUIDE.md updated
15. Git workspace in clean/reported state before close

---

## 7. REFERENCES

| Resource                 | Path                                           |
| ------------------------ | ---------------------------------------------- |
| Session Workflow Skill   | `skills/session-workflow-skill/SKILL.md`       |
| Session Autostart        | `scripts/utilities/session-autostart.cmd`      |
| Pre-Process Input        | `scripts/utilities/pre-process-input.ps1`      |
| Post-Autostart Summary   | `scripts/utilities/post-autostart-summary.ps1` |
| Startup Summary Data     | `scripts/.session/startup-summary.json`        |
| Routing Config           | `config/auto-delegation.json`                  |
| Orchestrator Config      | `config/orchestrator.json`                     |
| AI Normatives            | `rules/AI-NORMATIVES.md`                       |
| Performance & Efficiency | `rules/NORMATIVAS-PERFORMANCE.md`              |
| Code Standards           | `rules/NORMATIVAS-CODIGO.md`                   |
| Error Handling           | `rules/NORMATIVAS-ERROR-HANDLING.md`           |
| Development Standards    | `rules/DEVELOPMENT-STANDARDS.md`               |
| Agent Verify             | `scripts/utilities/agent-verify.ps1`           |
| Validate Configs         | `scripts/utilities/validate-configs.ps1`       |
| Handoff Guide            | `docs/NEXT_SESSION_GUIDE.md`                   |

---

_Version: 1.0.0 — 2026-05-10 — Status: ACTIVE_
