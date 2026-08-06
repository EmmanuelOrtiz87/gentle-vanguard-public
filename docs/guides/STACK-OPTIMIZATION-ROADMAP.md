# Stack Analysis & Optimization Recommendations

**Date**: May 13, 2026  
**Context**: Post npx-hardening implementation  
**Status**: Strategic recommendations for evolution

---

## Executive Summary

The gentle-vanguard project has excellent gentle-vanguardal tooling (git flow, security layers,
testing, audit systems). The npx hardening represents a mature shift toward supply-chain security.
Below are recommended optimizations across 5 dimensions:

| Dimension                 | Maturity    | Priority | Impact |
| ------------------------- | ----------- | -------- | ------ |
| **Supply Chain**          | Advanced ✅ | DONE     | High ↑ |
| **Testing/Observability** | Strong ✅   | Medium   | High   |
| **Dependency Management** | Good ⚠️     | HIGH     | Medium |
| **Documentation**         | Strong ✅   | Low      | Low    |
| **Performance**           | Good ⚠️     | Medium   | Medium |

---

## 1. Dependency Management Optimization

### Current State

✅ **Strengths**:

- MCP workspace isolation implemented
- npm security policy (.npmrc) in place
- `package-lock.json` lockfile discipline
- Security tests pass (33/33)

⚠️ **Gaps**:

- No `npm ci` in CI/CD pipelines (uses `npm install`)
- No automated dependency scanning (npm audit only manual)
- No lockfile-lint pre-commit hook
- No .npmrc in project root (only global)

### Recommendations

#### 1.1: Add `npm ci` to CI/CD

**Why**: `npm ci` (clean install) respects lockfile exactly; `npm install` can drift versions.

**Implementation** (in CI/CD pipeline):

```TypeScript
# Replace: npm install
# With: npm ci
npm ci
```

**Impact**:

- ✅ Prevents version drift in CI
- ✅ Faster (uses cache)
- ✅ Reproducible builds

---

#### 1.2: Add lockfile-lint Pre-Commit Hook

**Why**: Prevents accidental lockfile corruption or malicious edits.

**Implementation**:

1. Install globally:

```TypeScript
npm install -g lockfile-lint
```

2. Add to lefthook (`.lefthook/pre-commit/lockfile-lint.yaml`):

```yaml
# Validate lockfile integrity
commands:
  lockfile-lint:
    glob: 'package-lock.json'
    run: lockfile-lint --path package-lock.json
```

3. Add to gentle-vanguard lefthook config:

Create `scripts/hooks/lockfile-lint-check.ps1`:

```TypeScript
# Quick validation of package-lock.json structure
param(
    [string]$LockfilePath = ".\package-lock.json"
)

if (Test-Path $LockfilePath) {
    try {
        $lock = Get-Content $LockfilePath | ConvertFrom-Json
        if (-not $lock.lockfileVersion) {
            Write-Error "Invalid lockfile: missing lockfileVersion"
            exit 1
        }
        if (-not $lock.packages) {
            Write-Error "Invalid lockfile: missing packages object"
            exit 1
        }
        Write-Host "[OK] Lockfile structure valid"
        exit 0
    }
    catch {
        Write-Error "Invalid JSON in lockfile: $_"
        exit 1
    }
}
```

**Impact**:

- ✅ Catches corrupted lockfiles before commit
- ✅ Prevents git merge conflicts in lockfiles
- ✅ Low overhead

**Effort**: 30 minutes  
**Value**: HIGH (prevents supply-chain incidents)

---

#### 1.3: Automated npm audit in Pre-Push Hook

**Why**: Catch vulnerabilities before pushing to main/develop.

**Implementation** (in pre-push hook):

```TypeScript
# scripts/hooks/audit-pre-push.ps1

Write-Host "[AUDIT] Running npm audit..." -ForegroundColor Cyan

npm audit --audit-level=moderate
if ($LASTEXITCODE -ne 0) {
    Write-Host "[BLOCKED] npm audit found vulnerabilities" -ForegroundColor Red
    Write-Host "Run: npm audit fix" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] No vulnerabilities found" -ForegroundColor Green
exit 0
```

**Impact**:

- ✅ Blocks vulnerable code before review
- ✅ Encourages prompt patching
- ⚠️ May false-positive on already-accepted vulns

**Effort**: 20 minutes  
**Value**: MEDIUM (catches low-hanging fruit)

---

### Dependency Management Summary

| Action              | Effort     | Impact   | Timeline    |
| ------------------- | ---------- | -------- | ----------- |
| Add npm ci to CI/CD | 15 min     | HIGH     | This week   |
| lockfile-lint hook  | 30 min     | HIGH     | This week   |
| npm audit pre-push  | 20 min     | MEDIUM   | Next sprint |
| **Total**           | **65 min** | **HIGH** | **2 weeks** |

