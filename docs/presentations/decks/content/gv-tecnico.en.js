/**
 * Set 3 - Technical onboarding (EN).
 *
 * Audience: technical profiles joining the stack or operating on it. Goal: that a
 * person can install it, start a session, understand the repository map, write
 * code with the project flow and find what they need without depending on
 * someone else.
 *
 * Editorial rule: commands, paths and counts are the real ones from the repository.
 */

export default {
  id: 'gv-tecnico-en',
  title: 'GentleVanguard - Technical onboarding for the stack',
  subject: 'Technical onboarding for GentleVanguard',
  footer: 'GentleVanguard - Stack v4.3.0',
  theme: 'hybrid',
  hero: 'technical',
  slides: [
    {
      layout: 'cover',
      eyebrow: 'Technical onboarding',
      title: 'How work happens\ninside the stack',
      titleSize: 32,
      titleH: 1.3,
      subtitle:
        'Repository map, anatomy of a session, agents, skills, commands, operational database and the rules that hold the rest together.',
      meta: ['Stack v4.3.0', 'Node 24', 'pnpm 11'],
      version: 'Onboarding guide - November 2026',
    },

    {
      layout: 'agenda',
      eyebrow: 'Route',
      title: 'What you will walk through',
      lead: 'The recommended order for a first week.',
      items: [
        { heading: 'Repository map', body: 'What lives in each folder and why it is separated.' },
        { heading: 'Anatomy of a session', body: 'What happens between your prompt and the agent reply.' },
        { heading: 'Agents and skills', body: 'The 20 agents in the roster and how capabilities get invoked.' },
        { heading: 'Commands', body: 'The commands used daily and what each one verifies.' },
        { heading: 'Nexus', body: 'The operational database: 45 tables, migrations and backup.' },
        { heading: 'Development flow', body: 'From request to commit: ODD, slices, gates and the reviewed boundary.' },
        { heading: 'Repo rules', body: 'What is not negotiable and why it exists.' },
        { heading: 'Where to look', body: 'The shortest path to each kind of answer.' },
      ],
    },

    {
      layout: 'layers',
      eyebrow: 'Map',
      title: 'Eight folders, one responsibility each',
      lead: 'The separation is not cosmetic: it is what makes the validations automatic.',
      labelW: 1.55,
      items: [
        { label: 'src/', body: 'more than 800 TypeScript files. Stack code by area: orchestration, security, retrieval, data, tools, quality and ops.', accent: '06b6d4' },
        { label: 'apps/', body: '29 of our own applications running on the stack, validating the architecture in production.', accent: '8b5cf6' },
        { label: 'skills/', body: '253 capabilities with contract and frontmatter. Invoked by task description.', accent: 'fbbf24' },
        { label: 'docs/', body: 'Stack manual by module, full manual, 38 ADRs and the design decision log.', accent: '22d3ee' },
        { label: 'config/', body: 'Single source of configuration: model router, role mapping, quality gates, budgets and MCP registry.', accent: '4ade80' },
        { label: 'packages/', body: 'Workspace holding the official design system and the shared packages the code imports.', accent: 'c4b5fd' },
        { label: 'tests/', body: 'more than 550 test files: unit, e2e, integration, security, skills, workflows, eval and performance.', accent: 'f4bb4f' },
        { label: 'assets/', body: 'Official brand, self-hosted fonts and the canonical shell diagram.', accent: '22d3ee' },
      ],
    },

    {
      layout: 'flow',
      eyebrow: 'Session',
      title: 'What happens when you write a request',
      lead: 'Six stages, all instrumented. None of them is magic: each one leaves a record.',
      items: [
        { icon: 'rocket', heading: 'Autostart', body: 'Prepares session, engram, security orchestrator, codegraph, budgets, watchtower and Nexus.' },
        { icon: 'compass', heading: 'Pre-processing', body: 'Injects skills, context and rules before the model sees the message.' },
        { icon: 'route', heading: 'Router', body: 'Picks the model by cost, latency, domain and task criticality.' },
        { icon: 'agent', heading: 'Agent', body: 'Executes with real tools. Every step lands in the trace.' },
        { icon: 'gears', heading: 'Skills', body: 'Invoked by context. Each skill declares its contract and its outcome.' },
        { icon: 'database', heading: 'Nexus', body: 'Sessions, traces, tokens, events and skill outcomes are persisted.' },
      ],
    },

    {
      layout: 'cards',
      eyebrow: 'Roster',
      title: '20 agents, each with its own perimeter',
      lead: 'An agent has a model, permissions, a step limit, a budget and a declared fallback.',
      cols: 4,
      items: [
        {
          icon: 'compass',
          heading: 'Orchestration',
          body: 'orchestrator, session-agent, knowledge-agent and self-diag-agent: the loop and its own diagnostics.',
          accent: '06b6d4',
        },
        {
          icon: 'branch',
          heading: 'SDD cycle',
          body: 'sdd-explore, sdd-design, sdd-apply and sdd-verify: the opt-in path for multi-session specs.',
          accent: '8b5cf6',
        },
        {
          icon: 'tools',
          heading: 'Operations',
          body: 'ops-agent, maintenance-agent, gitflow-agent, premortem-agent and doc-agent: daily operation.',
          accent: 'fbbf24',
        },
        {
          icon: 'users',
          heading: 'Business areas',
          body: 'mkt, sales, finance, hr, legal, bus-tele and sia: business roles with their own permissions.',
          accent: '22d3ee',
        },
      ],
    },

    {
      layout: 'bullets',
      eyebrow: 'Capabilities',
      title: 'Skills: the library that stops us rewriting things',
      cols: 2,
      items: [
        { icon: 'book', heading: 'What they are', body: 'A SKILL.md with frontmatter, description and contract. They are indexed and routed by task similarity, not by remembering the name.' },
        { icon: 'search', heading: 'How they are invoked', body: 'The skill router scores the task against every capability description and proposes the closest one.' },
        { icon: 'flask', heading: 'How they are validated', body: '24 critical contracts are exercised in real execution. Nexus separates production, evaluation and maintenance outcomes.' },
        { icon: 'lock', heading: 'What is not copied', body: 'Only 28 critical skills propagate to the five external surfaces. The rest are not copied so host metadata does not degrade.' },
        { icon: 'boxes', heading: 'What was adopted', body: 'Including frontend-design, canvas-design, doc-coauthoring, theme-factory and the marketing family, with attribution in the frontmatter.' },
        { icon: 'shield', heading: 'Hygiene', body: 'Every skill passes structure and accent lint plus the secret scanner before it enters the index.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Commands',
      title: 'The ones used every day',
      lead: 'Every stack operation is an auditable command. There are no hidden actions.',
      headers: ['Command', 'What it does'],
      colW: [3.6, 5.2],
      rows: [
        ['npm run session:autostart:detached', 'Session startup in the background. Idempotent. About 1.3 seconds.'],
        ['npm run watchtower:health', '35 components watched; the report lists the detail of every check. PASS expected.'],
        ['npm run db:health', 'Nexus verification: integrity, WAL, tables and rows.'],
        ['npm run token:status', 'Real budget: used, ceiling and percentage.'],
        ['npm run stack:facts', 'Regenerates the stack fact inventory and its documentation.'],
        ['npm run stack:facts:check', 'Fails if there is structural drift against the inventory.'],
        ['npm run quality:universal', 'Universal quality gate: intake, plan, build, verify, release, operate, learn.'],
        ['npm run guard:snapshot', 'Backs up untracked files and uncommitted patches before a risky operation.'],
        ['npm run scan:secrets -- --scan', '80 detection patterns, with optional entropy and redaction.'],
        ['npm run graphify -- query "..."', 'Query the deterministic AST graph of the repository.'],
        ['npx tsx src/orchestration/recommend-agent.ts --task "..." --topn 3', 'Agent recommendation for a task.'],
        ['npm run upgrade', 'Syncs the workspace with what is published on origin, with a prior snapshot.'],
      ],
    },

    {
      layout: 'figureLayers',
      eyebrow: 'Data',
      title: 'Nexus: the operational memory of the stack',
      lead: '45 tables and 24 migrations in SQLite with WAL. Everything the stack learns ends up here.',
      textW: 3.4,
      items: [
        { icon: 'database', heading: 'What it holds', body: 'Metrics, sessions, traces, events, alerts, feedback, cache, skill usage, tokens and routing.' },
        { icon: 'clock', heading: 'Retention', body: 'Events at 30 days, cache at 7 and token usage at 90. Daily backups keeping 14 copies.' },
        { icon: 'eye', heading: 'Queries', body: 'Direct SQL over the database, with no reporting layer that could drift from the truth.' },
        { icon: 'shield', heading: 'Integrity', body: 'The watchtower checks file size, WAL, integrity and row counts on every health cycle.' },
      ],
      layers: [
        { label: 'Engram', body: 'Persistent memory across sessions', accent: '8b5cf6' },
        { label: 'CodeGraph', body: 'Symbols and relations in the repository', accent: '22d3ee' },
        { label: 'Nexus', body: 'Metrics, events and traces (SQLite)', accent: '06b6d4' },
      ],
    },

    {
      layout: 'metrics',
      eyebrow: 'Quality',
      title: 'Quality is not requested: it is executed',
      lead: 'The stack runs its own controls on every commit, every push and every health cycle.',
      cols: 4,
      items: [
        { value: '53', label: 'Quality gates', sub: '49 of 53 enforced strictly', accent: '06b6d4' },
        { value: '552+', label: 'Test files', sub: 'Unit, e2e, integration, security and skills', accent: '8b5cf6' },
        { value: '21', label: 'CI workflows', sub: 'CI, security, release, public sync and automated labelling', accent: 'fbbf24' },
        { value: '80', label: 'Secret patterns', sub: 'With optional entropy and redaction by default', accent: '22d3ee' },
      ],
    },

    {
      layout: 'timeline',
      eyebrow: 'Install',
      title: 'From clone to first session',
      lead: 'Idempotent steps: if it breaks, you re-run it and nothing duplicates.',
      items: [
        { step: '01', heading: 'Prerequisites', body: 'Node 22.18 or later, pnpm 11 and Git. Strict verification with install:doctor.' },
        { step: '02', heading: 'Dependencies', body: 'pnpm install with a frozen lockfile. The workspace tree resolves once.' },
        { step: '03', heading: 'Nexus', body: 'The SQLite database is created under .runtime and pending migrations are applied.' },
        { step: '04', heading: 'Hooks', body: 'lefthook is installed with the commit and push hooks.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Router',
      title: 'The router decides, and the code decides it',
      lead: 'Temperature and the default model are locked by policy: they do not change on the fly.',
      headers: ['Criterion', 'Current rule'],
      colW: [3.0, 5.8],
      rows: [
        ['Profiles', 'cheap, balanced and premium. The active one is balanced.'],
        ['By domain', 'premium for finance, legal and governance; balanced for marketing, sales, HR and telecoms; fastCheap for gitflow, ops and session.'],
        ['Escalation', 'Steps up by input length, item count, or architectural design and security review questions.'],
        ['Failover', 'opencode, then ollama, then lm-studio2, with a 5 minute cache and a fallback model.'],
        ['Circuit', 'Five failures open the circuit, two successes move it to half-open.'],
        ['Temperature', 'Locked by default. Command override is not permitted.'],
        ['Audit', 'Every routing decision is written to a log with 90 days of retention.'],
      ],
    },

    {
      layout: 'bullets',
      eyebrow: 'Rules',
      title: 'What is not negotiable in this repository',
      cols: 2,
      items: [
        { icon: 'eye', heading: 'Invisible processes', body: 'Every spawn goes through runNpxTsx with windowsHide. Zero console windows. A regression test verifies it.' },
        { icon: 'shield', heading: 'Destruction guardrail', body: 'No bulk deletion or overwrite without explicit confirmation. The untracked snapshot runs before any risky operation.' },
        { icon: 'tools', heading: 'TypeScript and bash only', body: 'Stack logic goes in TS. PS1 and CMD only in sanctioned exceptions. No new PowerShell scripts.' },
        { icon: 'file', heading: 'Documentation with order', body: 'Summary, context, scope, out of scope, assumptions, solution, operation, data, security, plan and annexes. Never "TBD".' },
        { icon: 'branch', heading: 'Commits per slice', body: 'Large work: feature doc before the first write, slices of roughly 400 lines and one conventional commit per slice.' },
        { icon: 'link', heading: 'Reviewed boundary', body: 'After an accepted review, the next one starts from the delta rather than the full range.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Reference',
      title: 'Where to find each kind of answer',
      lead: 'The knowledge is versioned. You do not need to ask.',
      headers: ['I need', 'Go to'],
      colW: [3.6, 5.2],
      rows: [
        ['The rule currently in force', 'AGENTS.md at the repository root'],
        ['The detail of one module', 'docs/stack-manual-modules.md'],
        ['The complete architecture', 'docs/stack-manual-full.md'],
        ['Generated stack figures', 'docs/generated/STACK-FACTS.md'],
        ['Task examples with agents and skills', 'docs/use-cases/EXAMPLES.md'],
        ['Project, proposal and contract templates', 'docs/templates/gv/'],
        ['How the design system stands', 'packages/gv-design-system and docs/brand/'],
        ['The interactive presentation book', 'docs/presentations/'],
      ],
    },

    {
      layout: 'closing',
      title: 'Your first day',
      body:
        'Install, start a session and ask for the stack health status. Then pick a small issue and let the inline flow do the rest: explore, implement and verify in proportion to the risk.',
      ctas: [{ label: 'Start with setup' }, { label: 'See the command map' }],
      contacts: [
        'Documentation: AGENTS.md and docs/stack-manual-modules.md',
        'Setup command: npm run setup',
        'Health status: npm run watchtower:health',
      ],
      note: 'If you have any doubt about a repository rule, the answer is in AGENTS.md or in the stack manual.',
    },
  ],
};
