# Presentation Script: Gentle-Vanguard v3.8.2

This document contains detailed content for the 21 slides covering all aspects of the stack.

---

### Slide 1: Title

**Title:** Gentle-Vanguard v3.8.2 — The Future of Engineering Efficiency **Subtitle:**
Standardization, AI, and Quality as pillars of growth **Notes:** Present the overall vision for
modernizing the development area.

### Slide 2: The Silent Problem

**Key Points:**

- Environment fragmentation (different configurations between developers)
- Slow onboarding (days lost installing tools)
- Lack of up-to-date technical documentation
- Security risks (secret leaks)

### Slide 3: The Solution: Gentle-Vanguard

**Message:** An abstraction layer that unifies development. **Phrase:** "We don't just build code,
we build a platform to scale engineering."

### Slide 4: The 3 Strategic Pillars

**Suggested Graphic:** Value triangle.

1. **Automation:** Repetitive processes eliminated
2. **Quality:** Embedded security and validation (native review engine)
3. **AI-Ready:** Optimized to work with AI Agents (Engram)

### Slide 5: Simplified Architecture

**Flow:** [Base Layer: Gentle-Vanguard] -> [Tools Layer: Engram/Native Review] -> [Business Value:
Projects] **Concept:** Total independence between the technical base and business logic.

### Slide 6: The "Bootstrap Effect"

**Message:** Total configuration in a single command. **Metric:** Estimated 80% reduction in new
workstation setup time.

### Slide 7: AI as Team Member

**Concept:** Integration with MCP Protocol and Workspace-Skills. **Benefit:** AI not only generates
code, it understands our rules and architecture.

### Slide 8: Proactive Security (Guardian Angel)

**Visual:** Data protection shield. **Message:** Automatic validation of secrets and quality before
each release.

### Slide 9: The "Immaculate" Lifecycle

**Steps:**

1. Assisted development
2. Automatic validation
3. AI-generated documentation
4. Traceable release (Tags)

### Slide 10: Competitive Advantages

**Points:**

- Total agnosticism (Windows, Mac, Linux / Bitbucket, GitHub)
- Self-writing documentation (Session Reviews)
- Immaculate history for audits

### Slide 11: ROI Impact

**Comparison:**

- **Before:** 30% of time on technical bureaucracy
- **Now:** 95% of time on customer value delivery

---

### Slide 12: Tool-Agnostic Orchestration (Hidden Layer #1)

**Title:** 10 Tools, 1 Stack **Key Points:**

- Works with OpenCode, Claude Code, Cline, Cursor, Windsurf, Codex, Continue.dev, Copilot,
  Antigravity, Claude Generic
- Each tool has its own adaptive profile that auto-optimizes
- Skill and memory emulation for tools without native support (Cline, Cursor, Copilot, etc.)
- `src/core/detect-tool.ts` auto-detects which tool is running and loads the right config
- No vendor lock-in: switch tools without losing context or skills

### Slide 13: Adaptive Profiles (Hidden Layer #2)

**Title:** Self-Optimizing Configuration **Key Points:**

- Adaptive profiles for opencode, claude-cline, cursor, codex-windsurf, continue-copilot, antigravity
- Auto-detect peak hours and token pressure
- Automatically switches to optimized config during peak, restores when normalized
- Shared DRY module eliminates duplication
- Backup/restore mechanism ensures no config is lost

### Slide 14: SDD Lifecycle (Hidden Layer #3)

**Title:** Spec-Driven Development — Not Just Code **Key Points:**

- 4 phases: BA Explore -> SAD Design -> DEV Implement -> QA Verify
- Each phase has its own specialized agent (`sdd-explore`, `sdd-design`, `sdd-apply`, `sdd-verify`)
- `src/pre-process-input.ts` analyzes every message and routes to the right phase
- `PLAN_MODE_REQUIRED` flag prevents jumping to implementation without exploration
- SDD config enforces strict TDD per phase