---

## 2. Testing & Observability Enhancements

### Current State

✅ **Excellent**:

- 33/33 tests pass (27 unit + 3 integration + 2 security + 1 perf)
- Security tests cover: input validation, injection prevention, encryption
- Performance tests included
- Lefthook pre-push runs full suite

⚠️ **Opportunities**:

- No code coverage reporting (% lines/branches covered)
- No E2E tests for critical flows (e.g., publish workflow)
- No chaos testing (resilience under failure)
- No performance benchmarks (baselines)

### Recommendations

#### 2.1: Add Code Coverage Baseline

**Why**: Track if tests actually exercise the code; prevent regression.

**Implementation**:

1. Install coverage tool:

```TypeScript
npm install --save-dev pester-coverage  # For TypeScript tests
```

2. Add coverage thresholds to `tests/coverage-config.json`:

```json
{
  "thresholds": {
    "lines": 80,
    "functions": 80,
    "branches": 75,
    "statements": 80
  },
  "exclude": ["build/", "node_modules/"]
}
```

3. Run in CI:

```TypeScript
.\scripts\testing\run-tests.ps1 -WithCoverage -OutputFormat html
# Generates: tests/coverage/index.html
```

**Impact**:

- ✅ Detects untested code paths
- ✅ Prevents coverage regression
- ✅ Guides test improvements

**Effort**: 2-3 hours  
**Value**: MEDIUM (long-term quality)

---

#### 2.2: Add E2E Tests for Release Workflow

**Why**: The `publish` workflow is critical; manual testing is insufficient.

**Implementation** (in `tests/e2e/`):

```TypeScript
# tests/e2e/release-workflow.e2e.tests.ps1

Describe "Release Workflow E2E" {
    BeforeAll {
        $testRepo = New-Item -ItemType Directory -Path "$env:TEMP\test-release" -Force
    }

    It "Homologation gate blocks incomplete release" {
        # Simulate incomplete VERSION alignment
        # Expect: publish blocked
    }

    It "Mandatory gates execute in order" {
        # 1. Homologation
        # 2. Tests
        # 3. Secrets scan
        # Expect: order preserved
    }

    It "Publish succeeds with all gates passed" {
        # Execute full workflow
        # Expect: commit, tag, push to main+develop
    }
}
```

**Impact**:

- ✅ Catches regressions in critical path
- ✅ Documents expected behavior
- ✅ Confidence for release day

**Effort**: 3-4 hours  
**Value**: HIGH (critical flows)

---

### Testing & Observability Summary

| Action                     | Effort        | Impact   | Timeline    |
| -------------------------- | ------------- | -------- | ----------- |
| Code coverage baseline     | 2-3h          | MEDIUM   | Next sprint |
| E2E release workflow tests | 3-4h          | HIGH     | Next sprint |
| Performance baselines      | 2h            | LOW      | Month 2     |
| **Total**                  | **7-9 hours** | **HIGH** | **Month 1** |

---

## 3. Documentation Completeness

### Current State

✅ **Excellent**:

- [SECURITY-HARDENING.md](SECURITY-HARDENING.md) — comprehensive (now including npx hardening)
- [GETTING-STARTED.md](GETTING-STARTED.md) — clear setup path
- [RELEASE-PROCESS.md](RELEASE-PROCESS.md) — detailed release workflow
- [FIRST-TIME-SETUP-CHECKLIST.md](FIRST-TIME-SETUP-CHECKLIST.md) — MCP workspace setup (Step 3)

⚠️ **Gaps**:

- No "First Time Setup" single-page quick start
- No troubleshooting runbook for common issues
- No decision tree for git flow branch selection
- No "Architecture Decision Records" (ADRs) for major choices

### Recommendations

#### 3.1: Create "First Time Setup" Checklist

**File**: `docs/guides/FIRST-TIME-SETUP-CHECKLIST.md`

**Content**:

- [ ] Clone repo
- [ ] Run `src/cli/gv.ts doctor`
- [ ] Create MCP workspace (`$HOME\mcp-workspace`)
- [ ] Verify lefthook hooks installed
- [ ] Run tests (`src/cli/gv.ts test`)
- [ ] Create feature branch
- [ ] Make first commit
- [ ] Push for review

**Effort**: 30 min  
**Value**: MEDIUM (onboarding time -50%)

---

#### 3.2: Create Troubleshooting Runbook

**File**: `docs/guides/TROUBLESHOOTING-RUNBOOK.md`

**Sections**:

