---
name: observability-skill
description: >
  Observability patterns for logs, metrics, tracing, dashboards, and alerting. Trigger:
  "observability", "monitoring", "tracing", "metrics", "logs", "alert", "OpenTelemetry", "SLO",
  "incident triage", "Grafana", "Prometheus".
license: Apache-2.0
metadata:
  author: gentle-vanguard
  versión: '1.0'
metadata:
  source: GV-native
---

## When to Use

- Adding telemetry to services or APIs
- Investigating production issues or performance regressions
- Designing dashboards or alerts
- Defining SLOs/SLIs for critical flows
- Reviewing whether a system is observable enough for production

## Core Model

Observability has 3 pillars:

- **Logs**: discrete events with structured context
- **Metrics**: aggregated numeric signals over time
- **Traces**: request and dependency flow across boundaries

Use all 3. Logs alone are not observability.

## Minimum Production Standard

Every production service should have:

1. Structured logs with correlation/request IDs
2. Basic RED metrics: Rate, Errors, Duration
3. Distributed tracing for external calls
4. A service dashboard
5. At least one actionable alert

## Logging Rules

- Use structured JSON logs, not freeform strings
- Include: timestamp, level, service, environment, requestId, userId if safe, operation
- Never log secrets, tokens, passwords, or full PII
- Use stable field names across services

Example fields:

```json
{
  "timestamp": "2026-04-13T12:00:00Z",
  "level": "error",
  "service": "billing-api",
  "env": "prod",
  "requestId": "req-123",
  "operation": "create-invoice",
  "durationMs": 481,
  "error": "timeout contacting tax provider"
}
```

## Metrics Rules

Track at minimum:

- Request count
- Error count / error rate
- Latency (p50 / p95 / p99)
- Queue depth / backlog where applicable
- Resource saturation (CPU, memory, DB connections)

## Tracing Rules

- Instrument inbound requests
- Propagate trace context to downstream services
- Wrap external I/O spans: DB, HTTP, queues, cache
- Add domain-relevant span attributes

## SLO Guidance

Define SLOs for user-critical flows:

- Availability: e.g. 99.9% successful responses
- Latency: e.g. p95 under 400ms
- Freshness/throughput for async systems where relevant

## Alerting Rules

Alerts should be:

- Actionable
- Based on symptoms first, causes second
- Routed to owners
- Rate-limited to avoid fatigue

Good examples:

- p95 latency > threshold for 15m
- Error rate > 2% for 10m
- Queue backlog above safe limit

Bad examples:

- CPU > 80% for 1m with no customer impact
- Every individual exception as a page

## Incident Triage Sequence

1. Check symptoms: latency, availability, error rate
2. Identify scope: all users, one endpoint, one region, one dependency
3. Correlate traces to failing components
4. Inspect logs with requestId/traceId
5. Validate mitigation, then root cause

> **See also**: [monitoring-observability-skill](../monitoring-observability-skill/SKILL.md) for
> Prometheus/Grafana/metrics deep-dive, [monitoring-aggregator](../monitoring-aggregator/SKILL.md)
> for metrics aggregation
