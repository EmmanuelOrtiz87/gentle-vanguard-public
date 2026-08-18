# Subagent Architecture

## 1. Purpose

Define a parallel, token-efficient execution model for the Gentle-Vanguard orchestrator by splitting
work into specialized subagents with bounded context.

## 2. Design Principles

1. Minimize context per subagent using scoped task packets.
2. Execute independent tasks in parallel whenever dependencies allow it.
3. Keep a single coordinator responsible for plan, merge, and final decisions.
4. Enforce strict output contracts so results can be merged with low token cost.
5. Persist only durable findings to memory; avoid full transcript replay.

## 3. Agent Topology

### 3.1 Coordinator (Orchestrator)

Responsibilities:

1. Build execution graph.
2. Split task into lanes.
3. Dispatch subagents in parallel.
4. Merge outputs and resolve conflicts.
5. Produce final response and action summary.

**Implementation**: Slim orchestrator with ~5K tokens context.

### 3.2 Specialized Sub-Agents (29 Agents)

The gentle-vanguard defines 29 agent codes mapped to opencode subagents. Below is the **core 7** —
the full 29-agent mapping lives in `config/subagent-mapping.json`.

| Agent   | Role                  | Skills Loaded                                    | Token Budget |
| ------- | --------------------- | ------------------------------------------------ | ------------ |
| **BA**  | Business Analysis     | bdd-scenarios, documentation                     | ~2-3K        |
| **SAD** | Solution Architecture | architecture, api-design, databases              | ~3-4K        |
| **DEV** | Development           | angular, react, tailwind, zustand, zod, security | ~3-4K        |
| **QA**  | Quality Assurance     | testing, playwright, pytest                      | ~2-3K        |
| **OPS** | DevOps                | docker, k8s, terraform, git-workflow             | ~2-3K        |
| **GOV** | Governance            | observability, incident-response, security       | ~2-3K        |
| **DOC** | Documentation         | sdd, bdd, github-pr                              | ~2K          |

Extended agents (22 more): BUS-TELE, SCRIPT-GOV, REPORT, PR-REVIEW, RELEASE, SESSION, SESSION-CLOSE,
DAILY, PREMORTEM, FINANCE, LEGAL, MKT, SALES, HR, ORCHESTRATOR, GITFLOW-BRANCH, GITFLOW-PR,
GITFLOW-HOOKS, GITFLOW-MERGE, GITFLOW-WORKFLOW, GITFLOW-COMMIT, GITFLOW-CONFLICT. See
`config/subagent-mapping.json` for full details.

**Token Efficiency**: ~60% savings vs monolithic orchestrator (~20K vs ~50K tokens/session).

### 3.3 Worker Lanes (Legacy Mapping)

1. Discovery lane **AGENT-BA** + **AGENT-SAD**
2. Implementation lane **AGENT-DEV**
3. Validation lane **AGENT-QA**
4. Governance lane **AGENT-GOV** + **AGENT-DOC**

## 3.4 Agent Invocation

```TypeScript
# List agents
.\src/cli/gv.ts agent list

# Check readiness
.\src/cli/gv.ts agent status

# Delegate task
.\src/cli/gv.ts agent DEV "implement login feature"
.\src/cli/gv.ts agent QA "validate checkout flow"
```

## 4. Execution Graph

## 4.1 Phase A - Plan

1. Coordinator receives objective.
2. Creates lane packets with constraints and acceptance criteria.
3. Assigns dependency labels:

- independent
- depends-on:<lane>

## 4.2 Phase B - Parallel Execution

1. Run all independent lanes concurrently.
2. If a lane fails, coordinator decides retry, fallback, or stop.
3. Dependent lanes start only when prerequisites are complete.

## 4.3 Phase C - Merge

1. Merge by file ownership first.
2. Resolve conflicts by priority:

- validation safety
- functional correctness
- style/documentation

3. Emit final consolidated result.

## 5. Token Optimization Strategy

1. Task packet size budget per lane: 1.5k to 2.5k characters.
2. Include only:

- objective
- touched file list
- required symbols
- acceptance checks

3. Exclude full chat history.
4. Use context-pack artifacts for state handoff between batches.
5. Return compact structured output (no narrative unless requested).

## 6. Subagent Output Contract

Each lane must return structured JSON matching the opencode subagent result schema:

```json
{
  "lane_id": "agent-DEV-timestamp",
  "agent": "DEV",
  "opencode_subagent": "sdd-apply",
  "role": "Developer - Implementation",
  "status": "success|failed|blocked|partial",
  "task": "implementation task description",
  "action": "run|plan|validate",
  "timestamp": "2026-05-02T...",
  "skills_loaded": ["angular-spa", "typescript"],
  "skills_missing": [],
  "deliverables_expected": ["source-code", "refactoring"],
  "files_touched": [],
  "findings_or_changes": [],
  "validation_result": { "passed": true },
  "next_action": "merge-output",
  "token_estimate": 2400,
  "confidence_score": 85,
  "delegation_command": "task --description '...' --subagent_type sdd-apply"
}
```

**Required fields:**

1. `lane_id` - Unique identifier for this execution lane
2. `status` - success | failed | blocked | partial
3. `opencode_subagent` - The actual opencode subagent type used
4. `files_touched` - Array of modified files
5. `findings_or_changes` - Max 8 bullets with key changes
6. `validation_result` - Pass/fail with details
7. `next_action` - What should happen next

**Optional but recommended:**

