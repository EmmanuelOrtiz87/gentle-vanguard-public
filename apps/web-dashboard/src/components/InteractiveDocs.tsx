import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Play,
  CheckCircle,
  Book,
  Code,
  Terminal,
  Layers,
  Shield,
  BarChart3,
  Zap,
  Star,
  Gauge,
  Route,
  GitBranch,
  Monitor,
  ArrowRight,
} from 'lucide-react';

interface Step {
  id: string;
  title: string;
  content: string;
  code?: string;
}

interface ArchLayer {
  id: string;
  label: string;
  subtitle: string;
  description: string;
  details: string[];
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  icon: typeof Book;
  steps: Step[];
  archLayers?: ArchLayer[];
}

const archLayers: ArchLayer[] = [
  {
    id: 'agents',
    label: 'Layer 5 – Agents',
    subtitle: '18 specialized AI agents',
    description:
      'The top layer of the stack. Each agent has a specific role, toolset, and routing rules. Agents include DEV, QA, DOC, BA, SAD, Finance, HR, Legal, Ops, Sales, Marketing, Gov, and more.',
    details: [
      'Role-specific prompt engineering per agent',
      'Model routing: each agent uses the optimal LLM per task',
      'Cross-agent collaboration and delegation',
      'Adaptive profiles that adjust behavior per project',
    ],
  },
  {
    id: 'commands',
    label: 'Layer 4 – Commands',
    subtitle: 'gv.ps1, pre-process hooks',
    description:
      'The CLI entry point. All interactions flow through a unified command layer that handles pre-processing, routing, session management, and orchestration.',
    details: [
      'Unified CLI via gv.ps1 with subcommands for agents, skills, sessions',
      'Pre-process hooks analyze every message before routing',
      'Auto-delegation engine maps keywords to agents and skills',
      'Session lifecycle: init, track, persist, resume',
    ],
  },
  {
    id: 'mcp',
    label: 'Layer 3 – MCP',
    subtitle: 'skill-server, protocol bridge',
    description:
      'Model Context Protocol layer. A protocol-agnostic bridge that connects AI agents to skills, tools, and external services via a standardized interface.',
    details: [
      'skill-server: MCP-compatible server exposing all 386 skills',
      'Tool-agnostic: same protocol works across OpenCode, Claude Code, Cursor, etc.',
      'AG-UI protocol hints for rich UI rendering (metrics, charts, forms)',
      'Human-in-the-loop modal support via MCP hints',
    ],
  },
  {
    id: 'skills',
    label: 'Layer 2 – Skills',
    subtitle: '386 on-demand capabilities',
    description:
      'The skill layer encapsulates every development and business function as a reusable, versioned capability. Skills are the atomic unit of value in the platform.',
    details: [
      'On-demand loading — skills are fetched only when needed',
      'Community skill marketplace with contributions workflow',
      'Each skill has an SKILL.md manifest defining its interface',
      'Semver tracking and dependency resolution (planned)',
    ],
  },
  {
    id: 'memory',
    label: 'Layer 1 – Memory',
    subtitle: 'Engram persistent memory',
    description:
      'The foundation layer. Engram provides hot/warm/cold tiered memory that persists across sessions, enabling long-term context retention and continuous learning.',
    details: [
      'Hot tier: in-context working memory for current session',
      'Warm tier: recently accessed observations cached for fast retrieval',
      'Cold tier: persistent SQLite-backed storage across all sessions',
      'Cross-session context: agents remember decisions from previous sessions',
    ],
  },
];

