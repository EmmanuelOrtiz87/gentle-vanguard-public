# Policy Engine — Deterministic Governance for Gentle-Vanguard

**Location**: `src/security/policy-engine/`  
**Version**: 1.0.0  
**ADR**: ADR-0027 (Policy Engine Fail-Closed)

## Overview

> "Prompt-level safety is not a control surface" — OWASP LLM01:2025

The Policy Engine provides **deterministic** enforcement of security policies **before** tool execution. Unlike reactive guardrails (that handle failures post-hoc), the Policy Engine intercepts tool calls and evaluates them against declarative policies, making certain actions **structurally impossible**.

```yaml
# Example: policy.yaml
apiVersion: governance.toolkit/v1
kind: Policy
metadata:
  name: production-policy
spec:
  defaultAction: allow
  rules:
    - name: block-destructive
      condition: "action.type in ['drop', 'delete', 'truncate']"
      action: deny
      description: "Destructive operations require human approval"

    - name: require-approval-for-email
      condition: "action.type == 'send_email'"
      action: require_approval
      approvers: ["security-team"]
```

## Philosophy

| Approach | When Tool Executes | Policy Check | Guarantees |
|----------|-------------------|--------------|------------|
| **Prompt-level** | After LLM decides | "Please don't..." | None (probabilistic) |
| **Guardrails** | After tool called | "If it fails..." | Reactive only |
| **Policy Engine** | **Before** execution | **Deterministic evaluation** | **Structurally impossible to bypass** |

## Architecture

```
Tool Request → Policy Engine → [YAML/OPA/Cedar evaluation]
                              ↓
                    ┌────────┴────────┐
                    ↓                 ↓
               ALLOW              DENY
               execute            raise GovernanceDenied
               + audit            + audit
```

## Single Statement API

```typescript
import { govern } from './policy-engine.js';

// Wrap any tool function
const safeTool = govern(myTool, policy="policy.yaml");

// Every call is checked, logged, enforced
safeTool({ action: "read", table: "users" });     // → executes
safeTool({ action: "drop", table: "users" });     // → raises GovernanceDenied
```

## Command Reference

```bash
# Lint policy files
npm run policy:lint -- policies/

# Dry-run policy against sample
npm run policy:dry-run -- --policy policies/shell.yaml --input '{"cmd": "rm -rf /"}'

# Validate all policies
npm run policy:validate

# Test policy against scenarios
npm run policy:test -- --policy policies/production.yaml
```

## User Guide

See: `docs/guides/POLICY-ENGINE.md`

## Compliance

- OWASP Agentic Top 10: ✓ LLM01 (Prompt Injection)
- NIST AI RMF: ✓ MANAGE-2.2 (Risk Management)
- MITRE ATLAS: ✓ AML.T0010 (Supply Chain)

---

*"Trust what the system can derive, not what the agent says"*