- `confidence_score` - 0-100 rating of result quality
- `token_estimate` - Tokens consumed by this lane
- `delegation_command` - Exact command used for reproduction

## 7. Parallelism Policy

1. Max parallel lanes by risk level:

- low: 4
- medium: 3
- high: 2

2. Default lane timeout: 8 minutes.
3. Retry policy: 1 retry for transient failures.
4. Stop policy: hard stop on security-critical findings.

## 8. Suggested Session Workflow

1. Generate compact baseline:

```TypeScript
./src/cli/gv.ts context-pack "<objective>"
```

2. Set response mode for compressed operations:

```TypeScript
./src/cli/gv.ts response-mode ultra
```

3. Execute coordinator-led parallel slices.

4. Regenerate context pack after merge milestone.

5. Run review and audit only once after consolidated merge.

## 9. Governance and Safety

1. No lane may push directly to remote.
2. Coordinator is the only role that approves final publish.
3. All validation evidence must be attached before final sign-off.
4. Reset/demo scripts may use cleanup mode, but release workflows cannot skip governance checks.

## 10. Adoption Plan

1. Start with demo and docs/review tasks (low risk).
2. Extend to refactor and feature slices once stable.
3. Keep architecture and orchestrator config aligned.
4. Track cycle time and token consumption per run for tuning.

## 11. Advanced Token Controls

1. Packet budget guardrails:

- Keep lane packets between 1.5k and 2.5k characters.
- Hard cap context files per lane to avoid prompt bloat.

2. Deduplication policy:

- Collapse equivalent findings before merge.
- Keep only one canonical finding per root cause.

3. Discovery caching:

- Cache read-only discovery facts for short TTL windows.
- Reuse cached facts when file hashes are unchanged.

4. Auto-compaction policy:

- Regenerate context pack every 2 completed lanes or major merge.
- Never replay full transcript to workers.

5. Merge compression:

- Coordinator receives structured lane outputs only.
- Narrative detail is optional and requested on-demand.

## 12. Metrics to Track

### Basic Metrics

1. Tokens per completed lane.
2. Tokens per merged file.
3. Reused cached discovery ratio.
4. Duplicate finding reduction ratio.
5. End-to-end cycle time versus baseline.

### Enhanced Metrics (with subagent-mapping.json)

6. **Delegation accuracy** - How often the correct opencode subagent was selected
7. **Subagent efficiency** - Token cost per opencode subagent type
8. **Skill coverage** - Percentage of agent skills actually loaded/used
9. **Confidence calibration** - Correlation between confidence score and actual success
10. **Fallback rate** - How often fallback subagent (general) was used

### Learning Metrics

11. **Routing improvement** - Change in delegation accuracy over time
12. **Keyword effectiveness** - Which keywords best predict correct routing
13. **Agent specialization** - How well agents stick to their boundaries
14. **Cross-agent collaboration** - Success rate when multiple agents involved

## 12.1 Metrics Collection Implementation

```TypeScript
# Store metrics in Engram for persistence
function Save-SubagentMetrics {
    param(
        [string]$Agent,
        [string]$OpenCodeSubagent,
        [int]$ConfidenceScore,
        [string]$Status,
        [int]$TokensUsed,
        [array]$SkillsLoaded
    )

    $metrics = @{
        timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
        agent = $Agent
        opencode_subagent = $OpenCodeSubagent
        confidence_score = $ConfidenceScore
        status = $Status
        tokens_used = $TokensUsed
        skills_loaded = $SkillsLoaded
        delegation_command = "task --description '...' --subagent_type $OpenCodeSubagent"
    }

    # Save to Engram
    # This would call engram_mem_save with type "discovery"
    # Title: "Subagent delegation: $Agent -> $OpenCodeSubagent"
    # Content includes metrics summary
}
```

Metrics are persisted to Engram with topic_key `metrics/subagent-delegation` for trend analysis.

## 13. Token Alert and Continuity Playbook

1. Soft alert (>= soft threshold):

- Continue with compact mode.
- Split work into smaller slices.
- Prefer context-pack plus compact-start before next lane.

2. Hard alert (>= hard threshold):

- Stop non-essential parallel lanes.
- Execute closure-safe flow to avoid blocked session.
- Preserve state and handoff context before ending.

3. Mandatory alert details:

- Current estimated tokens.
- Used tokens today.
- Projected budget percentage.
- Exact threshold reached.
- Suggested alternatives with runnable commands.

4. Mandatory Engram continuity:

- Engram must be available for all guarded flows.
- If missing, alert must include install path and launcher fallback.
- Session closure should always include an Engram-supported handoff option.

## 14. Operator Commands

1. Manual budget check:

```TypeScript
./src/cli/gv.ts token-guard
./src/cli/gv.ts token-guard publish
```

2. Engram readiness and usage:

```TypeScript
./src/cli/gv.ts install-engram
./scripts/utilities/run-engram.ps1 --help
<!-- REF-OBSOLETA: scripts/utilities/run-engram.ps1 no tiene equivalente TS (migración PS1→TS) -->
```

## 15. Implementation Reference

**Full specification**: See
[skills/multi-agent-registry/SKILL.md](../../skills/multi-agent-registry/SKILL.md)

**Skill mapping matrix**: 35+ skills distributed across 29 agents with zero overlap redundancy. See
`config/subagent-mapping.json` for the complete agent→skill matrix and `config/auto-delegation.json`
for trigger→keyword mappings.
