#!/usr/bin/env tsx
/**
 * skill-frontmatter-sync.ts — Batch update SKILL.md frontmatter for all system skills
 *
 * Adds or standardizes YAML frontmatter with:
 * - name: skill directory name
 * - description: concise description + trigger words
 * - triggers: list of keywords for routing
 *
 * Usage:
 *   npx tsx src/skill-frontmatter-sync.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';

const SKILLS_DIR = path.join(process.cwd(), '.opencode', 'skills');
const DRY_RUN = process.argv.includes('--dry-run');

interface SkillInfo {
  name: string;
  description: string;
  triggers: string[];
  hasWhenToUse: boolean;
}

// Skill registry with known metadata
const SKILL_REGISTRY: Record<string, Partial<SkillInfo>> = {
  'ab-testing': {
    description:
      'A/B experimentation framework for comparing variants, routing strategies, and behavioral changes.',
    triggers: ['ab-test', 'experiment', 'variant', 'split-test', 'a/b testing'],
  },
  'api-and-interface-design': {
    description:
      'Design stable APIs and module boundaries. Use for REST/GraphQL endpoints, component props, or public interface changes.',
    triggers: ['api design', 'interface', 'endpoint', 'module boundary', 'public api'],
  },
  'browser-testing-with-devtools': {
    description:
      'Test in real browsers via Chrome DevTools MCP. Inspect DOM, capture console errors, analyze network requests, profile performance.',
    triggers: ['browser test', 'devtools', 'chrome', 'dom inspect', 'performance profile'],
  },
  'ci-cd-and-automation': {
    description:
      'Automate CI/CD pipelines. Configure build processes, test runners, deployment strategies, and quality gates.',
    triggers: ['ci/cd', 'pipeline', 'automation', 'build', 'deploy', 'github actions'],
  },
  'code-review-and-quality': {
    description:
      'Multi-axis code review. Assess correctness, readability, architecture, security, and performance before merging.',
    triggers: ['code review', 'quality', 'review code', 'assess', 'pre-merge review'],
  },
  'code-simplification': {
    description:
      'Simplify code for clarity without changing behavior. Refactor complex code to be more readable and maintainable.',
    triggers: ['simplify', 'refactor', 'clarity', 'clean up', 'simplification'],
  },
  'context-engineering': {
    description:
      'Optimize context for new sessions. Manage context budget, compression, and efficiency for AI interactions.',
    triggers: ['context', 'context optimization', 'session start', 'context budget'],
  },
  dashboard: {
    description:
      'LLM Observability Dashboard — React/TypeScript/Vite SPA with real-time WebSocket data pipeline, i18n, and 14 metric descriptions.',
    triggers: ['dashboard', 'metrics', 'visualization', 'observability', 'charts'],
  },
  'debugging-and-error-recovery': {
    description:
      'Systematic root-cause debugging. Use when tests fail, builds break, or behavior does not match expectations.',
    triggers: ['debug', 'error', 'troubleshoot', 'fix bug', 'root cause'],
  },
  'deprecation-and-migration': {
    description:
      'Manage deprecation and migration. Remove old systems, migrate users between implementations, decide on feature sunsetting.',
    triggers: ['deprecate', 'migration', 'sunset', 'legacy', 'migrate'],
  },
  'documentation-and-adrs': {
    description:
      'Record architectural decisions and documentation. Use when shipping features, changing APIs, or recording context for future engineers.',
    triggers: ['document', 'adr', 'decision record', 'architecture decision', 'documentation'],
  },
  'doubt-driven-development': {
    description:
      'Fresh-context adversarial review. Use when correctness matters, working in unfamiliar code, or stakes are high.',
    triggers: ['doubt', 'adversarial', 'challenge assumptions', 'stress-test', 'review with doubt'],
  },
  'engram-auto-update': {
    description: 'Auto-update engram to latest version with validation and rollback.',
    triggers: ['engram update', 'update engram', 'memory update'],
  },
  'frontend-ui-engineering': {
    description:
      'Build production-quality, accessible, responsive user interfaces. Implement layouts, components, manage state, meet WCAG requirements.',
    triggers: ['frontend', 'ui', 'component', 'react', 'accessible', 'responsive'],
  },
  'gentle-ai-monitor': {
    description:
      'Monitor gentle-ai releases without installation. Absorb updates and generate actionable suggestions.',
    triggers: ['gentle-ai', 'monitor updates', 'track releases'],
  },
  'git-workflow-and-versioning': {
    description:
      'Structure git workflow practices. Commit, branch, resolve conflicts, organize parallel work, cut releases, version bumping.',
    triggers: ['git', 'commit', 'branch', 'version', 'release', 'tag', 'changelog'],
  },
  'idea-refine': {
    description:
      'Refine raw ideas into sharp concepts. Divergent then convergent thinking to stress-test assumptions and expand options.',
    triggers: ['idea', 'refine', 'ideate', 'concept', 'brainstorm', 'stress-test idea'],
  },
  'incremental-implementation': {
    description:
      'Deliver changes incrementally. Plan first, then break features into small, ordered steps that can be implemented, tested, and verified.',
    triggers: ['incremental', 'small steps', 'break down', 'step by step', 'iterative'],
  },
  'interview-me': {
    description:
      'Extract what the user actually wants. One-question-at-a-time interviewing with hypothesis attached.',
    triggers: ['interview', 'clarify', 'extract requirements', 'interview me', 'grill me'],
  },
  'planning-and-task-breakdown': {
    description:
      'Plan before you write. Break work into small, ordered tasks from specs or vague requirements. Decompose into implementable units with acceptance criteria, after a structured pre-write planning phase (scope, approach, risk, breakdown) with decision gates before implementation.',
    triggers: [
      'plan',
      'breakdown',
      'tasks',
      'decompose',
      'planning',
      'task breakdown',
      'plan before write',
      'pre-write planning',
      'scope definition',
      'approach analysis',
      'risk assessment',
      'decision gate',
    ],
  },
  'spec-driven-development': {
    description:
      'Create specs before coding. Use when starting new projects or when requirements are unclear or ambiguous.',
    triggers: ['spec', 'specification', 'requirements', 'sdd', 'spec-driven', 'spec first'],
  },
  'test-driven-development': {
    description:
      'Drive development with tests. Write failing tests before code. Use when implementing logic, fixing bugs, or modifying behavior.',
    triggers: ['tdd', 'test driven', 'write test first', 'failing test', 'test before code'],
  },
  'using-agent-skills': {
    description:
      'Discover and invoke agent skills. Use when starting a session or when you need to discover which skill applies.',
    triggers: ['skill', 'discover skill', 'invoke skill', 'which skill', 'find skill'],
  },
  'validate-stack': {
    description:
      'Validate the full Gentle-Vanguard stack. Run verification steps for pre-process-input, session pipeline, hooks, and tool detection.',
    triggers: ['validate', 'stack verify', 'verify stack', 'check stack', 'validation'],
  },
  // === Absorbed skills (2026-08-13) ===
  'ai-provenance': {
    description:
      'Inspect and manage AI provenance marks (invisible Unicode, C2PA/Content Credentials, EXIF/XMP metadata, SynthID-class watermarks). DEFAULT is inspection only; removal is strictly on-demand with explicit user request.',
    triggers: [
      'provenance',
      'watermark detect',
      'c2pa',
      'ai content check',
      'attribution',
      'strip watermark',
      'remove ai marks',
    ],
  },
  'diagram-design': {
    description:
      'Create branded editorial diagrams (architecture, flowchart, sequence, state machine, ER, timeline, swimlane, quadrant, radar, loop, tree, org chart, Venn, pyramid, bar, line, Gantt, scatter, process, medallion, data flow, DP integration, DP security matrix) as standalone HTML/SVG/PNG. Redraw drawio/Mermaid sources.',
    triggers: [
      'diagram',
      'architecture diagram',
      'flowchart',
      'sequence diagram',
      'mermaid',
      'drawio',
      'data flow',
      'swimlane',
      'schematic',
      'visual diagram',
    ],
  },
  'achieving-cmmc-level-2-compliance': {
    description:
      'Achieve CMMC Level 2 compliance: scoping, asset inventory, 110+ practice mapping, POA&M, assessment readiness.',
    triggers: ['cmmc', 'cmmc level 2', 'dfars', 'cybersecurity maturity model certification'],
  },
  'analyzing-sbom-for-supply-chain-vulnerabilities': {
    description:
      'Analyze SBOMs (SPDX/CycloneDX) for supply-chain vulnerabilities: component inventory, CVE correlation, risk triage.',
    triggers: [
      'sbom',
      'software bill of materials',
      'spdx',
      'cyclonedx',
      'supply chain vulnerability',
    ],
  },
  'auditing-mcp-servers-for-tool-poisoning': {
    description:
      'Audit MCP servers for tool poisoning and prompt injection: tool manifest review, permission boundaries, malicious tool detection.',
    triggers: ['mcp audit', 'tool poisoning', 'mcp server', 'model context protocol'],
  },
  'conducting-api-security-testing': {
    description:
      'Conduct API security testing: auth flaws, BOLA/IDOR, mass assignment, rate limiting, OWASP API Top 10 coverage.',
    triggers: ['api security', 'api testing', 'bola', 'idor', 'owasp api'],
  },
  'conducting-cyber-risk-assessment-with-nist-800-30': {
    description:
      'Conduct cyber risk assessment per NIST SP 800-30: threat identification, vulnerability analysis, likelihood/impact, risk register.',
    triggers: ['nist 800-30', 'risk assessment', 'cyber risk', 'risk register'],
  },
  'continuous-llm-red-teaming-with-promptfoo': {
    description:
      'Continuous LLM red-teaming with promptfoo: automated prompt-injection/jailbreak test suites in CI, regression tracking.',
    triggers: [
      'promptfoo',
      'llm red team',
      'prompt injection test',
      'jailbreak test',
      'llm regression',
    ],
  },
  'defending-llms-with-guardrails': {
    description:
      'Defend LLMs with guardrails: input/output filtering, prompt-injection defense, content moderation, safety policies.',
    triggers: ['guardrails', 'llm defense', 'prompt injection defense', 'content moderation'],
  },
  'detecting-ai-model-prompt-injection-attacks': {
    description:
      'Detect AI model prompt-injection attacks: direct/indirect injection patterns, anomaly detection, response validation.',
    triggers: ['prompt injection', 'detect prompt injection', 'llm attack detection'],
  },
  'detecting-dependency-confusion': {
    description:
      'Detect dependency-confusion attacks: package name squatting, private/public registry conflicts, malicious package triage.',
    triggers: ['dependency confusion', 'package squatting', 'malicious package', 'registry attack'],
  },
  'detecting-indirect-prompt-injection': {
    description:
      'Detect indirect prompt-injection: third-party content (web, docs, email) weaponized against LLM agents.',
    triggers: ['indirect prompt injection', 'second-order injection', 'rag injection'],
  },
  'detecting-supply-chain-attacks-in-ci-cd': {
    description:
      'Detect supply-chain attacks in CI/CD: poisoned pipelines, compromised dependencies, build-time tampering.',
    triggers: ['supply chain ci', 'pipeline attack', 'build tampering', 'ci/cd security'],
  },
  'generating-and-analyzing-sboms': {
    description:
      'Generate and analyze SBOMs: tooling (syft/cyclonedx), formats, vulnerability correlation, compliance evidence.',
    triggers: ['generate sbom', 'sbom analysis', 'software composition', 'dependency inventory'],
  },
  'implementing-devsecops-security-scanning': {
    description:
      'Implement DevSecOps security scanning: SAST/DAST/SCA integration, secret scanning, container scanning, gates in CI.',
    triggers: ['devsecops', 'security scanning', 'sast', 'dast', 'sca', 'shift left'],
  },
  'implementing-gdpr-data-protection-controls': {
    description:
      'Implement GDPR data-protection controls: DPIA, data mapping, consent, DSAR workflows, breach notification.',
    triggers: ['gdpr', 'data protection', 'dsar', 'dpia', 'consent management'],
  },
  'implementing-iso-27001-information-security-management': {
    description:
      'Implement ISO 27001 ISMS: scope, risk treatment, SoA, controls (Annex A), internal audit, certification readiness.',
    triggers: ['iso 27001', 'isms', 'information security management', 'annex a'],
  },
  'implementing-secret-scanning-with-gitleaks': {
    description:
      'Implement secret scanning with gitleaks: config, custom rules, pre-commit/CI integration, false-positive tuning.',
    triggers: ['gitleaks', 'secret scanning', 'leak detection', 'credential scan'],
  },
  'implementing-secrets-scanning-in-ci-cd': {
    description:
      'Implement secrets scanning in CI/CD: tool selection, pipeline gates, remediation workflow, rotation playbook.',
    triggers: ['secrets ci', 'secret scan pipeline', 'credential rotation', 'leak remediation'],
  },
  'performing-api-inventory-and-discovery': {
    description:
      'Perform API inventory and discovery: shadow API detection, endpoint cataloging, version tracking, exposure assessment.',
    triggers: ['api inventory', 'shadow api', 'api discovery', 'endpoint catalog'],
  },
  'performing-nist-csf-maturity-assessment': {
    description:
      'Perform NIST CSF maturity assessment: function/category scoring, gap analysis, prioritized roadmap.',
    triggers: ['nist csf', 'cybersecurity framework', 'maturity assessment', 'csf gap'],
  },
  'red-teaming-llms-with-garak': {
    description:
      'Red-team LLMs with NVIDIA garak: jailbreak, prompt-injection, data-leakage probe suites; hit-rate report triage.',
    triggers: ['garak', 'llm red team', 'jailbreak probe', 'llm vulnerability scan'],
  },
  'securing-agentic-ai-tool-invocation': {
    description:
      'Secure agentic AI tool invocation: tool permissioning, input validation, output verification, MCP/function-call hardening.',
    triggers: ['agentic ai', 'tool invocation', 'function calling security', 'mcp security'],
  },
  'testing-api-security-with-owasp-top-10': {
    description:
      'Test API security against OWASP API Top 10: BOLA, broken auth, excessive data exposure, SSRF, injection.',
    triggers: ['owasp api top 10', 'api pentest', 'api vulnerability test'],
  },
  'testing-for-system-prompt-leakage': {
    description:
      'Test for system-prompt leakage: extraction probes, delimiter attacks, indirect exfiltration of system instructions.',
    triggers: ['system prompt leak', 'prompt extraction', 'instruction leakage'],
  },
  'testing-prompt-injection-in-rag-pipelines': {
    description:
      'Test prompt injection in RAG pipelines: document poisoning, retrieval-time injection, chunk boundary attacks.',
    triggers: ['rag injection', 'rag security', 'document poisoning', 'retrieval attack'],
  },
  'testing-websocket-api-security': {
    description:
      'Test WebSocket API security: origin validation, auth handshake, message injection, DoS via connection abuse.',
    triggers: ['websocket security', 'ws api test', 'websocket pentest'],
  },
};

function parseExistingSkill(content: string): { frontmatter: string | null; body: string } {
  // CRLF-tolerant: accept both \n and \r\n line endings
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (match) {
    return { frontmatter: match[1], body: match[2].trim() };
  }
  return { frontmatter: null, body: content };
}

function extractTitleFromBody(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1] : null;
}

function generateFrontmatter(skillName: string, info: Partial<SkillInfo>): string {
  const triggers = info.triggers || [skillName.replace(/-/g, ' ')];
  return `---
name: ${skillName}
description: ${info.description || 'System skill for Gentle-Vanguard.'}
triggers:
${triggers.map((t) => `  - ${t}`).join('\n')}
---
`;
}

async function processSkill(skillDir: string): Promise<boolean> {
  const skillName = path.basename(skillDir);
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    console.log(`❌ ${skillName}: No SKILL.md found`);
    return false;
  }

  const content = fs.readFileSync(skillFile, 'utf-8');
  const { frontmatter: existingFrontmatter, body } = parseExistingSkill(content);

  // Check if already has proper frontmatter with triggers
  if (existingFrontmatter && content.match(/triggers:\s*\r?\n[\s\S]*-/)) {
    console.log(`✅ ${skillName}: Already has triggers in frontmatter`);
    return true;
  }

  // Get skill info from registry or extract from content
  const info = SKILL_REGISTRY[skillName] || {};
  if (!info.description) {
    const title = extractTitleFromBody(body);
    if (title) {
      info.description = title.replace(/^#\s+/, '').trim();
    }
  }
  if (!info.triggers) {
    info.triggers = [skillName.replace(/-/g, ' ')];
  }

  const newFrontmatter = generateFrontmatter(skillName, info);
  const newContent = `${newFrontmatter}\n${body}`;

  if (DRY_RUN) {
    console.log(`🔍 ${skillName}: Would update frontmatter`);
    return true;
  }

  fs.writeFileSync(skillFile, newContent, 'utf-8');
  console.log(`✅ ${skillName}: Updated with frontmatter`);
  return true;
}

async function main(): Promise<void> {
  console.log('=== Skill Frontmatter Sync ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
  console.log('');

  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`Skills directory not found: ${SKILLS_DIR}`);
    process.exit(1);
  }

  const skillDirs = fs
    .readdirSync(SKILLS_DIR)
    .map((name) => path.join(SKILLS_DIR, name))
    .filter((dir) => fs.statSync(dir).isDirectory());

  let updated = 0;
  let alreadyOk = 0;
  let failed = 0;

  for (const skillDir of skillDirs) {
    try {
      const result = await processSkill(skillDir);
      if (result) {
        if (
          fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8').match(/triggers:\s*\n[\s\S]*-/)
        ) {
          alreadyOk++;
        } else {
          updated++;
        }
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`❌ Error processing ${skillDir}:`, err);
      failed++;
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`Total skills: ${skillDirs.length}`);
  console.log(`Already OK: ${alreadyOk}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);

  if (DRY_RUN) {
    console.log('');
    console.log('Run without --dry-run to apply changes');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