### Slide 15: Judgment Day (Hidden Layer #4)

**Title:** 7D Validation — No Code Ships Without Passing **Key Points:**

- 7 dimensions: Security, Performance, Readability, Maintainability, Testability, Documentation,
  Architecture
- Pre-commit hooks enforce quality gates before any commit
- Watchtower runs 96 checks across 22 components
- 140+ test files across 5 suites
- Secret scanning (80 patterns) prevents secret leaks
- Result: ALL CHECKS PASS or the commit is rejected

### Slide 16: Auto-Delegation (Hidden Layer #5)

**Title:** 263 Skills, 21 Agents, Zero Manual Routing **Key Points:**

- `config/auto-delegation.json` maps keywords to skills and agents
- Every user message is pre-processed and routed automatically
- BA agent for exploration, DEV agent for implementation, DOC agent for documentation
- Skills range from SDD lifecycle to code review, from Playwright to pytest
- No manual delegation needed — the system knows what to do

### Slide 17: Session Lifecycle (Hidden Layer #6)

**Title:** Full Session Tracking — Never Lose Context **Key Points:**

- 53-step autostart pipeline: health check, tool detection, orphan cleanup, session init,
  notifications, engram policy, optimization, skill registry, plugins, adaptive profiles
- `startup-summary.json` captures: peak hours, platform, session ID, workspace state
- Native process reaper (`src/core/process-hygiene.ts`) prevents stale sessions
- Token budget tracking with `src/tokens/token-ingest.ts`
- Watchtower quick health check at session end

### Slide 18: Security & Governance (Hidden Layer #7)

**Title:** Local-First, Secure, Zero Plain-Text Secrets **Key Points:**

- Local-first operating model (ADR-0017) — no cloud dependency for core operation
- Secret scanner with 80 patterns + entropy detection
- Hash-chained audit trail (`src/event-sourcing.ts`) detects manipulation
- Public repo (`gentle-vanguard-public`) contains only safe, public content
- TruffleHog pre-commit hook scans for secrets
- `sync-to-public` strips sensitive content before syncing

### Slide 19: Autonomous Resilience (Hidden Layer #8)

**Title:** Self-Healing Stack — Failures Resolve Themselves **Key Points:**

- Unified Guardrail Orchestrator: one entry point asks "what should I do about this failure?"
- Classifies failures into 10 categories (config, network, model, db, git, security, resource,
  reasoning, quality, unknown)
- Decides the corrective action: retry, correct, escalate, isolate, continue, or block
- Learns from every incident (`.session/guardrails/incidents.jsonl`) — faster resolution over time
- Anti-loop guard detects reasoning loops and forces strategy change or escalation
- Result: the stack knows what to do and how to continue — minimal human intervention

### Slide 20: v3.8.2 — Latest Release Highlights

**Title:** Latest Release Highlights **Key Points:**

- 21 agents (Orchestrator + 20 sub-agents) all on native model
- 263 skills including adopted design/docs/marketing skills (Fases 1-3)
- Native process reaper for orphan/duplicate cleanup
- Academy web (SPA local-first, 9 tracks, 65+ lessons, glosario 115 términos)
- SDD research lane with BM25 retrieval grading
- 96/96 watchtower checks passing, 27 DB tables, 15 migrations

### Slide 21: Roadmap and Future

**Vision:**

- Expansion of the Workspace-Skills library (community contributions)
- Global project health dashboard
- Integration with corporate CI/CD pipelines
- Auto-update: Launcher checks remote version and prompts for upgrade
- Docker validation: Integration tests in containerized environments
- S3 distribution for global availability

### Slide 22: Conclusion

**Closing:** "Gentle-Vanguard is the gentle-vanguard of our technological agility." **Call to
action:** Standard implementation for all new developments. **Stats:** 21 agents · 263 skills · 10
tools · 96 checks · 5 test suites · v3.8.2

---

_Document generated for executive presentation support. Updated for v3.8.2._
