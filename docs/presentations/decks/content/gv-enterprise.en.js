/**
 * Set 2 - Enterprise / internal stack adoption (EN).
 *
 * Audience: business and technology leadership at a large company (reference:
 * telecom) that wants to bring AI to its teams in a governed way. Goal:
 * explain what the stack is, what it controls, how adoption works from the
 * inside, and why it is worth adopting as a platform rather than a single tool.
 *
 * Editorial rule: no invented clients, certifications, external audits or SLA
 * figures. Every claim is verifiable in the repository.
 */

export default {
  id: 'gv-enterprise-en',
  title: 'GentleVanguard - An orchestration layer for your company AI',
  subject: 'Enterprise presentation of the GentleVanguard stack',
  footer: 'GentleVanguard - Stack v4.3.0',
  theme: 'hybrid',
  hero: 'enterprise',
  slides: [
    {
      layout: 'cover',
      eyebrow: 'Internal AI adoption - A governed stack',
      title: 'An orchestration layer\nfor your company AI',
      titleSize: 30,
      titleH: 1.3,
      subtitle:
        'A local-first stack that turns AI assistants into governed capability: defined roles, token budgets, traceability and audit.',
      meta: ['Local first', 'Traceable', 'Portable'],
      version: 'Stack v4.3.0 - November 2026',
    },

    {
      layout: 'statement',
      eyebrow: 'Who builds it',
      title: 'The person who knows applied AI in large companies has done it before',
      body: 'Emmanuel Ortiz Gutierrez: software architect, AI integration engineer and founder of GentleVanguard. More than 15 years building and analysing systems for companies: software architecture and AI integration at DIRECTV Latin America, technical consulting at GlobalLogic and Oracle, plus analysis, QA and development team coordination.',
      bodyW: 8.4,
      bodySize: 12,
      stats: [
        {
          value: 'DIRECTV',
          label: 'Latin America',
          sub: 'Software architecture and AI integration',
        },
        {
          value: 'GlobalLogic',
          label: 'Oracle',
          sub: 'Technical consulting for enterprise clients',
        },
        { value: 'UNSJ', label: 'Information Systems', sub: 'BSc in Information Systems' },
      ],
    },

    {
      layout: 'figureLayers',
      eyebrow: 'What it is',
      title: 'The stack is not a chatbot: it is the layer that governs it',
      lead: 'Each layer solves one class of problems and keeps a record of what it did.',
      textW: 3.3,
      items: [
        {
          icon: 'agent',
          heading: 'A roster of agents',
          body: '20 agents with model, permissions, step limits and budget assigned.',
        },
        {
          icon: 'brain',
          heading: 'Capabilities',
          body: '253 reusable skills invoked by context, not by code.',
        },
        {
          icon: 'eye',
          heading: 'Evidence',
          body: 'Sessions, traces, events and hash-chained audit.',
        },
        {
          icon: 'shield',
          heading: 'Controls',
          body: 'Fail-closed policies, secret scanning and permission traceability.',
        },
      ],
      layers: [
        { label: 'Tools', body: 'CLI, IDEs and product surfaces', accent: '06b6d4' },
        { label: 'Agents', body: 'Specialized profiles per runtime', accent: '22d3ee' },
        { label: 'Orchestration', body: 'Context, routing and steps', accent: '8b5cf6' },
        { label: 'Knowledge', body: 'Engram, CodeGraph and Graphify', accent: 'c4b5fd' },
        { label: 'Operational data', body: 'Nexus / SQLite, kept separate', accent: 'fbbf24' },
        { label: 'Quality & delivery', body: 'Gates, review and evidence', accent: '4ade80' },
      ],
    },

    {
      layout: 'layers',
      eyebrow: 'Anatomy',
      title: 'Nine layers, each with an explicit boundary',
      lead: 'The structure is what makes it possible to audit, replace or extend one piece without breaking the rest.',
      labelW: 1.75,
      items: [
        {
          label: 'Surfaces',
          body: 'Ten audited tool profiles (OpenCode, Codex, ZCode, MiniMax Code, Claude Code, Antigravity, Cursor, Cline, Windsurf and VS Code) over one workspace.',
          accent: '06b6d4',
        },
        {
          label: 'Orchestration',
          body: 'Model and agent routing, step escalation by complexity, and a learnable routing table with 17 domains and overrides.',
          accent: '22d3ee',
        },
        {
          label: 'Agents',
          body: '20 definitions with permissions and step limits; 29 mapped roles and 30 model bindings by domain and criticality.',
          accent: '8b5cf6',
        },
        {
          label: 'Capabilities',
          body: '253 indexed skills, with 28 critical ones under a contract verified in real execution.',
          accent: 'c4b5fd',
        },
        {
          label: 'Knowledge',
          body: 'Engram (memory), CodeGraph (incremental index), graphify (deterministic AST graph) and Nexus (45 tables, 24 migrations, WAL).',
          accent: 'fbbf24',
        },
        {
          label: 'Tools',
          body: 'Ten MCP servers with uniform access, including two external ones behind a circuit breaker.',
          accent: 'f4bb4f',
        },
        {
          label: 'Infrastructure',
          body: 'Watchtower watching 35 components, six operating modes and auto-heal.',
          accent: '4ade80',
        },
        {
          label: 'Observability',
          body: 'Dashboard with real traces, a 7-component health API, OTLP export and configurable alerts.',
          accent: '22d3ee',
        },
        {
          label: 'Applications',
          body: '28 of our own apps running on the stack, validating the architecture in production.',
          accent: '06b6d4',
        },
      ],
    },

    {
      layout: 'metrics',
      eyebrow: 'Scale',
      title: 'Not a prototype: a system under sustained use',
      lead: 'Figures verified against the repository at version 4.3.0.',
      cols: 4,
      items: [
        {
          value: '800+',
          label: 'TypeScript files in src/',
          sub: 'Own stack code, organised by area',
          accent: '06b6d4',
        },
        {
          value: '552+',
          label: 'Test files',
          sub: 'Unit, e2e, integration, security and skills',
          accent: '8b5cf6',
        },
        {
          value: '611+',
          label: 'npm scripts',
          sub: 'Every stack operation is an auditable command',
          accent: 'fbbf24',
        },
        {
          value: '36',
          label: 'Components watched',
          sub: 'Health checks per component, with auto-heal',
          accent: '22d3ee',
        },
      ],
    },

    {
      layout: 'cards',
      eyebrow: 'Capabilities',
      title: 'What the company gets when it installs the stack',
      cols: 3,
      items: [
        {
          icon: 'users',
          heading: 'Roles, not people',
          body: '29 mapped roles with primary and fallback subagents, triggers and skills. AI stops being one person tool and becomes a role with a standard.',
          accent: '06b6d4',
        },
        {
          icon: 'money',
          heading: 'Cost under control',
          body: 'A daily budget of 10 million tokens, 3 million per session and 100 thousand per agent, with routing by cost, latency and load.',
          accent: '8b5cf6',
        },
        {
          icon: 'lock',
          heading: 'Explicit permissions',
          body: 'Per-agent permissions, fail-closed policies, an MCP security gateway, secret scanning and a separation between reconstructable and non-reconstructable data.',
          accent: 'fbbf24',
        },
      ],
    },

    {
      layout: 'flow',
      eyebrow: 'Operation',
      title: 'How a task actually runs, end to end',
      lead: 'The loop does not change between a one-week project and a six-month one.',
      items: [
        {
          icon: 'compass',
          heading: 'Pre-process',
          body: 'Every turn injects context, skills and rules before the model sees the message.',
        },
        {
          icon: 'route',
          heading: 'Routing',
          body: 'The router picks model and agent by domain, complexity and cost.',
        },
        {
          icon: 'tools',
          heading: 'Execution',
          body: 'The agent works with real tools and leaves a trace of every step.',
        },
        {
          icon: 'check',
          heading: 'Verification',
          body: 'Gates and the reviewer close the loop before work is declared done.',
        },
      ],
    },

    {
      layout: 'bullets',
      eyebrow: 'Governance',
      title: 'What keeps this from being an uncontrolled experiment',
      cols: 2,
      items: [
        {
          icon: 'shield',
          heading: '55 quality gates',
          body: '19 on pre-commit, 2 on commit-msg, 2 on post-commit, 19 registered on pre-push, 8 in CI, 1 governance, 1 deploy and 1 runtime. 50 of 55 enforced strictly; the Dependabot alerts gate runs on every push.',
        },
        {
          icon: 'search',
          heading: 'Secret scanning',
          body: '80 patterns with optional entropy filtering and redaction by default, wired into the hook and the watchtower. Three independent scanners coexist.',
        },
        {
          icon: 'link',
          heading: 'Chained audit',
          body: 'Event sourcing with prevHash and a SHA-256 hash per event. It detects accidental mutation or inconsistent log editing.',
        },
        {
          icon: 'file',
          heading: 'Supply traceability',
          body: 'Generated and validated SBOM, artifact provenance and a documented mapping against the OWASP Top 10 for agents.',
        },
        {
          icon: 'eye',
          heading: 'Real observability',
          body: 'A dashboard with no mock data: metrics, traces, alerts and feedback come from the operation, not from a mockup.',
        },
        {
          icon: 'database',
          heading: 'Backup and recovery',
          body: 'Scheduled daily database backup keeping 14 copies, plus recovery drills with measured RTO and RPO.',
        },
      ],
    },

    {
      layout: 'compare',
      eyebrow: 'The decision',
      title: 'Adopting AI tool by tool, or with an orchestration layer',
      lead: 'This is the difference between a software contract and an organisational capability.',
      left: {
        head: 'Governed stack',
        sub: 'The capability stays inside the company',
        icon: 'shield',
        accent: '06b6d4',
        items: [
          { text: 'One standard for every team, defined in the repository.' },
          { text: 'Budget, permissions and limits per role, not per tool vendor.' },
          { text: 'Evidence for every task: traces, events and chained audit.' },
          { text: 'Process knowledge in the company database, not in a chat memory.' },
          { text: 'Continuity: the stack is upgraded and migrated with versioning.' },
          { text: 'Works with whichever model provider the company picks, or with local models.' },
        ],
      },
      right: {
        head: 'Tool by tool',
        sub: 'Each team improvises its own path',
        icon: 'cross',
        accent: '8b95a8',
        items: [
          { text: 'Every tool carries its own rules, with no shared standard.', mark: 'warn' },
          { text: 'Cost stays invisible until the invoice arrives.', mark: 'warn' },
          { text: 'No record of what the model did or which data it used.', mark: 'cross' },
          { text: 'Process knowledge is lost with every conversation.', mark: 'cross' },
          { text: 'Vendor lock-in: changing tools means starting over.', mark: 'cross' },
          { text: 'No upgrade path: every new version becomes a project.', mark: 'cross' },
        ],
      },
    },

    {
      layout: 'table',
      eyebrow: 'Topology',
      title: 'Where each part lives, and why it matters',
      lead: 'Operation is local; exposure is optional and reversible.',
      headers: ['Layer', 'Residence', 'Design reason'],
      colW: [2.6, 2.5, 3.7],
      rows: [
        [
          'Orchestration and agents',
          'Local, on the team machine',
          'Process control does not depend on an external service',
        ],
        [
          'Operational database (Nexus)',
          'Local SQLite in WAL',
          'Queries without network latency, with programmable backup',
        ],
        [
          'Memory and knowledge',
          'Local, with optional sync',
          'Organisational context does not leave the machine by default',
        ],
        ['Models', 'Provider or local', 'Failover chain: provider, then Ollama, then LM Studio'],
        [
          'Applications',
          'Local or cloud depending on the case',
          'Exposed by URL when needed, without changing the logic',
        ],
        [
          'Audit and traces',
          'Versioned local files',
          'Can be archived, shipped to a SIEM or retained by policy',
        ],
      ],
    },

    {
      layout: 'metrics',
      eyebrow: 'Economics',
      title: 'The cost of AI, measured and bounded',
      lead: 'The router picks the model by cost, latency and load. Budgets cut before spend becomes a surprise.',
      cols: 4,
      items: [
        {
          value: '10M',
          label: 'Tokens per day',
          sub: 'Global budget with a soft cut at 70 percent',
          accent: '06b6d4',
        },
        {
          value: '3M',
          label: 'Tokens per session',
          sub: 'Ceiling per working session',
          accent: '8b5cf6',
        },
        {
          value: '100k',
          label: 'Tokens per agent',
          sub: 'Each role carries its own limit',
          accent: 'fbbf24',
        },
        {
          value: '3',
          label: 'Routing profiles',
          sub: 'cheap, balanced and premium, with chained failover',
          accent: '22d3ee',
        },
      ],
    },

    {
      layout: 'timeline',
      eyebrow: 'Adoption',
      title: 'How to get in without breaking anything',
      lead: 'Four steps, each reversible and each with its own success criterion.',
      items: [
        {
          step: '01',
          heading: 'Audit',
          body: 'Review the tools, skills and permissions already installed. The audit does not guarantee execution, but it does reveal the real surface.',
        },
        {
          step: '02',
          heading: 'Pilot',
          body: 'One area, one process, one agent. With a token budget and tracing live from day one.',
        },
        {
          step: '03',
          heading: 'Extend',
          body: 'Promote what worked into formal roles, with permissions and limits per role.',
        },
        {
          step: '04',
          heading: 'Govern',
          body: 'Gates, backups, audit and stack upgrades become part of the operating routine.',
        },
      ],
    },

    {
      layout: 'closing',
      title: 'The next step is a diagnostic, not a contract',
      body: 'We propose a working session to audit how AI sits in your organisation today and which part of this platform can be adopted without friction. No cost and no implementation commitment.',
      ctas: [{ label: 'Request the stack diagnostic' }, { label: 'See the full architecture' }],
      contacts: [
        'WhatsApp: +54 9 264 545-2221',
        'Email: gentlevanguard@gmail.com',
        'Emmanuel Ortiz Gutierrez - Software Architect, AI Integration Engineer',
      ],
      note: 'The stack is open source. Internal adoption happens on top of the repository and your own company policies.',
    },
  ],
};
