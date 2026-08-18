# Token Efficiency Pack

## 1. Purpose

This pack standardizes how tasks are requested and closed in this workspace to reduce avoidable
token usage, context bloat, and rework.

Primary goals:

1. Reduce repeated context injection.
2. Reduce clarification loops.
3. Reduce broad, unnecessary code exploration.
4. Improve first-pass completion rate.

---

## 2. Scope

Use this pack for all coding tasks across the stack:

1. Fixes and refactors.
2. Reviews and audits.
3. Documentation updates.
4. Multi-repo orchestration work.

Operating policy:

1. Keep orchestration passive by default.
2. Activate stack controls on demand for active implementation windows.
3. Deactivate after closeout when continuous coordination is not needed.

---

## 3. The Five Efficiency Controls

### 3.1 Prompt Playbook (Fixed Templates)

Use one template from the playbook before starting. Keep language short and deterministic.

Required fields:

1. Goal.
2. Target files.
3. Constraints.
4. Validation command.
5. Output format.

Reference: ./templates/PROMPT-PLAYBOOK.md

### 3.2 Layered Context Protocol

Never start with full repository dumps. Send context in layers:

1. Layer A: objective + exact files + acceptance criteria.
2. Layer B: only related snippets if needed.
3. Layer C: architecture/background only if blocker appears.

Expected impact: lower context tokens and faster convergence.

### 3.3 Minimal Durable Memory

Persist only reusable facts:

1. Build and test commands.
2. Naming conventions.
3. Project-specific constraints.
4. Known gotchas and fixed patterns.

Avoid storing verbose transcripts.

### 3.4 Explicit Scope Limits Per Task

Every task must declare boundaries:

1. Max files allowed to change.
2. Modules excluded from edits.
3. Formatting constraints.
4. No unrelated refactors.

Expected impact: lower exploration tokens and lower regression risk.

### 3.5 Mandatory Closeout Checklist

At closeout, always report:

1. What changed.
2. Why.
3. Validation status.
4. Residual risks.
5. Next actions.

Reference: ./templates/CLOSEOUT-REPORT-TEMPLATE.md

---

## 4. Operating Procedure

1. Pick a playbook template.
2. Fill Layer A context only.
3. Add explicit boundaries.
4. Execute implementation.
5. Run validation.
6. Publish closeout report.
7. Persist concise memory note.
8. If orchestration was enabled on demand, deactivate stack controls at session end.

---

## 5. Measurement Model

Track these KPIs weekly:

1. Average messages per completed task.
2. Average edited files per task.
3. Clarification turns per task.
4. Reopen rate due to missing requirements.
5. Approximate token spend per task.

Suggested baseline period: 2 weeks before rollout. Suggested comparison period: 2 weeks after
rollout.

---

## 6. Savings Assumptions

Conservative assumptions for this stack:

1. 20 tasks per month.
2. Baseline 14,000 tokens per task.
3. Weighted reduction from controls: 30 percent.
4. Effective monthly reduction: 84,000 tokens.

Medium scenario:

1. Same task count and baseline.
2. Weighted reduction: 40 percent.
3. Effective monthly reduction: 112,000 tokens.

Aggressive scenario:

1. Same task count and baseline.
2. Weighted reduction: 50 percent.
3. Effective monthly reduction: 140,000 tokens.

Use scripts/utilities/token-efficiency-estimator.ps1 for custom estimates.
<!-- REF-OBSOLETA: scripts/utilities/token-efficiency-estimator.ps1 no tiene equivalente TS (migración PS1→TS) -->

### 6.1 Response-Mode Matrix (27 Combinations)

The stack now supports a combination matrix based on:

1. Language: `es | pt-BR | en`
2. Detail level: `simple | executive | expanded`
3. Compression profile: `lite | lleno | ultra`

Total combinations: $3 \times 3 \times 3 = 27$.

Generate matrix:

```TypeScript
.\scripts\utilities\response-mode-efficiency-matrix.ps1

# CSV export
.\scripts\utilities\response-mode-efficiency-matrix.ps1 -AsCsv

# Custom baseline for your team
.\scripts\utilities\response-mode-efficiency-matrix.ps1 -TasksPerMonth 35 -BaselineTokensPerTask 12000 -BaseReductionPercent 32 -AsCsv
```

This script provides ranked combinations with estimated monthly and yearly token savings.

---

### 6.2 Calibration Workflow (Recommended)

Use this process before enforcing a new default mode:

1. Choose 10 representative tasks from the last sprint.
2. For each task, run 2-3 response combinations in controlled prompts.
3. Track token usage and completion quality with the same acceptance criteria.
4. Update baseline assumptions in the matrix script parameters.
5. Select default mode based on best quality-cost ratio, not minimum tokens alone.

Calibration note:

1. Keep `executive + lite` as baseline.
2. Promote `simple + ultra` only for low-risk, high-volume operational loops.
3. Use `expanded` for high-risk or decisión-heavy tasks.

---

## 7. Rollout Plan

1. Week 1: adopt templates in all new tasks.
2. Week 2: enforce closeout and memory notes.
3. Week 3: compare KPIs against baseline.
4. Week 4: tighten boundaries for highest-volume workflows.

---

## 8. Expected Outcomes

1. Higher first-pass completion.
2. Fewer clarification loops.
3. Lower context overhead.
4. Lower monthly token consumption.
5. Faster cycle times for iterative work.
