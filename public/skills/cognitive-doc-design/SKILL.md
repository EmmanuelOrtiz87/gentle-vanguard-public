---
name: cognitive-doc-design
description: >
  Design documentation that reduces reader cognitive load through progressive disclosure, chunking,
  signposting, tables, checklists, and recognition over recall. Trigger: when writing guides,
  READMEs, RFCs, onboarding docs, architecture docs, or review-facing documentation.
license: Apache-2.0
metadata:
  author: gentle-vanguard (adapted for Gentle-Vanguard)
  version: '1.0'
metadata:
  source: GV-native
---

# Cognitive Doc Design (Gentle-Vanguard Adaptation)

## When to Use

Load this skill when creating or editing documentation that people/agents need to understand
quickly, retain, or use during review.

Use it especially for:

- PR descriptions and review notes
- Contributor or maintainer guides
- Architecture, workflow, or onboarding docs
- Any doc that currently feels long, dense, or hard to scan
- Gentle-Vanguard READMEs (main, AGENTS.md, docs/guides/)

## Critical Patterns

| Pattern                 | Rule                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Lead with the answer    | Put the decision, action, or outcome first. Context comes after.                       |
| Progressive disclosure  | Start with the happy path, then add details, edge cases, and references.               |
| Chunking                | Group related information into small sections. Keep flat lists short.                  |
| Signposting             | Use headings, labels, callouts, and summaries so readers know where they are.          |
| Recognition over recall | Prefer tables, checklists, examples, and templates over prose that must be remembered. |
| Review empathy          | Design docs so reviewers can verify intent without reconstructing the whole story.     |

## Documentation Shape (Gentle-Vanguard Standard)

Use this structure for all Gentle-Vanguard docs (adapted from native-tools):

```markdown
# <Outcome-oriented title>

<One paragraph: what changed, who it helps, and why it matters.>

## Quick Path

1. <First action>
2. <Second action>
3. <Verification or expected result>

## Details

| Topic  | Decision              |
| ------ | --------------------- |
| <area> | <concise explanation> |

## Checklist

- [ ] <Reader can confirm this>
- [ ] <Reader can confirm that>

## Next Step

<Link or action that continues the workflow.>
```

## Adaptation for Gentle-Vanguard

### 1. Lead with Answer (Gentle-Vanguard Rule)

```markdown
## ✅ RESULT (put first)

- Fix: 5 broken links repaired
- Move: 27 scripts to scripts/utilties/
- Rename: LEARNED-NORMS.md → TECH-ADAPTIVE-001-learned-norms.md
```

### 2. Chunking (Gentle-Vanguard Rule)

- Max 200 lines per doc section
- Group by: Problem → Solution → Metric
- Use tables for structured data (not prose)

### 3. Signposting (Gentle-Vanguard Rule)

```markdown
## 🔍 Discovery (what we found)

## 🛠️ Fix Applied (what we did)

## 📊 Result (what changed)

## 🎯 Conclusion (what we learned)
```

### 4. Recognition over Recall (Gentle-Vanguard Rule)

```markdown
| Check      | Status   | Metric                  |
| ---------- | -------- | ----------------------- |
| Audit      | ✅ 100%  | 0 broken links          |
| Judgment   | ✅ PASS  | 2-5 min (micro-scoping) |
| Validation | ✅ 33/33 | 100% pass rate          |
```

### 5. Review Empathy (Gentle-Vanguard Rule)

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
