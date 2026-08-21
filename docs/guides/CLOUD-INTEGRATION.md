# Cloud Integration — Gentle-Vanguard v4.0

## Overview

Phase 1.2 adds multi-cloud skill execution with automatic failover, circuit breaker resilience, and
cost-optimized routing between AWS Lambda and Azure Functions.

## Architecture

```
                      ┌──────────────────┐
                      │  Hybrid Executor  │
                      │  (cost/latency/   │
                      │   load routing)   │
                      └────────┬─────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼                                ▼
     ┌──────────────────┐            ┌──────────────────┐
     │  AWS Delegator   │            │  Azure Delegator │
     │  (Lambda)        │            │  (Functions)     │
     ├──────────────────┤            ├──────────────────┤
     │ • Circuit breaker │            │ • Circuit breaker │
     │ • Exp. backoff    │            │ • Exp. backoff    │
     │ • S3 logging      │            │ • Cosmos backup   │
     │ • Cost metrics    │            │ • Cost metrics    │
     └──────────────────┘            └──────────────────┘
```

## Components

### AWS Delegator (`src/aws-delegator.ts`)

Invokes skills on AWS Lambda with:

- Circuit breaker pattern (CLOSED → OPEN → HALF_OPEN)
- Exponential backoff retry (1s, 2s, 4s, up to 3 attempts)
- Session state persistence to S3 (local simulation to `.session/s3-backups/`)
- Cost tracking ($0.0000167/invocation)

```TypeScript
# Basic usage
npx tsx src/cli/gv.ts `
  -SkillId "code-review" `
  -SkillInput @{ query = "Review PR #42" } `
  -RecordMetrics
```

### Azure Delegator (`src/azure-delegator.ts`)

Invokes skills on Azure Functions with:

- Same circuit breaker pattern as AWS
- Multiple auth methods: function key, bearer token, Azure CLI fallback
- Session state persistence simulation to `.session/azure-backups/`
- Dry-run mode for testing without real invocation
- Cost tracking ($0.00002/invocation)

```TypeScript
# Basic usage
npx tsx src/cli/gv.ts `
  -SkillId "code-review" `
  -SkillInput @{ query = "Review PR #42" } `
  -FunctionUrl "https://myapp.azurewebsites.net/api/skill-executor" `
  -RecordMetrics
```

### Hybrid Executor (`src/hybrid-executor.ts`)

Routes between AWS and Azure based on strategy:

- **cost**: Picks cheapest provider (AWS $0.0000167 vs Azure $0.00002 per call)
- **latency**: Picks fastest (AWS ~45ms vs Azure ~60ms)
- **load**: Picks least loaded (load/capacity ratio)
- **Fallback**: If primary fails, automatically tries secondary

```TypeScript
# Cost-based routing (default)
npx tsx src/cli/gv.ts `
  -SkillId "code-review" `
  -SkillInput @{ query = "Review PR #42" } `
  -RoutingStrategy cost `
  -RecordMetrics

# Force specific provider
npx tsx src/cli/gv.ts `
  -SkillId "code-review" `
  -SkillInput @{ query = "Review PR #42" } `
  -PreferredProvider AWS `
  -RecordMetrics
```

## Production Configuration

See `config/cloud-connectors-prod.json` for production settings:

```json
{
  "aws": {
    "region": "us-east-1",
    "functionName": "gentle-vanguard-skill-executor",
    "circuitBreaker": { "failureThreshold": 5, "timeoutSeconds": 60 }
  },
  "azure": {
    "functionUrl": "${AZURE_FUNCTION_URL}",
    "authMethods": ["functionKey", "bearerToken", "azureCLI"]
  },
  "hybrid": {
    "defaultStrategy": "cost",
    "fallbackEnabled": true
  }
}
```

## Environment Variables

| Variable                | Description                     | Required        |
| ----------------------- | ------------------------------- | --------------- |
| `AWS_ACCESS_KEY_ID`     | AWS access key                  | For AWS         |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key                  | For AWS         |
| `AWS_REGION`            | AWS region (default: us-east-1) | No              |
| `AZURE_FUNCTION_URL`    | Azure Function endpoint URL     | For Azure       |
| `AZURE_FUNCTION_KEY`    | Azure Function access key       | No (alt: token) |
| `AZURE_ACCESS_TOKEN`    | Azure bearer token              | No (alt: key)   |

## Metrics

All cloud executions record to `.session/cloud-metrics.json`:

```json
{
  "executions": [
    {
      "provider": "AWS",
      "timestamp": "2026-06-19T10:30:00",
      "duration": 234,
      "success": true,
      "cost": 0.0000167
    }
  ]
}
```

Hybrid routing metrics at `.session/hybrid-metrics.json` include outcome and strategy.

## Dashboard Integration

Available via the WS server at `/api/cloud/metrics` — provides:

- Per-provider execution count, success rate, avg latency, and total cost
- Hybrid routing strategy distribution
- Circuit breaker states

## Testing

```bash
# All cloud connector tests
npm run test -- cloud-connectors

# AWS specific
npm run test -- cloud-connectors.test.ts -t "AWS"

# Azure specific
npm run test -- cloud-connectors.test.ts -t "Azure"

# Hybrid routing
npm run test -- cloud-connectors.test.ts -t "Hybrid"
```

Test file: `tests/integration/cloud-connectors/cloud-connectors.test.ts` (15 tests)
