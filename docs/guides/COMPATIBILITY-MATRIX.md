# AI Tools Compatibility Matrix

This document tracks feature parity across all supported AI tools in gentle-vanguard.

## Core Features Matrix

| Feature                        | OpenCode  | Cline     | Cursor    | Windsurf  | Continue.dev | Claude      | Copilot     | Antigravity |
| ------------------------------ | --------- | --------- | --------- | --------- | ------------ | ----------- | ----------- | ----------- |
| **Pre-processing**             | ✅ Native | ✅ Script | ✅ Script | ✅ Script | ✅ Script    | ❌\*        | ❌\*        | ✅ Script   |
| **Trigger detection**          | ✅ Native | ✅ Script | ✅ Script | ✅ Script | ✅ Script    | ⚠️ Embedded | ⚠️ Embedded | ✅ Script   |
| **Skill loading**              | ✅ Native | ✅        | ✅        | ✅        | ✅           | ⚠️ Manual   | ⚠️ Manual   | ✅          |
| **Local-first policy**         | ✅        | ✅        | ✅        | ✅        | ✅           | ✅          | ✅          | ✅          |
| **Session tracking**           | ✅        | ✅        | ✅        | ✅        | ✅           | ✅          | ❌          | ✅          |
| **Spanish/English**            | ✅        | ✅        | ✅        | ✅        | ✅           | ✅          | ✅          | ✅          |
| **Memory tiering**             | ✅        | ✅        | ⚠️        | ⚠️        | ⚠️           | ❌          | ❌          | ⚠️          |
| **Handoff compression**        | ✅        | ✅        | ❌        | ❌        | ❌           | ❌          | ❌          | ❌          |
| **Pre-compact hook**           | ✅        | ✅        | ❌        | ❌        | ❌           | ❌          | ❌          | ❌          |
| **Context7 MCP**               | ✅        | ✅        | ✅        | ✅        | ✅           | ⚠️          | ⚠️          | ✅          |
| **Delegation to orchestrator** | ✅        | ✅        | ✅        | ✅        | ✅           | ✅          | ✅          | ✅          |
| **System Prompt Optimization** | ✅ Native | ✅ Config | ✅ Config | ✅ Config | ✅ Config    | ✅ Config   | ✅ Config   | ✅ Config   |

`*` = Limitation of the tool itself (cannot run external scripts) `⚠️` = Partial support or
workaround available

## Embedded Triggers (for Claude & Copilot)

When using Claude or Copilot, watch for these keywords and manually load the corresponding skill:

| Trigger Keywords                                                                                                                          | Skill to Load                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Angular, Angular component, Angular service, Angular signal, Angular SPA, @defer, standalone component                                    | `angular-spa-skill`           |
| React, React 19, useActionState, useFormStatus, React Compiler                                                                            | `react-19-skill`              |
| Next.js, Next.js 15, App Router, Server Component, Server Action, next.config                                                             | `nextjs-15-skill`             |
| Go API, Go backend, REST endpoint Go, Go JSON, Go SPA, Go HTTP handler                                                                    | `golang-api-skill`            |
| TypeScript, interface, type, generic, utility types, typescript strict                                                                    | `typescript-skill`            |
| Zod, schema validation, input validation, type safety                                                                                     | `zod-4-skill`                 |
| Zustand, state management, store, useStore, persistence                                                                                   | `zustand-5-skill`             |
| Tailwind, Tailwind CSS, cn(), className, tailwind-4                                                                                       | `tailwind-4-skill`            |
| AI SDK, AI SDK 5, streamText, generateText, AI provider                                                                                   | `ai-sdk-5-skill`              |
| MCP, Model Context Protocol, MCP server, MCP tool, MCP resource                                                                           | `mcp-skill`                   |
| Docker, container, kubernetes, k8s, deployment, docker-compose, dockerfile, pod, ingress, helm                                            | `docker-devops-skill`         |
| MongoDB, Redis, NoSQL, document database, caching, cache                                                                                  | `database-nosql-skill`        |
| PostgreSQL, MySQL, SQL, database, SQLAlchemy, migration, transaction                                                                      | `database-relational-skill`   |
| Django, Django REST Framework, DRF, ViewSet, Serializer, APIView                                                                          | `django-drf-skill`            |
| security, authentication, authorization, vulnerability, CVE, OWASP, XSS, SQL injection, secrets, encryption                               | `security-skill`              |
| test, write test, test coverage, unit test, integration test, e2e test, testing framework, test setup                                     | `testing-skill`               |
| test strategy, test pyramid, what to test, coverage target, unit test, integration test                                                   | `testing-skill`               |
| iniciar sesión, session, start session                                                                                                    | `session-lifecycle`           |
| audit gentle-vanguard, validate docs, sweep project, check links, find duplicates, fix references, homologate, validation sweep, gv audit | `gentle-vanguard-audit-skill` |
| new project, assess project, setup project, migrate, refactor decisión, organize docs                                                     | `project-orchestrator-skill`  |
| create project, new project, bootstrap, scaffold, template, workspace setup, initialize project, gv CLI                                   | `project-scaffolding`         |
| sdd init, iniciar sdd, openspec init                                                                                                      | `sdd-init`                    |

