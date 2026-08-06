# Token Autopilot Operations

## Purpose

Operate token-saving behavior with a simple command model, keep default hard protection, and switch
modes on demand with minimal friction.

## Default Mode (Current)

Current default is `hard` mode.

Hard mode behavior:

- Triggers only on `HARD_LIMIT` token status.
- Applies immediately (`minConsecutiveAlerts = 1`).
- Forces compact chat output (`chat-compact` -> `simple + ultra`).

Configuration source:

- `config/context-efficiency.json` -> `tokenAutopilot`

## Fast Commands

Set hard mode (recommended default for testing):

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts token-guard profile:hard
```

Set balanced mode (less aggressive):

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts token-guard profile:balanced
```

Run automatic guard + autopilot check now:

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts token-guard auto
```

On-demand chat response control:

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts response-mode ahorro
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts response-mode normal
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts response-mode detallado
```

## Profile Comparison

`hard`:

- Trigger statuses: `HARD_LIMIT`
- Consecutive alerts: `1`
- Action: immediate compaction (`chat-compact`)
- Best for: strict token budget control and rapid overflow prevention

`balanced`:

- Trigger statuses: `SOFT_LIMIT`, `HARD_LIMIT`
- Consecutive alerts: `2`
- Action: compaction after sustained pressure
- Best for: smoother UX with fewer mode changes

## Expected Savings

These are practical estimates based on current configured controls (`maxResponseTokens=2000`,
compact chat baseline, cacheDuration=7200, tighter retention):

- Output token savings in heavy threads: typically `20%` to `45%` vs verbose response patterns.
- Repeated-task savings from cache extension (3600 -> 7200): often `10%` to `25%` fewer repeated
  generation costs in same-day loops.
- Local artifact storage reduction (30 -> 14): about `53%` less retained local history volume.
- Event audit cap reduction (90d/1,000,000 -> 30d/300,000): up to `70%` lower long-tail audit
  storage footprint.

Note: exact token savings depend on workload shape and agent/task mix.

## Recommended Operational Flow

1. Keep default `hard` during trial period.
2. Monitor using `token-guard auto` during high-activity windows.
3. If mode switching feels too frequent, move to `profile:balanced`.
4. Keep manual override available for task context:
   - `ahorro` for rapid low-cost loops
   - `normal` for explanation-heavy implementation
   - `detallado` only when deep analysis is needed

## Quick Troubleshooting

If a mode command fails, run:

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/cli/gv.ts response-mode status -JSON
```

Then verify:

- `chatLevel`
- `detail`
- `active`
- `responsePolicy`
