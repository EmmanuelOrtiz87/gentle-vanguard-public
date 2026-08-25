# Demo 06 — Executive Overview (v2.14.0)

**Audience:** Executive Council / Management / Stakeholders  
**Duration:** ~20 min  
**Stack version:** v2.14.0+  
**Format:** Dashboard + narrative walkthrough

---

## Goal

Communicate the **business impact** of Gentle-Vanguard in three dimensions:

1. **Velocity** — how the stack accelerates delivery cycles
2. **Control** — how governance prevents quality debt and surprise failures
3. **Cost** — how token budgeting and automation reduce AI spend

No technical deep-dive. Evidence-based. Visual-first.

---

## Talking Points (before running commands)

> "Every time a developer commits code, 7 automated checks run silently in under 3 seconds.
> Security, quality, architecture, tests, API, docs, and git conventions — all validated. No manual
> review step required for 90% of changes."

> "We have 125 specialized AI agents pre-configured for different domains. When a developer types
> 'implement authentication', the system knows to route that to the Security + DEV agents with the
> correct TypeScript + Zod patterns loaded. No prompting required."

> "Our AI spend is capped and tracked. We cannot accidentally overspend — there's a hard block at
> 90% of daily budget with full audit trail."

---

## Run Steps

### Step 1 — Open HTML Dashboard (visual impact opener)

```powershell
gv dashboard
# → Generates and opens reports/dashboard.html
```

**What to show on screen:**

- KPI cards: Sessions, Dispatches, Token spend
- Event distribution chart: shows the system is actively coordinating agents
- Token usage trend: budget is controlled, no runaway spend
- Green/Yellow/Red traffic light: current stack health at a glance

### Step 2 — Stack Health (30 seconds)

```powershell
gv check
# Expected: 14/14 PASS
```

> "This is our automated health check. 14 dimensions verified in seconds. This runs on every push to
> main — we know instantly if something breaks."

### Step 3 — Stack Version + Scale

```powershell
gv version
# Output: Gentle-Vanguard v2.14.0 | orchestrator: v2.14.0
#         Stack: 7.5.0 on windows
#         Skills: 125
```

> "125 specialized knowledge modules, all available on demand. Zero memory overhead when not in
> use."

### Step 4 — CI Pipeline Overview

Open `.github/workflows/` in GitHub — show the 10 active workflows.

> "10 automated pipelines protect every merge. PSScriptAnalyzer catches code quality issues. OWASP
> scans for vulnerabilities weekly. Dependabot keeps dependencies updated automatically. If any of
> these fail, the PR cannot merge — enforced by branch protection."

### Step 5 — SDD Gate (governance story)

```powershell
gv sdd-gate
gv sdd-metrics
```

> "We enforce that no code ships without a specification. Not a policy in a document — a technical
> gate that blocks the commit. Compliance is automatic."

### Step 6 — Benchmark (SLO evidence)

```powershell
gv benchmark status,health,verify
# Output: status 0.8s (SLO: 5s) PASS
#         health 2.1s (SLO: 15s) PASS
#         verify 4.3s (SLO: 30s) PASS
```

> "Our SLOs are measured in real time. The tooling is fast enough that it doesn't slow developers
> down — it runs in the background."

### Step 7 — Generate Management Report

```powershell
.\scripts\utilities\TELEMETRY-METRICS\generate-management-report-simple.ps1
# Output: docs/reports/management-report-YYYY-MM-DD.md
```

---

## Key Numbers to Emphasize

| Metric                | Value                 | Business meaning                     |
| --------------------- | --------------------- | ------------------------------------ |
| Quality gate checks   | 14/14 pass            | Zero blind spots in pipeline         |
| CI Workflows          | 10 active             | Every angle of quality covered       |
| Skills available      | 125                   | Full-stack AI expertise on demand    |
| Token budget          | 30K/day, hard capped  | Predictable AI operating cost        |
| Pre-commit validation | 7 dimensions          | Quality at the source, not at review |
| Release automation    | Tag → GitHub Release  | Zero manual release steps            |
| Spec enforcement      | SDD gate blocks merge | Governance is technical, not process |

---

## Expected Outcome

Management leaves with:

- Visual evidence that the stack is healthy and active (dashboard)
- Understanding that quality gates are **automated** (not human-dependent)
- Confidence that AI spend is **controlled and auditable**
- A clear picture of scalability: 125 skills, 10 workflows, 7 agents — all managed by one platform