- Common git flow issues (stuck in wrong branch, bad merge, etc.)
- Failing tests (how to debug, what each error means)
- Publish workflow failures (gates blocked, secrets missing)
- MCP workspace issues (offline mode failing, version mismatch)

**Effort**: 2 hours  
**Value**: MEDIUM (support time -30%)

---

#### 3.3: Create Architecture Decision Records (ADRs)

**Location**: `docs/architecture/decisions/`

**Examples**:

1. **ADR-001**: Why we use TypeScript (not Bash/Python)
2. **ADR-002**: Why MCP workspace is external (not git-tracked)
3. **ADR-003**: Why npx offline mode with workspace (threat model + mitigation)
4. **ADR-004**: Why mandatory homologation gate in publish

**Template**:

```markdown
# ADR-NNN: [Title]

## Status

Accepted | Proposed | Deprecated

## Context

[Problem/decision driver]

## Decision

[What we chose]

## Consequences

Positive:

- [+]

Negative:

- [-]

## Alternatives Considered

1. [Alternative A]
2. [Alternative B]
```

**Effort**: 3-4 hours for 4 ADRs  
**Value**: HIGH (knowledge transfer + decision traceability)

---

### Documentation Summary

| Action                        | Effort            | Impact     | Timeline    |
| ----------------------------- | ----------------- | ---------- | ----------- |
| First-time setup checklist    | 30 min            | MEDIUM     | This week   |
| Troubleshooting runbook       | 2h                | MEDIUM     | This week   |
| Architecture Decision Records | 3-4h              | HIGH       | Next week   |
| **Total**                     | **5.5-6.5 hours** | **MEDIUM** | **2 weeks** |

---

## 4. Performance & Scalability

### Current State

✅ **Good**:

- Pre-commit/pre-push hooks optimized (parallel audit, test-suite)
- TypeScript scripts use efficient patterns (minimal network calls, caching)
- Tests run in ~55 seconds pre-push

⚠️ **Opportunities**:

- No performance baseline (test suite speed over time)
- No profiling of slow operations
- No caching strategy for expensive computations (e.g., git operations)
- No load testing for multi-repo scenarios

### Recommendations

#### 4.1: Add Performance Baselines

**Why**: Catch performance regressions early; document growth curve.

**Implementation**:

Create `tests/performance/baseline.json`:

```json
{
  "audit-check": {
    "max_seconds": 2,
    "baseline": 1.2
  },
  "test-suite": {
    "max_seconds": 60,
    "baseline": 54.5
  },
  "pre-push-hooks": {
    "max_seconds": 90,
    "baseline": 60.0
  }
}
```

Add to pre-push hook validation.

**Impact**:

- ✅ Detects when changes slow the build
- ✅ Documents performance expectations
- ✅ Early warning for optimization need

**Effort**: 1-2 hours  
**Value**: LOW-MEDIUM (long-term health)

---

#### 4.2: Add Profiling for Publish Workflow

**Why**: Release workflow is critical; understand where time is spent.

**Implementation**:

Instrument `src/cli/gv.ts publish`:

```TypeScript
# Track timing for each gate
$start = Get-Date
Write-Step "Running Homologation Gate"
# ... gate logic ...
$duration = (Get-Date) - $start
Write-Host "[PROFILE] Homologation Gate: $($duration.TotalSeconds)s"
```

**Impact**:

- ✅ Identifies bottlenecks
- ✅ Guides optimization priorities
- ✅ Helps with release time predictions

**Effort**: 2-3 hours  
**Value**: MEDIUM (operational insight)

---

### Performance Summary

| Action                    | Effort         | Impact     | Timeline      |
| ------------------------- | -------------- | ---------- | ------------- |
| Performance baselines     | 1-2h           | LOW-MEDIUM | Next sprint   |
| Publish profiling         | 2-3h           | MEDIUM     | Next sprint   |
| Load testing (multi-repo) | 4-6h           | MEDIUM     | Month 2       |
| **Total**                 | **7-11 hours** | **MEDIUM** | **Month 1-2** |

---

## 5. Security & Compliance Enhancements

### Current State

✅ **Excellent** (just completed):

- ✅ NPX supply-chain hardening (offline + workspace)
- ✅ .npmrc global security policy (ignore-scripts, min-release-age, allow-git=none)
- ✅ Homologation gate (mandatory pre-publish)
- ✅ Security tests (input validation, encryption)
- ✅ Secrets management
- ✅ AES-256 encryption

⚠️ **Remaining**:

- No SBOM (Software Bill of Materials) generation
- No container image scanning (if using Docker)
- No supply-chain attestation (SLSA provenance)
- No annual security audit log

### Recommendations

