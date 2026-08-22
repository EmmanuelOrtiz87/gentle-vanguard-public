# Dashboard Executive Guide

## Objective

The executive dashboard provides a single operational and financial view of stack usage, telemetry
quality, and governance signals.

Output file:

- `reports/dashboard.html`

This guide explains:

- what every section means,
- how to interpret values,
- which values are expected, estimated, or context-dependent,
- how data is refreshed automatically.

---

## Data Sources

The dashboard combines local-first telemetry from:

- `config/metrics-config.json`
- `config/orchestrator.json`
- `.event-bus/history.json`
- `.event-bus/rate-limit-state.json`
- `docs/management/telemetry-master.csv`
- `docs/sessions/metrics/token-guard-usage.csv`
- `docs/sessions/metrics/context-usage.csv`
- `docs/sessions/metrics/agent-usage.csv`
- `docs/sessions/metrics/judgment-history.csv`
- `docs/sessions/metrics/text-simplification.csv`
- `.runtime/telemetry/cloud-agent-telemetry.csv`

If a source is missing, the dashboard keeps rendering and reports zeros or empty tables.

---

## Sections and Reading Model

## 1) Overview

Primary purpose: fast health check.

Cards:

- Sessions: unique sessions found in telemetry.
- Dispatches: total delegations to sub-agents.
- Tokens: all-time estimate from strongest available source.
- Events: emitted events over total events.
- Avg Duration / Avg Efficiency: historical means from telemetry master.
- Context Adoption: compact-start ratio.
- Runtime Requests / Latency: runtime transport quality.

Chart:

- Token Trend (last 14 days): fixed recent window for readability.
- Data freshness label:
  - `fresh`: data updated in 0-1 days,
  - `stale by N days`: no recent token records.

Proactive Alerts panel:

- Displayed at the bottom of Overview.
- Automatically derived from current telemetry on every generation.
- Green "No alerts" when all thresholds pass.
- Alert codes and their meanings:

| Code                      | Severity | Trigger condition                           |
| ------------------------- | -------- | ------------------------------------------- |
| `DATA_STALE`              | warn     | Last token record older than 3 days         |
| `BUDGET_WARNING`          | warn     | Forecast 70–89% of monthly budget           |
| `BUDGET_CRITICAL`         | err      | Forecast ≥ 90% of monthly budget            |
| `TOKEN_SPIKE`             | warn     | Any single day > 2× 14-day daily average    |
| `RUNTIME_ERRORS_MODERATE` | warn     | Error rate 10–19%                           |
| `RUNTIME_ERRORS_HIGH`     | err      | Error rate ≥ 20%                            |
| `LATENCY_ELEVATED`        | warn     | Avg latency 4 000–8 000 ms                  |
| `LATENCY_HIGH`            | err      | Avg latency > 8 000 ms                      |
| `COST_REGRESSION`         | warn     | Current month cost > +20% vs previous month |
| `LOW_EFFICIENCY`          | warn     | Avg efficiency score < 0.5                  |

Each badge includes the anomaly detail and an actionable recommendation. Alerts are stateless: they
recompute every time the dashboard is generated.

Expected interpretation:

- A stale label does not always mean failure; it may mean no activity.
- A drop to zero with stale data usually means telemetry inactivity, not optimization.

## 2) Costs & Savings

Primary purpose: financial visibility of usage and modeled efficiency.

Cards include:

- Actual Cost: all-time token-based estimate (`USD 10 / 1M tokens` default).
- MTD / YTD Cost.
- Month-End Forecast from run-rate.
- Modeled Baseline, Optimized Model, and Savings.
- Text simplification savings.

Charts and tables:

- Daily Cost Trend (last 14 days).
- Cost Allocation by Model (runtime token attribution).
- Estimated Cost Allocation by Agent (dispatch-share estimate).

Important semantics:

- `Estimated`: derived from heuristics or attribution logic.
- `Modeled`: policy simulation, not accounting ledger.
- `Actual` in this dashboard means telemetry-based estimate, not cloud invoice reconciliation.