const tutorials: Tutorial[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'What is Gentle-Vanguard and the 3 Pillars',
    icon: Zap,
    steps: [
      {
        id: 'what-is-gv',
        title: 'What is Gentle-Vanguard?',
        content:
          'Gentle-Vanguard is an AI-powered development orchestrator that provides structure, memory, and governance to AI-assisted software engineering. It sits as an abstraction layer between your IDE and AI agents, unifying development across any toolchain. Version 3.3.0 ships 18 specialized agents, 386 skills, 27 CI/CD workflows, and 10 IDE integrations.',
        code: 'git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git\ncd gentle-vanguard\n./gv.ps1 init',
      },
      {
        id: 'three-pillars',
        title: 'The 3 Pillars',
        content:
          'Automation: repetitive processes eliminated via pre-commit hooks, CI/CD pipelines, and auto-enforcement. Quality: embedded security validation through 7D review and Judgment Day gates. AI-Ready: optimized for AI agents with Engram memory, skill MCPs, and adaptive profiles that work across 10 different IDEs.',
      },
      {
        id: 'quick-start',
        title: 'Quick Start',
        content:
          'Initialize a new project, detect your IDE, and run your first agent task. The platform auto-detects which tool you are using (OpenCode, Cursor, Windsurf, etc.) and loads the right configuration.',
        code: 'gv.ps1 init --project my-app\ngv.ps1 status\ngv.ps1 agent run DEV "set up the project"',
      },
    ],
  },
  {
    id: 'platform-overview',
    title: 'Platform Overview',
    description: 'Stats, agents, skills, workflows, and tools',
    icon: BarChart3,
    steps: [
      {
        id: 'core-stats',
        title: 'Core Platform Stats',
        content:
          'Gentle-Vanguard at a glance: 18 specialized AI agents handling different roles (DEV, QA, DOC, BA, SAD, Finance, HR, Legal, Ops, Sales, Mkt, Gov). 386 on-demand skills covering everything from code generation to compliance checking. 27 CI/CD workflows for automated testing, building, and deployment. 10 IDE integrations with full tool-agnostic support.',
      },
      {
        id: 'infrastructure',
        title: 'Infrastructure & Scale',
        content:
          '298 AES-256 encrypted scripts ensure zero plain-text in the public repository. 30 CI/CD automations (up from 27 in earlier versions). 7 architectural layers providing full-stack depth from memory to agent interfaces. 100% tool-agnostic — works with any IDE or AI coding tool.',
        code: 'gv.ps1 system info\n# 18 agents | 386 skills | 30 workflows | 298 scripts | 10 tools',
      },
      {
        id: 'key-metrics',
        title: 'Key Metrics',
        content:
          '393+ unit tests across the platform. 16 verification gates in the QA pipeline. 7D validation covering Security, Performance, Readability, Maintainability, Testability, Documentation, and Architecture. 60+ normatives documented for governance and compliance.',
      },
    ],
  },
  {
    id: 'architecture',
    title: 'Architecture',
    description: 'The 5-Layer Stack — click layers to explore',
    icon: Layers,
    steps: [
      {
        id: 'five-layers',
        title: '5-Layer Stack Architecture',
        content:
          'Gentle-Vanguard is built on a 5-layer architecture: Agents → Commands → MCP → Skills → Memory. Each layer has a distinct responsibility and communicates through well-defined interfaces. The stack is tool-agnostic, supports SDD lifecycle enforcement, and includes Engram memory with hot/warm/cold tiers across sessions.',
      },
    ],
    archLayers,
  },
  {
    id: 'tool-agnostic',
    title: 'Tool-Agnostic',
    description: 'All 10 IDE integrations',
    icon: Monitor,
    steps: [
      {
        id: 'supported-tools',
        title: '10 Supported IDEs',
        content:
          'Gentle-Vanguard works with every major AI coding tool. Zero vendor lock-in. The detect-tool.ps1 script auto-detects which tool is running and loads the right configuration profile.',
        code: 'gv.ps1 detect-tool\n# Auto-detects: OpenCode, Claude Code, Cursor, Windsurf, etc.',
      },
      {
        id: 'integration-details',
        title: 'Integration Details',
        content:
          'OpenCode: native support with full MCP integration. Claude Code: full profile with Engram bridge. Cline: skill emulation with memory via .clinerules. Cursor: adaptive profile with .cursorrules. Windsurf: auto-detected and configured. Codex: CLI-based with skill loading. Continue.dev: open-source IDE integration. Copilot: GitHub ecosystem integration. Antigravity: dedicated adaptive profile. Supermaven: full stack support.',
      },
    ],
  },
  {
    id: 'sdd-lifecycle',
    title: 'SDD Lifecycle',
    description: 'BA → SAD → DEV → QA with 7D Validation',
    icon: GitBranch,
    steps: [
      {
        id: 'ba-explore',
        title: 'BA Explore',
        content:
          'Business analysis and requirements gathering. The BA agent understands the problem before writing code. Uses keyword-to-skill mapping to route ambiguous input. This phase ensures every feature is grounded in real business need before any architecture or code is created.',
      },
      {
        id: 'sad-design-dev',
        title: 'SAD Design & DEV Implement',
        content:
          'SAD Design creates system architecture specifications that drive implementation. DEV Implement follows strict TDD patterns with model routing — each development phase uses the optimal LLM for the task. Code generation is guided by the architecture spec created in the SAD phase.',
        code: 'gv.ps1 agent run SAD "design auth module"\ngv.ps1 agent run DEV "implement auth module"',
      },
      {
        id: 'qa-judgment-day',
        title: 'QA Verify & 7D Validation',
        content:
          'Automated testing and validation gates before any merge. Judgment Day enforces 7 dimensions: Security · Performance · Readability · Maintainability · Testability · Documentation · Architecture. No code ships without passing all 7 dimensions. 393+ unit tests and 16 verification gates enforce quality.',
        code: '# Judgment Day gates\nlefthook run pre-commit\ngv.ps1 qa run --all\n# 7D: Security, Performance, Readability, Maintainability,\n#      Testability, Documentation, Architecture',
      },
    ],
  },
  {
    id: 'auto-delegation',
    title: 'Auto-Delegation & Sessions',
    description: 'ML routing, session autostart, lifecycle',
    icon: Route,
    steps: [
      {
        id: 'ml-routing',
        title: 'ML-Powered Routing',
        content:
          'The auto-delegation engine (config/auto-delegation.json) maps keywords to skills and agents. Every message is pre-processed and routed automatically. 80%+ direct routing confidence, 60%+ confirmation threshold, with BA explore fallback for ambiguous input.',
        code: '# auto-delegation.json maps keywords to agents\n{\n  "routes": [\n    { "pattern": "security|vulnerability", "agent": "SEC", "confidence": 0.85 },\n    { "pattern": "test|coverage", "agent": "QA", "confidence": 0.82 }\n  ],\n  "fallback": "BA",\n  "minConfidence": 0.6\n}',
      },
      {
        id: 'session-lifecycle',
        title: 'Session Autostart & Lifecycle',
        content:
          '10-phase initialization: health check, tool detection, orphan cleanup, session initialization, engram policy loading, optimization, skill registry setup, plugin loading, adaptive profile configuration. Includes orphan detection and cleanup, token budget tracking, and Watchtower health checks.',
        code: 'gv.ps1 session start --agent DEV\ngv.ps1 session list\ngv.ps1 session status --id <session-id>',
      },
    ],
  },
  {
    id: 'security',
    title: 'Security & Governance',
    description: 'AES-256, scanning, compliance',
    icon: Shield,
    steps: [
      {
        id: 'encryption',
        title: 'AES-256 Encryption',
        content:
          '298 scripts encrypted with AES-256. Zero plain-text scripts in the public repository. A master key is required to decrypt. This ensures sensitive automation logic remains protected even if the repository is compromised.',
        code: 'gv.ps1 script encrypt --all\ngv.ps1 script decrypt --id deploy-prod --key "$MASTER_KEY"',
      },
      {
        id: 'proactive-scanning',
        title: 'Proactive Security Scanning',
        content:
          'TruffleHog pre-commit hook scans for secrets before every commit. Gitleaks integration in CI pipeline for additional secret detection. Trivy dependency scanning for vulnerability detection. Multi-layer enforcement: pre-response hook (every turn), pre-commit hooks (Lefthook), CI/CD (27 workflows), adaptive enforcement.',
      },
      {
        id: 'compliance',
        title: 'Compliance & Governance',
        content:
          'SOC2 and GDPR frameworks documented. SBOM generation for supply chain transparency. Security audit trail for all agent actions. 60+ normatives documented. Judgment Day 7D validation includes Security as a mandatory gate. 16 verification gates ensure nothing ships without approval.',
      },
    ],
  },
  {
    id: 'roi-impact',
    title: 'ROI Impact',
    description: 'Before/After comparison',
    icon: Gauge,
    steps: [
      {
        id: 'comparison',
        title: 'ROI Comparison',
        content:
          'Time on technical bureaucracy reduced from ~30% to ~5%. Time on customer value delivery increased from ~70% to ~95%. New workstation setup went from hours-to-days to a single command. Documentation is now auto-generated instead of manual and stale. Security incident detection shifted from reactive to proactive with pre-commit scanning.',
      },
      {
        id: 'key-improvements',
        title: 'Key Improvements',
        content:
          'Before: 30% of time spent on technical bureaucracy. After: only 5%. Before: 70% of time on value delivery. After: 95%. Before: new workstation setup took hours to days. After: single command. Before: documentation was manual and stale. After: auto-generated from code and architecture specs.',
        code: 'gv.ps1 system setup --workstation\n# Single command. Done in seconds.',
      },
    ],
  },
  {
    id: 'features-by-version',
    title: 'Features by Version',
    description: 'v3.1.0, v3.2.0, v3.3.0',
    icon: Star,
    steps: [
      {
        id: 'v310',
        title: 'v3.1.0 — Foundation',
        content:
          'Dashboard v4 with OpenTelemetry tracing visualization and E2E traceability across all agents and skills. Skill Marketplace with publishing, rating, and review system for community-driven extension. Interactive Documentation with guided tutorials and progress tracking. Performance optimizations with code splitting, lazy loading, and manual chunks.',
      },
      {
        id: 'v320',
        title: 'v3.2.0 — CopilotKit Patterns',
        content:
          '5 native patterns over MCP with no external dependencies: Agent Chat Interface with 6 agents, @mentions autocomplete, suggested actions. AG-UI Protocol with 7 renderable hints (metric, datatable, chart, diff, form, list, alert). Human-in-the-Loop modal with 4 modes (confirmation, selection, form, review). Shared State Bridge via EventBus → WebSocket → Dashboard in 3 channels. Task Control & Timeline with dispatch quick-action. Session Persistence saved to disk.',
      },
      {
        id: 'v330',
        title: 'v3.3.0 — Platform Expansion',
        content:
          '4 roadmap features delivered: Community Skills with issue templates, CI validation, marketplace API scanning 386 skills. Global Health Dashboard with cross-repository health metrics, status banners, and real-time WebSocket updates. CI/CD Expansion with multi-stage Docker builds, 6-service test compose, 14 API integration tests, Trivy scanning. Auto-Update with version check via GitHub API, auto-download, backup/rollback, and release workflow.',
        code: 'gv.ps1 version\n# Gentle-Vanguard v3.3.0\ngv.ps1 update check\ngv.ps1 update apply',
      },
    ],
  },
  {
    id: 'roadmap',
    title: 'Roadmap',
    description: 'Future plans and vision',
    icon: ArrowRight,
    steps: [
      {
        id: 'immediate-plans',
        title: 'Immediate Plans',
        content:
          'Multi-Repo Health Aggregation: connect to GitHub API for real cross-repository health data instead of mock data. Skill Versioning & Dependencies: semver tracking for skills with dependency resolution and rollback support. Dashboard Alerting: configure thresholds and receive Slack/Email notifications on health degradation. Container Registry Publishing: auto-publish Docker images to GitHub Container Registry on release.',
      },
      {
        id: 'long-term-vision',
        title: 'Long-Term Vision',
        content:
          'Building the definitive bridge between software engineering and corporate strategy. Continued expansion of the 18-agent ecosystem. Deepening OpenTelemetry integration for full observability. Expanding the community skill ecosystem. Enterprise-grade compliance automation. The platform currently has 18 agents, 386 skills, 10 tools, 30 workflows, and 60 normatives — and continues to grow.',
      },
    ],
  },
];