## Orchestrator Delegation

When a trigger is detected but cannot be auto-loaded (Claude/Copilot):

```
IF trigger detected BUT skill cannot auto-load:
  1. Respond: "Trigger detected for [skill-name]. This feature requires @orchestrator for full functionality."
  2. Suggest: "Use OpenCode or another supported tool for full feature parity."
  3. Delegate complex tasks: "Delegating to @orchestrator for execution."
```

## Native Policy: All New Features

**MANDATORY**: Every new feature, optimization, or adjustment must be implemented for ALL supported
tools:

1. OpenCode (opencode.json)
2. Cline (.clinerules + config/cline-\*.json)
3. Cursor (.cursorrules)
4. Windsurf (.windsurf/config.json)
5. Continue.dev (.continue/config.json)
6. Claude (CLAUDE.md)
7. Copilot (.github/copilot-instructions.md)
8. Antigravity (ANTIGRAVITY.md)

**Implementation Checklist for New Features:**

- [ ] OpenCode: Update `opencode.json`
- [ ] Cline: Update `.clinerules` and `config/cline-*.json`
- [ ] Cursor: Update `.cursorrules`
- [ ] Windsurf: Update `.windsurf/config.json`
- [ ] Continue.dev: Update `.continue/config.json`
- [ ] Claude: Update `CLAUDE.md` (embedded triggers)
- [ ] Copilot: Update `.github/copilot-instructions.md` (embedded triggers)
- [ ] Antigravity: Update `ANTIGRAVITY.md`
- [ ] Orchestrator: Update `config/orchestrator.json`
- [ ] Update `docs/guides/COMPATIBILITY-MATRIX.md`

**Code Quality Standards:**

- [ ] `.markdownlint.json` — Markdown formatting enforced via pre-commit hook
- [ ] `.prettierrc` — Consistent code formatting (JSON, YAML, Markdown)
- [ ] `.editorconfig` — Universal editor settings (UTF-8, LF, trailing newline)
- [ ] `CODE_OF_CONDUCT.md` — Community standards
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist
- [ ] `.github/labeler.yml` — Auto-label PRs by path
- [ ] Tests organized: `tests/unit/`, `tests/integration/`, `tests/security/`, `tests/performance/`
- [ ] `scripts/run-tests-simple.ps1` — Runs all test categories

<!-- REF-OBSOLETA: scripts/run-tests-simple.ps1 no tiene equivalente TS (migración PS1→TS) -->

- [ ] `pre-push` hook runs test suite + audit check

## Incompatible Features

Features that CANNOT be implemented in certain tools due to architectural limitations:

| Feature                         | Incompatible With                               | Reason                                                        | Workaround                                      |
| ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Pre-processing script execution | Claude, Copilot                                 | Tools don't support external script execution before response | Use embedded triggers + orchestrator delegation |
| Auto skill loading via script   | Claude, Copilot                                 | Same as above                                                 | Manual skill loading or @orchestrator           |
| Memory tiering (4 levels)       | Claude, Copilot, Cursor, Windsurf (partial)     | No config file support                                        | Use orchestrator for complex memory operations  |
| Handoff compression             | Claude, Copilot, Cursor, Windsurf, Continue.dev | Tool-specific feature                                         | Use orchestrator                                |
| Pre-compact hook                | Claude, Copilot, Cursor, Windsurf, Continue.dev | Tool-specific feature                                         | Use orchestrator                                |

**Documentation Requirement**: Incompatible features must be documented in:

1. `docs/guides/COMPATIBILITY-MATRIX.md` (this file)
2. The tool's config file with a `note` field
3. Developer communication when relevant

## versión Tracking

- **Last Updated**: 2026-05-08
- **Matrix versión**: 1.1.0
- **Tools Supported**: 8
- **Features Tracked**: 12 core features