#### 5.1: Generate SBOM for Release

**Why**: Track all dependencies for compliance; easier vulnerability remediation.

**Implementation** (in release pipeline):

```TypeScript
npm install -g @cyclonedx/npm

# Generate SBOM
cyclonedx-npm --output-format json --output-file sbom.json
```

**Impact**:

- ✅ Compliance with SBOM requirements
- ✅ Faster vulnerability response (know exactly what's in release)
- ✅ Supply-chain transparency

**Effort**: 1 hour  
**Value**: HIGH (compliance + incident response)

---

#### 5.2: Add Annual Security Audit

**Why**: Third-party validation; catch systemic issues.

**Action**:

1. Schedule external security audit (Q4 2026)
2. Scope: code review, dependency audit, configuration review
3. Estimate: 40-80 hours (external firm)

**Impact**:

- ✅ Professional assessment
- ✅ Board/audit-ready documentation
- ✅ Vulnerability fixes from external perspective

**Timeline**: Plan Q3, execute Q4  
**Cost**: Varies by firm (~$5-20k)

---

### Security & Compliance Summary

| Action                 | Effort       | Impact   | Timeline      |
| ---------------------- | ------------ | -------- | ------------- |
| SBOM generation        | 1h           | HIGH     | Next sprint   |
| Annual audit (plan)    | 4h           | HIGH     | Q3 planning   |
| Annual audit (execute) | 80h          | HIGH     | Q4 2026       |
| **Total**              | **85 hours** | **HIGH** | **Year 2026** |

---

## Implementation Roadmap

### This Week (Quick Wins)

```
Day 1-2:  Add lockfile-lint hook + npm ci to CI/CD
Day 3-4:  Create First-Time Setup Checklist + Troubleshooting Runbook
Day 5:    Review & test all changes
```

**Effort**: ~2 hours dev + testing  
**Impact**: HIGH (supply-chain + onboarding)

---

### Next Sprint (Medium Term)

```
Sprint 1:
  - Code coverage baseline (2-3h)
  - E2E release workflow tests (3-4h)
  - npm audit pre-push hook (1h)
  - SBOM generation setup (1h)
  - ADR-001 through ADR-004 (4h)

Total: 11-13 hours
```

---

### Q3 2026 (Long Term)

```
- Performance baselines + profiling (3-5h)
- Load testing for multi-repo (4-6h)
- Plan annual security audit (4h)
- Consider: chaos testing, chaos engineering
- Consider: supply-chain attestation (SLSA L3)
```

---

## Priority Matrix

```
┌─────────────────────────────────────────┐
│ IMPACT                                  │
│ HIGH │ Dep.Mgmt  │ Code Coverage       │
│      │ (lockfile)│ E2E Tests           │
│      │ npm audit │ SBOM                │
│      │ ADRs      │ Audit Plan          │
├──────┼───────────┼─────────────────────┤
│MEDIUM│ Perf      │ Troubleshoot Runbook│
│      │ Baseline  │ First-Setup         │
├──────┼───────────┼─────────────────────┤
│ LOW  │ Profiling │ Load Testing        │
└──────┴─────────────┴─────────────────────┘
      EFFORT: Low→High →
```

**Recommended Priority**: Dependency Mgmt (HIGH impact, LOW effort) → Tests (HIGH impact, MEDIUM
effort) → Documentation (MEDIUM impact, LOW effort)

---

## Stack Summary

| Layer               | Current                     | Recommendation             | Timeline |
| ------------------- | --------------------------- | -------------------------- | -------- |
| **Supply Chain**    | ✅ Advanced (npx hardening) | ✅ Complete                | Done     |
| **Dependency Mgmt** | Good ⚠️                     | Add lockfile-lint + npm ci | Week 1   |
| **Testing**         | Strong ✅                   | Add coverage + E2E         | Sprint 1 |
| **Documentation**   | Strong ✅                   | Add ADRs + Runbooks        | Week 1   |
| **Security**        | Excellent ✅                | Add SBOM                   | Sprint 1 |
| **Performance**     | Good ⚠️                     | Add baselines              | Sprint 2 |

---

## Conclusion

The gentle-vanguard project is **production-ready** with excellent security gentle-vanguards. The
recent npx hardening represents mature supply-chain thinking.

**Next focus**: Dependency management (lockfile validation + npm ci) and testing completeness
(coverage + E2E) provide HIGH impact for MEDIUM effort over the next 1-2 sprints.

**12-month vision**: Evolve toward SLSA L3 supply-chain provenance, annual security audits, and
chaos engineering maturity.

---

**Prepared**: May 13, 2026  
**Review Cycle**: Monthly  
**Owner**: Security/DevOps Team
