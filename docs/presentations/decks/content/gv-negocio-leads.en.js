/**
 * Set 1 - Business and leads (EN).
 *
 * Audience: business owners and companies evaluating a custom build. Goal:
 * explain who we are, what we do, how we work, and land one concrete action
 * (the free diagnostic).
 *
 * Editorial rule: no invented clients, testimonials, results or certifications.
 * The internal apps are presented as our own working developments, never as
 * client case studies.
 */

export default {
  id: 'gv-negocio-leads-en',
  title: 'GentleVanguard - Custom software, automation and applied AI',
  subject: 'GentleVanguard company presentation',
  footer: 'GentleVanguard - San Juan, Argentina',
  theme: 'hybrid',
  hero: 'negocio',
  slides: [
    {
      layout: 'cover',
      eyebrow: 'Custom software - Automation - Applied AI',
      title: 'Your business grows.\nYour systems should too.',
      titleSize: 36,
      titleH: 1.3,
      subtitle:
        'We design apps, business systems and automations around how your team actually works. Free diagnostic, staged proposal and fixed prices by milestone.',
      meta: ['Free diagnostic', 'Fixed price per milestone', 'San Juan, Argentina'],
      version: 'Stack v4.3.0 - November 2026',
    },

    {
      layout: 'statement',
      eyebrow: 'Who we are',
      title: 'A software studio that listens before it builds',
      body:
        'GentleVanguard designs and builds custom apps and business systems for small and mid-sized companies that need to order their processes, automate operations and grow on dependable software. We work project by project, as an independent contractor, from San Juan, Argentina.',
      bodyW: 8.2,
      bodySize: 12.5,
      stats: [
        { value: '15+', label: 'Years of practice', sub: 'Software architecture and applied AI inside companies' },
        { value: '3', label: 'Service lines', sub: 'Custom software, automation and applied AI' },
        { value: '1', label: 'Accountable owner', sub: 'The same person designs, builds and delivers' },
      ],
    },

    {
      layout: 'cards',
      eyebrow: 'What we do',
      title: 'Three ways to bring an operation back in order',
      lead: 'Every project starts from the real process, not from a tool.',
      cols: 3,
      items: [
        {
          icon: 'laptop',
          heading: 'Custom software',
          body: 'Apps and portals built around your processes, not the other way around. Customer management, operations and tracking. Evolution of systems that no longer scale.',
          accent: '06b6d4',
        },
        {
          icon: 'gears',
          heading: 'Automation',
          body: 'Integrations across systems, CRM and payments. Conversational service flows. Dashboards and reports so tracking stops depending on spreadsheets.',
          accent: '8b5cf6',
        },
        {
          icon: 'brain',
          heading: 'Applied AI',
          body: 'We assess where artificial intelligence actually pays off: assistants connected to your own information, with clear limits and human review.',
          accent: 'fbbf24',
        },
      ],
    },

    {
      layout: 'principle',
      eyebrow: 'How we work',
      title: 'A short method, with the criteria agreed before we start',
      items: [
        {
          heading: 'We understand first',
          body: 'We talk about the problem, the people involved and the tools you already use. Nothing is designed on assumptions.',
          accent: '06b6d4',
        },
        {
          heading: 'Then we build',
          body: 'We agree on priorities, stages, deliverables and acceptance criteria. The first version is tested and reviewed with evidence.',
          accent: '8b5cf6',
        },
        {
          heading: 'We stay with it',
          body: 'Go-live, documentation, training and an agreed path for evolution. Delivery is the start of the operation, not its end.',
          accent: 'fbbf24',
        },
      ],
      closing:
        'A project does not start with a proposal. It starts with a diagnostic that ends in a process map, the main pain points, automation opportunities and a staged roadmap.',
    },

    {
      layout: 'metrics',
      eyebrow: 'The difference',
      title: 'We do not sell hours: we operate on a platform we already built',
      lead:
        'GentleVanguard is a studio with its own stack. That platform is what holds up delivery times, quality and traceability on every project.',
      cols: 4,
      items: [
        { value: '28', label: 'Own apps', sub: 'Systems we developed and that run today', accent: '06b6d4' },
        { value: '20', label: 'AI agents', sub: 'Roles with model, permissions and budget assigned', accent: '8b5cf6' },
        { value: '256', label: 'Skills', sub: 'Reusable capabilities that are not rewritten per project', accent: 'fbbf24' },
        { value: '35', label: 'Components watched', sub: 'Health checks per component, with auto-heal', accent: '22d3ee' },
      ],
    },

    {
      layout: 'figureLayers',
      eyebrow: 'The platform',
      title: 'A layered stack, not a one-off project',
      lead: 'Each layer solves one class of problems and keeps a record of what it did.',
      textW: 3.3,
      items: [
        { icon: 'layers', heading: 'Layers', body: 'Surfaces, orchestration, agents, skills, knowledge, tools and infrastructure.' },
        { icon: 'eye', heading: 'Traceability', body: 'Sessions, traces, events and hash-chained audit in the local database.' },
        { icon: 'shield', heading: 'Governance', body: '47 quality gates, secret scanning and fail-closed policies.' },
        { icon: 'cloud', heading: 'Local first', body: 'Runs on your team machine and is exposed to the cloud when needed.' },
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
      layout: 'timeline',
      eyebrow: 'The path',
      title: 'From the first conversation to a running operation',
      lead: 'Stages with verifiable deliverables, not open-ended phases.',
      items: [
        { step: '01', heading: 'Understand', body: 'We map the process, the roles and the tools in use today.' },
        { step: '02', heading: 'Define', body: 'Scope, stages, deliverables and acceptance criteria are agreed.' },
        { step: '03', heading: 'Build', body: 'A first useful version, tested and reviewed with its real users.' },
        { step: '04', heading: 'Operate', body: 'Go-live, documentation, training and evolution.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Scope',
      title: 'What can be contracted, and in which order',
      lead: 'Reference price list in US dollars, net of taxes. Refreshed before every quote.',
      headers: ['Service', 'Reference range (USD)', 'When it makes sense'],
      colW: [2.9, 2.3, 3.6],
      rows: [
        ['Analysis and proposal', '200 - 400', 'You are not sure what to build. Deducted in full when you sign.'],
        ['Landing page / Corporate site', '350 - 700 / 900 - 1,800', 'You need your own presence and a simple way to receive enquiries.'],
        ['Web app with integrations', '3,500 - 8,000', 'The process already lives across several tools that need connecting.'],
        ['Mobile app MVP', '3,000 - 6,000', 'The team needs to operate away from a desk.'],
        ['WhatsApp bot simple / hybrid with AI', '1,500 - 2,500 / 3,500 - 5,000', 'There is repetitive service work that can be automated.'],
        ['AI agent with RAG', '4,000 - 8,000', 'Queries need to answer from your own documentation.'],
        ['Custom CRM', '5,000 - 15,000', 'Commercial tracking is scattered.'],
        ['Maintenance and support', '90 - 250 per month', 'A system already exists and needs sustaining and evolving.'],
      ],
    },

    {
      layout: 'compare',
      eyebrow: 'Why us',
      title: 'A studio with its own stack, versus an isolated build',
      lead: 'Two paths that often look equivalent and are not.',
      left: {
        head: 'GentleVanguard',
        sub: 'A studio that operates on its own platform',
        icon: 'shield',
        accent: '06b6d4',
        items: [
          { text: 'Fixed prices per milestone and bounded scope before we start.' },
          { text: 'Documented diagnostic: process map, risks and staged roadmap.' },
          { text: 'Code, documentation and delivery criteria under one quality bar.' },
          { text: 'Capabilities reused across projects: what was solved is not paid for twice.' },
          { text: 'Continuity after delivery: support, improvements and new integrations.' },
          { text: 'Own training: GV Academy so your team adopts the system.' },
        ],
      },
      right: {
        head: 'Isolated build',
        sub: 'The project starts and ends with the project',
        icon: 'cross',
        accent: '8b95a8',
        items: [
          { text: 'Vague scope adjusted on the fly, with cost as the variable.', mark: 'warn' },
          { text: 'Software handed over with no documented process and no transferred operation.', mark: 'warn' },
          { text: 'Every project re-solves the same base problems.', mark: 'warn' },
          { text: 'No knowledge transfer: the system depends on a single person.', mark: 'cross' },
          { text: 'No agreed continuity: the system ages with no path forward.', mark: 'cross' },
          { text: 'No training: adoption stays in the provider hands.', mark: 'cross' },
        ],
      },
    },

    {
      layout: 'metrics',
      eyebrow: 'Beyond the project',
      title: 'GV Academy: the knowledge stays with your team',
      lead: 'A live, open catalogue: 89 products across applied AI, software and business practice.',
      cols: 4,
      items: [
        { value: '30', label: 'Courses', sub: 'With 429 hours of video content', accent: '06b6d4' },
        { value: '33', label: 'Ebooks', sub: '2,634 pages, 18 of them in the premium edition', accent: '8b5cf6' },
        { value: '26', label: 'Toolkits', sub: 'Prompts and flows ready to apply', accent: 'fbbf24' },
        { value: '89', label: 'Products', sub: 'Published and sold individually', accent: '22d3ee' },
      ],
    },

    {
      layout: 'figure',
      eyebrow: 'Proof of work',
      title: 'This is already running: 28 of our own developments',
      lead: 'These are not catalogue products or client case studies. They are systems we built and that run today.',
      textW: 3.5,
      image: 'stack-dashboard.png',
      imageAlt: 'Architecture of the stack observability dashboard',
      caption: 'Stack observability dashboard, fed by real traces',
      items: [
        { icon: 'academy', heading: 'GV Academy', body: 'Learning platform, portal, CRM and a catalogue of 89 products.' },
        { icon: 'mobile', heading: 'WhatsApp bot', body: 'Deterministic conversational service, running in production.' },
        { icon: 'chart', heading: 'Observability', body: 'Dashboard with live metrics, traces, alerts and feedback.' },
        { icon: 'boxes', heading: 'Command center', body: 'App lifecycle: start, status and logs.' },
      ],
    },

    {
      layout: 'statement',
      eyebrow: 'The first step',
      title: 'The first consultation is free of charge',
      body:
        'We meet, we understand your operation, and you walk away with a clear analysis plus a staged proposal with fixed milestone pricing. Then you decide whether we move forward. If we do not, the diagnostic is still yours.',
      bodyW: 8.2,
      bodySize: 13,
      stats: [
        { value: 'Free', label: 'Initial diagnostic', sub: 'Includes process map and staged roadmap' },
        { value: '50/40/10', label: 'Payment milestones', sub: 'Fixed price per milestone, paid in advance' },
        { value: '30 days', label: 'Warranty', sub: 'Product warranty at delivery sign-off' },
      ],
    },

    {
      layout: 'closing',
      title: 'Let us start by understanding your operation',
      body: 'One diagnostic conversation is enough to know whether there is a project here and what it is worth. No commitment.',
      ctas: [
        { label: 'I want my free diagnostic' },
        { label: 'See the catalogue' },
      ],
      contacts: [
        'WhatsApp: +54 9 264 545-2221',
        'Email: gentlevanguard@gmail.com',
        'San Juan, Argentina - Project basis, independent contracting',
      ],
      note: 'The institutional presentation and the Academy catalogue are published at gentlevanguard.github.io',
    },
  ],
};
