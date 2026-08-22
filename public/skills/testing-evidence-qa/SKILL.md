---
name: testing-evidence-qa
description: >
  Evidence-based QA: screenshot testing, visual proof, certification. Trigger: "evidence QA",
  "screenshot test", "visual testing", "QA certification", "production readiness".
metadata:
  source: GV-native
---

## When to Use

- Validating UI changes with visual evidence
- Certifying production readiness
- Conducting evidence-based quality gates
- Testing across multiple viewports and states
- Creating audit trails for compliance

## 📋 Technical Deliverables

### Evidence QA Report

```
## QA Certification Report: [Feature/Release]
**QA Engineer**: [name]
**Date**: [test date]
**Verdict**: ✅ PASS | ❌ FAIL

## Test Coverage
| Category | Tested | Evidence |
|----------|---------|-----------|
| Functional | 45/50 | screenshot_001.png |
| Visual | 12/12 | screenshot_045.png |
| Accessibility | 8/10 | a11y_report.pdf |
| Performance | 5/5 | lighthouse.json |

## Defects Found
1. [FAIL] Button cutoff on mobile 320px viewport (see screenshot_023.png)
2. [PASS] Form validation works on all fields
3. [FAIL] Color contrast 3.2:1 (needs 4.5:1 for WCAG AA)

## Verdict Justification
[Why PASS or FAIL with specific evidence references]
```

### Screenshot Evidence Template

```
// Screenshot naming convention
{feature}-{viewport}-{state}-{timestamp}.png

Examples:
login-desktop-default-20260415.png
checkout-mobile-error-20260415.png
dashboard-tablet-hover-20260415.png

// Metadata JSON
{
  "screenshot": "login-desktop-default-20260415.png",
  "url": "/login",
  "viewport": "1920x1080",
  "browser": "Chrome 120",
  "state": "default",
  "result": "PASS",
  "notes": "All elements visible, no console errors"
}
```

## 🔄 Workflow Process

### Step 1: Test Planning

- Identify what needs validation (new features, regressions)
- Define pass/fail criteria with evidence requirements
- Select viewports and browsers to test
- Prepare test data and test accounts

### Step 2: Evidence Collection

- Capture screenshots for every test state
- Record console logs and network traffic
- Document with metadata (viewport, browser, timestamp)
- Include both happy path and edge cases

### Step 3: Evaluation & Verdict

- Compare against acceptance criteria
- Flag deviations with specific evidence references
- Calculate pass rate and coverage
- Reach verdict: PASS (ship), FAIL (block), or CONDITIONAL (fix + retest)

### Step 4: Reporting & Handoff

- Create certification report with evidence index
- Highlight blocking issues first
- Provide fix recommendations with priority
- Archive evidence for audit trail

## 🎯 Success Metrics

You're successful when:

- **Evidence Quality**: 100% of PASS/FAIL decisions backed by screenshots
- **Verdict Accuracy**: <5% overturned on appeal (false positive/negative)
- **Coverage**: 90%+ of acceptance criteria tested with evidence
- **Report Speed**: Delivered <2 hours of code freeze
- **Audit Trail**: 100% of evidence archived with metadata

## 💭 Communication Style

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
