# Demo 04 — Quality Gates, Review & Audit (v2.14.0)

**Audience:** Development Team / Tech Lead  
**Duration:** ~15 min  
**Stack version:** v2.14.0+

---

## Goal

Show the full quality enforcement pipeline: from PSScriptAnalyzer static analysis in CI, through SDD
gate, to Judgment Day adversarial review — all automated and integrated into the daily git workflow.

---

## What You'll Demonstrate

| #   | Capability                         | Command / Artifact                      |
| --- | ---------------------------------- | --------------------------------------- |
| 1   | Static analysis (PSScriptAnalyzer) | `ps-lint.yml` in CI                     |
| 2   | SDD spec gate                      | `gv sdd-gate`                           |
| 3   | 7D pre-commit validation           | `git commit` (hook fires automatically) |
| 4   | Full QA gate                       | `gv judgment-day`                       |
| 5   | Code review                        | `gv review`                             |
| 6   | Audit report                       | `gv audit`                              |
| 7   | Agent-verify (14 checks)           | `gv check`                             |

---

## Run Steps

### Step 1 — Check quality gate status

```powershell
gv check
# Expected: 14/14 PASS
# Look for: quality-gate-workflows, workflow-hardening, tests-passing
```

### Step 2 — SDD Gate (blocks without spec)

```powershell
gv sdd-gate
# Shows: status of SDD docs (validated/active/done required)

# What happens without SDD:
# → hook fires on git commit → EXIT 1 → commit blocked
# → CI sdd-gate.yml → fails PR check
```

### Step 3 — Make a commit, watch hooks fire

```powershell
# Stage a change
git add scripts/utilities/my-new-script.ps1
git commit -m "feat: add new utility"

# Pre-commit output:
# [QUALITY] All checks passed.
# [TESTING] Todos los tests pasaron.
# [GITFLOW] Mensaje sigue convención: ✓
# [OK] Pre-commit checks passed!
```

### Step 4 — PSScriptAnalyzer (shows in CI)

```powershell
# Locally simulate what ps-lint.yml does:
Import-Module PSScriptAnalyzer
Invoke-ScriptAnalyzer -Path scripts/ -Recurse -Severity Error
# Expected: 0 errors (warnings are advisory only)
```

### Step 5 — Full QA Gate (Judgment Day)

```powershell
gv judgment-day
# Runs: dual adversarial review
# Agents: DEV reviews → QA adversarial → synthesis
# Output: docs/judgment/YYYY-MM-DD-judgment.md
```

### Step 6 — Review + Audit

```powershell
gv review
# AI-assisted multi-dimension review

gv audit
# Full audit report → docs/audits/YYYY-MM-DD-HHmmss-audit.md
```

### Step 7 — SDD Metrics

```powershell
gv sdd-metrics
# Shows: SDD status distribution, cycle time per phase, SLO compliance
# -AsJson flag for programmatic use
```

---

## Expected Outcome

- Audience sees that quality is **built into the workflow** — not an afterthought
- Every commit is validated by 7 dimensions automatically
- PSScriptAnalyzer blocks broken PS1 code before it reaches `main`
- SDD gate proves that "no spec = no merge" is enforced, not optional
- Management can see traceable audit artifacts for compliance
