---
name: testing-skill
description: >
  Guide test creation, framework selection, strategy, and coverage improvement for all project
  types. Triggers: "test", "testing", "write test", "add test", "test coverage", "unit test",
  "integration test", "e2e test", "test strategy", "test planning", "test pyramid", "risk-based
  testing", "what to test", "coverage target".
metadata:
  source: GV-native
  consolidated: test-strategy-skill + testing-strategy-skill
---

# Testing Skill

## When to Use

- Writing new tests (unit, integration, e2e)
- Setting up test infrastructure or strategy
- Improving test coverage
- Choosing testing frameworks
- Deciding what, when, and how to test
- Debugging failing tests

## Hard Rules

- MUST follow test pyramid: 70% unit, 20% integration, 10% E2E
- MUST test business logic, API handlers, critical paths, and edge cases
- MUST NOT test framework internals, trivial getters, configuration, or third-party code
- MUST use Arrange-Act-Assert pattern
- MUST keep tests independent (no order dependency)
- MUST NOT commit flaky tests — auto-quarantine on detection

## Core Principles

1. **Test behavior, not implementation**
2. **Arrange-Act-Assert (AAA)** — clear test structure
3. **One assertion per test** — when practical
4. **Meaningful names** — describe expected behavior
5. **Fast feedback** — unit tests <100ms
6. **Independence** — no order dependency

## The Modern Test Pyramid

```
      E2E (5%)
    Integration (15%)
  Component/Contract (30%)
      Unit Tests (50%)
```

| Layer       | Scope                 | Speed | Who Owns    |
| ----------- | --------------------- | ----- | ----------- |
| Unit        | Single function/class | ms    | Developers  |
| Component   | UI component/module   | ms-s  | Developers  |
| Contract    | API boundaries        | s     | Dev + QA    |
| Integration | Service interactions  | s-min | QA          |
| E2E         | Full user flows       | min   | QA + DevOps |

## Decision Gates

| Gate         | Condition                                    | Action                     |
| ------------ | -------------------------------------------- | -------------------------- |
| What to test | Business logic, API handlers, critical paths | Always test                |
| What to test | UI components, error paths                   | Consider testing           |
| What to test | Framework code, config, third-party          | Never test                 |
| Coverage     | <60% stmts / <50% branches / <70% funcs      | Block or improve before PR |
| Coverage     | <80% stmts / <70% branches / <90% funcs      | Recommended improvement    |

## Execution Steps

1. Identify scope: business logic, API handlers, critical paths, edge cases
2. Write tests using Arrange-Act-Assert for each scope item
3. Apply test pyramid ratios (70% unit, 20% integration, 10% E2E)
4. Run coverage check against minimum thresholds
5. Verify no anti-patterns (testing internals, brittle selectors, order dependencies)

## Risk-Based Testing

1. **Identify risks** for each feature (data loss, security, UX, performance)
2. **Score** likelihood × impact
3. **Allocate test effort** proportionally to risk score
4. **Reassess** after each release

## Coverage Goals

| Type                | Target |
| ------------------- | ------ |
| Line coverage       | >80%   |
| Branch coverage     | >75%   |
| Mutation score      | >60%   |
| Critical path E2E   | 100%   |
| API endpoint tested | >90%   |

## Framework Selection

| Type        | Stack              | Recommended           |
| ----------- | ------------------ | --------------------- |
| Unit        | Node.js/TypeScript | Vitest, Jest          |
| Unit        | Go                 | testing package       |
| Unit        | Python             | pytest                |
| Integration | Node.js            | Supertest, MSW        |
| E2E         | React/Vue          | Playwright, Cypress   |
| API         | Any                | REST Client, Postman  |
| Component   | React              | React Testing Library |
| Component   | Vue                | Vue Test Utils        |

## Test File Naming

```
src/
  components/Button/
    Button.tsx
    Button.test.tsx       Unit
    Button.e2e.spec.ts    E2E
  services/
    api.ts
    api.test.ts           Integration
    api.mock.ts           Mock
  __tests__/
    setup.ts              Setup
```

## Test Structure (AAA Pattern)

```typescript
describe('User', () => {
  describe('age', () => {
    it('should update age when birthday is called', () => {
      const user = createUser({ name: 'John', age: 30 });
      user.birthday();
      expect(user.age).toBe(31);
    });
  });
});
```

## Mocking Best Practices

- Mock external dependencies, not internal modules
- Use dependency injection over monkey-patching
- Reset mocks between tests to avoid leaky state

## CI Integration

- Unit/component tests on every PR (fail under 5 min)
- Integration suite on every merge to main
- E2E nightly or on demand
- Flaky test detection → auto-quarantine → alert

> **Referencia detallada**: [references/detail.md](references/detail.md)

```

```
