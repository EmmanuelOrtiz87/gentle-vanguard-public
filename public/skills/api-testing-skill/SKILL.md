---
name: api-testing-skill
description: >
  Imported from mercury-agent-skills. Use when working with "API test", "REST testing", "GraphQL
  testing", "contract testing". Triggers: "API test", "REST testing", "GraphQL testing", "contract
  testing".
metadata:
  source: mercury-agent-skills
  original-name: api-testing
---

# API Testing

Test REST and GraphQL APIs systematically.

## Test Categories

| Category    | What                | Example                       |
| ----------- | ------------------- | ----------------------------- |
| Functional  | Does it work?       | POST /users returns 201       |
| Validation  | Input handling      | Missing required field → 400  |
| Auth        | Access control      | No token → 401                |
| Edge Cases  | Boundary conditions | Max page size, empty results  |
| Contract    | Schema conformance  | Response matches OpenAPI spec |
| Performance | Within SLO          | p95 < 500ms                   |

## REST API Testing

### Structure

```typescript
describe('POST /users', () => {
  it('creates a user with valid data', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@test.com' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'existing@test.com' });
    expect(res.status).toBe(409);
  });
});
```

## Contract Testing (Pact)

- Provider publishes OpenAPI spec
- Consumer tests verify against published spec
- CI rejects PR if contract breaks
- Prevents API drift between services

## GraphQL Testing

- Test queries and mutations independently
- Validate against schema
- Test error paths (partial failures, null propagation)

## API Monitoring

- Synthetic checks every 5 minutes
- Assert status, response time, required fields
- Alert on SLA breaches
- Monitor from multiple regions