## 3) Executive ROI

Primary purpose: budget control and executive signal.

Cards:

- Monthly Budget (USD): daily token budget x days in month.
- Budget Consumed: current MTD cost vs monthly budget.
- Forecast vs Budget: projected month-end utilization.
- Forecast Variance: forecast minus budget.
- ROI Status: governance traffic light.
- Prev Month Cost: historical reference baseline.
- MoM Cost Trend: current month vs previous month percentage variation.
- Net Benefit MTD/YTD: modeled savings minus actual estimated cost.

Charts:

- Monthly ROI Comparison (Budget vs MTD Actual vs Forecast vs MTD Saved).
- 3-Month Cost Trend (current month + previous two months).
- Recent Monthly Breakdown table for month-by-month token and USD context.

Traffic-light policy:

- GREEN: forecast below 70% of monthly budget.
- YELLOW: forecast between 70% and 90%.
- RED: forecast 90% or more.

## 4) Stack Metrics

Primary purpose: operational diagnosis.

Includes:

- token guard volume,
- context efficiency behavior,
- runtime success/error distribution,
- governance telemetry completeness.

## 5) Metrics Explorer

Primary purpose: traceability and auditability.

Raw tables expose underlying records for each source. Use this section to validate suspicious KPI
movement.

## 6) Events

Primary purpose: event-bus governance stream.

Shows recent event history and rate-limit state. Useful for identifying blocked emissions or policy
throttling.

---

## Value Classes: Expected vs Estimated vs Context-Dependent

Expected/stable metrics:

- Daily budget configuration,
- event counts,
- raw row counts,
- runtime success/error counts.

Estimated metrics:

- token-to-USD cost,
- cost allocation by model/agent,
- text simplification savings in USD.

Modeled metrics:

- optimized baseline,
- savings vs baseline,
- net benefit.

Context-dependent metrics:

- MTD/YTD cost,
- forecast,
- ROI status,
- latency,
- efficiency score.

Context-dependent values vary with:

- developer workload and task complexity,
- agent routing strategy and prompt size,
- quality gate intensity,
- number of reviews/audits and governance checks,
- active runtime provider and model behavior.

---

## Practical Threshold Guidance

Suggested operational guidance:

- Budget consumed under 50% mid-month: healthy.
- Forecast between 70-90%: review prompt size and routing strategy.
- Forecast above 90%: apply efficiency actions immediately.

Efficiency actions:

- increase compact-start/context-pack discipline,
- reduce oversized prompts,
- prefer targeted sub-agent dispatch,
- validate token-heavy workflows for avoidable loops,
- review runtime errors that may cause retries.

---

## Automation and Refresh Lifecycle

The dashboard is refreshed automatically via CI:

- `.github/workflows/dashboard-auto-refresh.yml`
  - runs daily (scheduled),
  - runs on push to `main` when telemetry or dashboard sources change,
  - publishes `reports/dashboard.html` as an artifact.

Monthly pipeline also updates dashboard snapshot:

- `.github/workflows/monthly-management-report.yml`
  - executes reporting pipeline,
  - generates dashboard,
  - uploads dashboard and report artifacts.

This enables automated refresh without requiring manual command execution for CI snapshots.

Local manual generation is still available for immediate on-machine preview:

- `pwsh -File src/telemetry/generate-dashboard.ts`

<!-- REF-OBSOLETA: src/telemetry/generate-dashboard.ts no existe (ruta migrada o eliminada) -->

---

## Troubleshooting

If charts look empty or flat:

- verify source files exist and contain recent rows,
- check freshness label in Overview,
- inspect Metrics Explorer tables for real input values,
- verify CI artifact timestamps for latest run.

If ROI looks unrealistic:

- confirm `daily_budget_tokens` in `config/orchestrator.json`,
- validate token guard data cadence,
- remember modeled savings are scenario-based.

---

## Governance Notes

The dashboard is designed for directional decisions and operational governance. For accounting or
invoice reconciliation, use provider billing exports as source of truth.