export function InteractiveDocs() {
  const [activeStep, setActiveStep] = useState<{ tutorialId: string; stepId: string } | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [expandedTutorials, setExpandedTutorials] = useState<Set<string>>(new Set());
  const [activeArchLayer, setActiveArchLayer] = useState<string>('agents');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleTryIt = () => {
    if (!activeStepData?.code) {
      showToast('No code to run for this step');
      return;
    }
    navigator.clipboard.writeText(activeStepData.code).then(
      () => showToast('Copied to clipboard!'),
      () => showToast('Could not copy'),
    );
  };

  const handleViewCode = () => {
    if (!activeStepData?.code) {
      showToast('No code to show for this step');
      return;
    }
    showToast('Code shown in the terminal block above');
  };

  const toggleTutorial = (id: string) => {
    const next = new Set(expandedTutorials);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedTutorials(next);
  };

  const completeStep = (tutorialId: string, stepId: string) => {
    const key = `${tutorialId}__${stepId}`;
    const next = new Set(completedSteps);
    next.add(key);
    setCompletedSteps(next);
  };

  const isStepCompleted = (tutorialId: string, stepId: string) =>
    completedSteps.has(`${tutorialId}__${stepId}`);

  const getProgress = (tutorial: Tutorial) => {
    const done = tutorial.steps.filter((s) => isStepCompleted(tutorial.id, s.id)).length;
    return Math.round((done / tutorial.steps.length) * 100);
  };

  const activeTutorial = activeStep ? tutorials.find((t) => t.id === activeStep.tutorialId) : null;
  const activeStepData = activeStep
    ? (activeTutorial?.steps.find((s) => s.id === activeStep.stepId) ?? null)
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-sm shadow-lg transition-all">
          {toast}
        </div>
      )}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Interactive Documentation
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Learn Gentle-Vanguard through guided tutorials with real platform content
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          v3.3.0
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Book className="w-5 h-5" />
            Tutorials
          </h2>
          {tutorials.map((tutorial) => {
            const Icon = tutorial.icon;
            const progress = getProgress(tutorial);
            const isActive = activeStep?.tutorialId === tutorial.id;

            return (
              <div
                key={tutorial.id}
                className={`rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600'
                }`}
                onClick={() => toggleTutorial(tutorial.id)}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                          isActive
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-gray-900 dark:text-white text-sm truncate">
                          {tutorial.title}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {tutorial.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                        {progress}%
                      </span>
                      {expandedTutorials.has(tutorial.id) ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  {expandedTutorials.has(tutorial.id) && (
                    <div className="mt-3 space-y-1">
                      {tutorial.steps.map((step, idx) => {
                        const stepCompleted = isStepCompleted(tutorial.id, step.id);
                        const stepActive =
                          activeStep?.tutorialId === tutorial.id && activeStep?.stepId === step.id;
                        return (
                          <div
                            key={step.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveStep({ tutorialId: tutorial.id, stepId: step.id });
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                              stepActive
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            <span
                              className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                                stepCompleted
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                  : stepActive
                                    ? 'bg-blue-200 dark:bg-blue-800/50 text-blue-600 dark:text-blue-300'
                                    : 'bg-gray-200 dark:bg-gray-600 text-gray-500'
                              }`}
                            >
                              {stepCompleted ? <CheckCircle className="w-3 h-3" /> : idx + 1}
                            </span>
                            <span
                              className={`truncate ${stepCompleted ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}
                            >
                              {step.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Content Panel */}
        <div className="lg:col-span-2">
          {activeStep !== null && activeStepData !== null ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">
                    {activeTutorial?.title}
                  </p>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    {activeStepData.title}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {!isStepCompleted(activeStep.tutorialId, activeStep.stepId) && (
                    <button
                      onClick={() => completeStep(activeStep.tutorialId, activeStep.stepId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Complete
                    </button>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                  {activeStepData.content}
                </p>
              </div>

              {/* Architecture Section — Special Interactive 5-Layer Stack */}
              {activeStep?.tutorialId === 'architecture' && (
                <div className="mb-6">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {archLayers.map((layer, idx) => (
                      <button
                        key={layer.id}
                        onClick={() => setActiveArchLayer(layer.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          activeArchLayer === layer.id
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700'
                            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 border border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <span className="font-mono">L{5 - idx}</span>
                        <span>{layer.label.split('–')[1]?.trim() || layer.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Layer visual flow */}
                  <div className="flex items-center justify-center gap-0.5 mb-6 overflow-x-auto py-3">
                    {archLayers.map((layer, idx) => {
                      const isActive = activeArchLayer === layer.id;
                      return (
                        <div key={layer.id} className="flex items-center">
                          <button
                            onClick={() => setActiveArchLayer(layer.id)}
                            className={`flex-shrink-0 px-3 py-2 rounded-lg text-center transition-all min-w-[80px] ${
                              isActive
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 scale-105'
                                : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            <div className="text-[10px] font-mono font-bold uppercase tracking-wider">
                              L{5 - idx}
                            </div>
                            <div className="text-xs font-semibold mt-0.5">
                              {layer.label.split('–')[1]?.trim() || layer.label}
                            </div>
                          </button>
                          {idx < archLayers.length - 1 && (
                            <ArrowRight
                              className={`w-4 h-4 mx-1 flex-shrink-0 ${
                                isActive ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600'
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Active layer detail */}
                  {(() => {
                    const layer = archLayers.find((l) => l.id === activeArchLayer);
                    if (!layer) return null;
                    return (
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                        <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">
                          {layer.label}
                        </h4>
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-3">
                          {layer.subtitle}
                        </p>
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
                          {layer.description}
                        </p>
                        <ul className="space-y-2">
                          {layer.details.map((detail, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400"
                            >
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                              {detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Code Block */}
              {typeof activeStepData.code === 'string' && (
                <div className="bg-gray-900 dark:bg-gray-950 rounded-xl overflow-hidden mb-6">
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 border-b border-gray-700/50">
                    <Terminal className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs text-gray-400 font-medium">Terminal</span>
                  </div>
                  <pre className="p-4 text-sm text-green-400 font-mono leading-relaxed overflow-x-auto">
                    {activeStepData.code}
                  </pre>
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleTryIt}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Try It
                </button>
                <button
                  onClick={handleViewCode}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <Code className="w-4 h-4" />
                  View Code
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-center h-96">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <Book className="w-8 h-8 text-gray-300 dark:text-gray-500" />
                </div>
                <p className="text-gray-500 dark:text-gray-400 font-medium">
                  Select a tutorial from the sidebar
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  10 sections covering the full Gentle-Vanguard platform
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InteractiveDocs;
