---
name: judgment-day
description:
  'Trigger: "judgment day", "judgment-day", "dual review", "juzgar". Parallel adversarial review
  protocol using two blind judge sub-agents, synthesis, fix, and re-judge cycle.'
license: Apache-2.0
metadata:
  author: gv version: '1.4'
metadata:
  source: GV-native
---

# Judgment Day

## Activation Contract

Load this skill when:

- User explicitly says "judgment day", "judgment-day", or equivalent trigger phrases
- After significant implementations before merging
- When high-confidence review with multiple perspectives is needed
- When the cost of a production bug is higher than the cost of two review rounds
- Spanish input → respond in Rioplatense. English input → respond in English.

## Hard Rules

1. **MUST NOT** declare APPROVED until: Round 1 judges return CLEAN, OR Round 2+ confirms 0
   CRITICALs + 0 confirmed real WARNINGs (theoretical warnings and suggestions may remain)
2. **MUST NOT** push, commit, or code-modify until re-judgment completes after fixes
3. **MUST NOT** save summary or say "done" until every JD reaches APPROVED or ESCALATED
4. After Fix Agent returns, **IMMEDIATE** next action is re-launching judges in parallel
5. Multiple JDs run independently — one completing does NOT skip rounds on another
6. **MUST preserve MINORITY POSITIONS** in output — never suppress dissenting views (Gemini
   Principle)
7. **MUST flag SYCOPHANCY** when a judge changes verdict between rounds without citing new evidence
8. **Orchestrator NEVER reviews code itself** — only launches judges, reads results, synthesizes
9. Judges MUST be launched as `delegate` (async) so they run in **parallel**
10. Fix Agent MUST be a separate delegation — never reuse a judge as fixer
11. Always wait for BOTH judges to complete before synthesizing
12. Suspect findings (only one judge) reported but NOT auto-fixed — triage and escalate if needed
13. Theoretical warnings reported as INFO, NOT fixed, do NOT trigger re-judgment

## Decision Gates

```
Target scope clear?
  YES → continue
  NO  → ask user to specify scope

Skill registry exists (Pattern 0)?
  YES → build Project Standards block
  NO  → warn user, proceed generic review

Judges return findings?
  Clean (0 CRITICAL + 0 real WARNING) → JUDGMENT: APPROVED
  Issues found → present verdict, ask user

User response to fix offer (Round 1)?
  YES → delegate Fix Agent → re-judge
  NO  → JUDGMENT: ESCALATED
  Custom feedback → adjust fix list accordingly

After 2 fix iterations still issues?
  Ask "Continuar iterando? / Should I continue iterating?"
  YES → continue fix+judge cycle
  NO  → JUDGMENT: ESCALATED
```

## Execution Steps

1. **Skill Resolution (Pattern 0)** — Search engram for skill registry
   (`mem_search(query: "skill-registry")`) → match skills by code and task context → build
   `## Project Standards (auto-resolved)` block. Inject into all judge and fix prompts.
2. **Launch blind judges** — Delegate Judge A + Judge B in parallel (async). Both receive identical
   prompts with Project Standards. Neither knows about the other.
3. **Wait and synthesize** — Use `delegation_read` for both. Classify each finding: Confirmed (both
   judges), Suspect A/A only, Suspect B/B only, Contradiction (disagree on same item).
4. **Convergence check** — If 0 CRITICALs + 0 confirmed real WARNINGs → JUDGMENT: APPROVED.
   Theoretical warnings and suggestions may remain.
5. **Fix cycle** — Present verdict to user. ASK before fixing. On confirmation: delegate Fix Agent
   with confirmed issues list. After fix: re-launch both judges in parallel.

---

> **Referencia detallada**: [ eferences/detail.md](references/detail.md)
