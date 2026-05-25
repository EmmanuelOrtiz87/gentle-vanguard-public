# Skill Size Optimization Guide

## Overview

This project contains **135 skills**. Of these, **86 exceed** the recommended size limits (1000
tokens / 150 lines). However, **most of these are legitimately large** and exempt from size
restrictions.

### Optimization Status (2026-05-22)

| Phase       | Status      | Details                                        |
| ----------- | ----------- | ---------------------------------------------- |
| **Phase 1** | ✅ Complete | Created `references/` structure in 53 skills   |
| **Phase 2** | ✅ Complete | Added reference links to 10 SKILL.md files     |
| **Phase 3** | 📋 Future   | Extract large sections to reduce SKILL.md size |

**Current State:**

- **73 skills** now have `references/` directory (54% of total)
- **19 skills** were already optimized
- **53 skills** optimized in Phase 1
- **10 skills** have code examples extracted
- **27 skills** are exempt (frameworks/orchestrators)

## Legitimately Large Skills

The following skill categories are expected to exceed standard limits:

### 1. Framework Skills (Expected: 1000-5000+ tokens)

- `flutter-skill` - Complete Flutter framework documentation
- `android-kotlin-skill` - Android development with Kotlin
- `android-jetpack-compose-skill` - Jetpack Compose UI framework
- `android-architecture-skill` - MVVM, Clean Architecture patterns
- `react-19-skill` - React 19 with new features
- `react-native-skill` - Cross-platform mobile development
- `nextjs-15-skill` - Next.js 15 framework
- `angular-spa-skill` - Angular single-page applications
- `django-drf-skill` - Django REST Framework
- `ios-swiftui-patterns-skill` - iOS SwiftUI patterns
- `typescript-skill` - TypeScript comprehensive guide
- `tailwind-4-skill` - Tailwind CSS v4
- `zustand-5-skill` - State management
- `zod-4-skill` - Schema validation
- `ai-sdk-5-skill` - AI SDK integration
- `playwright-skill` - E2E testing framework
- `pytest-skill` - Python testing
- `go-testing` - Go testing patterns
- `golang-api-skill` - Go API development
- `mcp-skill` - Model Context Protocol
- `firecrawl-web-skill` - Web scraping

### 2. Orchestrator Skills (Expected: 2000-7000+ tokens)

- `fireworks-tech-graph` - Technical diagram generation (7143 tokens)
- `project-orchestrator-skill` - Master orchestrator
- `backup-orchestrator` - Backup management
- `cross-workspace-sync` - Workspace synchronization
- `monitoring-aggregator` - Metrics aggregation
- `gitflow-orchestrator-skill` - Git workflow management
- `adaptive-mode-orchestrator` - Adaptive mode management
- `parallel-execution-limits` - Execution management
- `auto-delegation-router` - Task routing
- `judgment-day` - Dual review system

### 3. Domain Expert Skills (Expected: 1000-3000 tokens)

- `ui-mobile-skill` - Mobile UI patterns
- `content-output-skill` - Content generation
- `chained-pr` - PR chaining workflow
- `issue-creation` - GitHub issue management
- `skill-registry` - Skill management
- `design-md` - Design system documentation
- `project-scaffolding-skill` - Project templates
- `security-expert-skill` - Security patterns
- `sdd-lifecycle` - SDD workflow
- `docker-devops-skill` - Docker/DevOps
- `seo-audit-skill` - SEO analysis
- `marketing-growth-hacker` - Growth strategies
- `brand-guide-skill` - Brand guidelines
- `hr-talent-acquisition` - Hiring processes
- `legal-compliance-officer` - Compliance
- `finance-financial-analyst` - Financial analysis
- `data-scientist` - Data science
- `data-analyst` - Data analysis
- `product-manager` - Product management
- `project-manager` - Project management
- `premortem-skill` - Risk analysis
- `security-pentester` - Security testing
- `operations-manager` - Operations

## Optimization Strategy

### For New Skills

1. **Use `references/` directory** for large content:

   ```
   skills/my-skill/
   ├── SKILL.md (core instructions only, <150 lines)
   ├── references/
   │   ├── code-examples.md
   │   ├── patterns.md
   │   └── advanced-topics.md
   ```

2. **Keep SKILL.md focused**:
   - Frontmatter with name/description
   - Activation contract
   - Hard rules (concise)
   - Decision gates table
   - Execution steps
   - Links to references/

3. **Move to references/**:
   - Code examples (>50 lines)
   - Detailed patterns
   - Configuration templates
   - Troubleshooting guides
   - API documentation

### For Existing Large Skills

Skills can be optimized incrementally:

1. **Identify splittable content**:
   - Code blocks >30 lines
   - Multiple examples
   - Detailed explanations
   - Configuration tables

2. **Create references/ structure**:

   ```powershell
   # Example for flutter-skill
   references/
   ├── widget-catalog.md
   ├── state-management.md
   ├── testing-patterns.md
   └── deployment-guide.md
   ```

3. **Update SKILL.md**:
   - Replace large sections with links
   - Keep only essential instructions
   - Add "See references/X.md for details"

## Size Check Script

Run the size checker:

```powershell
pwsh -NoProfile -File scripts/utilities/check-skill-sizes.ps1
```

Expected output:

- **86 skills exceed limits** (this is OK)
- Most are framework/orchestrator skills
- Only optimize if skill is NOT a framework/orchestrator

## When to Optimize

### Must Optimize

- Utility skills >150 lines
- Simple skills with bloat
- Duplicate content across skills

### Can Remain Large

- Framework documentation (Flutter, React, etc.)
- Orchestrator skills
- Complex domain experts
- Skills with `references/` already

## References

- See `skills/project-orchestrator-skill/` for best practices
- See `skills/fireworks-tech-graph/references/` for example structure
- See `skills/code-review-orchestrator-skill/references/` for multi-file organization
