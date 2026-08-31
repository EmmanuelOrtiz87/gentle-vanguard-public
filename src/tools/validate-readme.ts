#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

type RepoOption = 'private' | 'public' | 'both';

interface CliArgs {
  repo: RepoOption;
  strict: boolean;
}

interface ActualStats {
  Skills: number;
  Workflows: number;
  Tests: number;
  Agents: number;
  KeywordMappings: number;
}

interface ReadmeResult {
  Errors: string[];
  Warnings: string[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { repo: 'both', strict: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' || args[i] === '-Repo') {
      const val = args[++i] || 'both';
      if (val === 'private' || val === 'public' || val === 'both') {
        result.repo = val;
      }
    } else if (args[i] === '--strict' || args[i] === '-Strict') {
      result.strict = true;
    }
  }
  return result;
}

function findRepoRoot(): string | null {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) {
    const envRoot = process.env.GENTLE_VANGUARD_BASE_DIR;
    if (fs.existsSync(path.join(envRoot, 'config', 'orchestrator.json'))) {
      return envRoot;
    }
  }
  let candidate = path.resolve(process.cwd());
  while (candidate) {
    if (fs.existsSync(path.join(candidate, 'config', 'orchestrator.json'))) {
      return candidate;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return null;
}

function testReadmeSection(
  content: string,
  sectionName: string,
  requiredPatterns: string[],
): string[] {
  const errors: string[] = [];
  for (const pattern of requiredPatterns) {
    if (!content.includes(pattern)) {
      errors.push(`Missing required pattern: ${pattern} in section '${sectionName}'`);
    }
  }
  return errors;
}

function getActualStats(root: string): ActualStats {
  let skills = 0;
  const skillsDir = path.join(root, 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      skills = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
    } catch {
      skills = 0;
    }
  }
  // Include .opencode/skills (absorbed/community skills) in the total
  const opencodeSkillsDir = path.join(root, '.opencode', 'skills');
  if (fs.existsSync(opencodeSkillsDir)) {
    try {
      skills += fs
        .readdirSync(opencodeSkillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
    } catch {
      /* ignore */
    }
  }

  let workflows = 0;
  const workflowsDir = path.join(root, '.github', 'workflows');
  if (fs.existsSync(workflowsDir)) {
    try {
      workflows = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml')).length;
    } catch {
      workflows = 0;
    }
  }

  let tests = 0;
  const testsDir = path.join(root, 'tests');
  if (fs.existsSync(testsDir)) {
    try {
      tests = walkFiles(testsDir, '.tests.ps1').length;
    } catch {
      tests = 0;
    }
  }

  let agentCount = 0;
  let keywordMappings = 0;
  // Prefer opencode.json agent registry (source of truth for agent count)
  const opencodePath = path.join(root, 'opencode.json');
  if (fs.existsSync(opencodePath)) {
    try {
      const oc = JSON.parse(fs.readFileSync(opencodePath, 'utf-8'));
      if (oc.agent && typeof oc.agent === 'object') {
        agentCount = Object.keys(oc.agent).length;
      }
    } catch {
      /* ignore */
    }
  }
  // Fallback: auto-delegation.json agentProfiles (+1 for orchestrator)
  if (agentCount === 0) {
    const delegPath = path.join(root, 'config', 'auto-delegation.json');
    if (fs.existsSync(delegPath)) {
      try {
        const deleg = JSON.parse(fs.readFileSync(delegPath, 'utf-8'));
        const routingProfiles = ['hallucinationGuardLevels', 'GITFLOW', 'SCRIPT'];
        if (deleg.agentProfiles) {
          agentCount =
            Object.keys(deleg.agentProfiles).filter((k) => !routingProfiles.includes(k)).length + 1;
        }
        if (deleg.keywordMappings) {
          keywordMappings = Object.keys(deleg.keywordMappings).length;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return {
    Skills: skills,
    Workflows: workflows,
    Tests: tests,
    Agents: agentCount,
    KeywordMappings: keywordMappings,
  };
}

function walkFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function testPrivateReadme(filePath: string, actualStats: ActualStats): ReadmeResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  const mandatorySections: Record<string, string[]> = {
    Header: [
      'Gentle-Vanguard',
      'img.shields.io/badge/Version',
      'img.shields.io/badge/Agents',
      'img.shields.io/badge/Skills',
    ],
    'What is Gentle-Vanguard': [
      'What is Gentle-Vanguard',
      'Routes work',
      'Enforces SDD',
      'Persists memory',
      '```mermaid',
    ],
    Architecture: ['Work Routing Ladder', 'Delegation Rules', '5-Layer Architecture', '```mermaid'],
    'Agent Ecosystem': [
      'Orchestrator',
      'BA',
      'SAD',
      'DEV',
      'QA',
      'OPS',
      'GOV',
      'DOC',
      'Model Profile',
    ],
    'Key Capabilities': [
      'SDD',
      'Review Workload Guard',
      'Skill Registry',
      'Chain-Delivery',
      'Cross-Tool',
    ],
    'Quick Start': ['git clone', 'session-autostart', 'gv verify'],
    Development: ['Invoke-Pester', 'gv verify', 'build'],
    'CI/CD Pipeline': ['gentle-vanguard-quality-gate', 'test-suite', 'sync-public'],
    'Project Status': ['Configuration', 'Skills', 'Tests', 'Hooks', 'Structure'],
    'Key Documentation': [
      'AGENTS.md',
      'Delegation Rules',
      'Model Routing',
      'SDD Config',
      'Skill Registry',
    ],
  };

  for (const [section, patterns] of Object.entries(mandatorySections)) {
    const sectionErrors = testReadmeSection(content, section, patterns);
    if (sectionErrors.length > 0) {
      allErrors.push(`SECTION '${section}': ${sectionErrors.join('; ')}`);
    }
  }

  const agentsMatch = content.match(/(\d+)\s+agents/);
  if (!agentsMatch) {
    allWarnings.push('Agent count not found in header');
  } else {
    const readmeAgents = parseInt(agentsMatch[1], 10);
    if (readmeAgents !== actualStats.Agents) {
      allErrors.push(
        `STATS: README says ${readmeAgents} agents, actual count is ${actualStats.Agents}`,
      );
    }
  }

  const skillsMatch = content.match(/(\d+)\s+skills/);
  if (skillsMatch) {
    const readmeSkills = parseInt(skillsMatch[1], 10);
    if (readmeSkills !== actualStats.Skills) {
      allErrors.push(
        `STATS: README says ${readmeSkills} skills, actual count is ${actualStats.Skills}`,
      );
    }
  }

  const wfMatch = content.match(/(\d+)\s+Workflows/);
  if (wfMatch) {
    const readmeWf = parseInt(wfMatch[1], 10);
    if (readmeWf !== actualStats.Workflows) {
      allErrors.push(
        `STATS: README says ${readmeWf} workflows, actual count is ${actualStats.Workflows}`,
      );
    }
  }

  const changelogPath = path.join(path.dirname(filePath), 'CHANGELOG.md');
  if (fs.existsSync(changelogPath)) {
    try {
      const changelogLines = fs.readFileSync(changelogPath, 'utf-8').split('\n').slice(0, 15);
      const versionMatch = changelogLines.join('\n').match(/\[(\d+\.\d+\.\d+)\]/);
      const badgeMatch = content.match(/badge\/Version-([0-9.]+)/);
      if (versionMatch && badgeMatch && badgeMatch[1] !== versionMatch[1]) {
        allErrors.push(`VERSION: Badge says ${badgeMatch[1]}, CHANGELOG says ${versionMatch[1]}`);
      }
    } catch {
      /* ignore */
    }
  }

  const mermaidMatches = content.match(/```mermaid/g);
  const mermaidCount = mermaidMatches ? mermaidMatches.length : 0;
  if (mermaidCount < 3) {
    allErrors.push(`MERMAID: Expected at least 3 Mermaid diagrams, found ${mermaidCount}`);
  }

  const lineCount = content.split('\n').length;
  if (lineCount < 150) {
    allErrors.push(`LENGTH: README has ${lineCount} lines, minimum is 150 (governance policy)`);
  }

  return { Errors: allErrors, Warnings: allWarnings };
}

function testPublicReadme(filePath: string, actualStats: ActualStats): ReadmeResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  const mandatorySections: Record<string, string[]> = {
    Header: [
      'Gentle-Vanguard',
      'img.shields.io/badge/Version',
      'img.shields.io/badge/Agents',
      'img.shields.io/badge/Skills',
    ],
    'What It Solves': ['What It Solves', 'Engram', 'SDD', 'judgment-day'],
    Architecture: ['```mermaid', '5-Layer Architecture'],
    'Agent Ecosystem': ['Orchestrator', 'BA', 'SAD', 'DEV', 'QA', 'Model Profile'],
    'Key Features': [
      'Specialized Agents',
      'On-Demand Skills',
      'Persistent Engram Memory',
      'Cost-Aware Model Router',
    ],
    'Skill Catalog': ['Frontend', 'Backend', 'DevOps', 'Security', 'Testing'],
    'Quick Install': ['git clone', 'bootstrap.ps1'],
    Requirements: ['PowerShell', 'Git'],
    'CI/CD Pipeline': ['gentle-vanguard-quality-gate', 'test-suite', 'sync-public'],
    'Defensive Patterns': ['repoRoot', 'UTF-8', 'ErrorActionPreference'],
    Security: ['AES-256', 'SECURITY.md'],
    Documentation: ['Getting Started', 'Architecture', 'INSTALLATION'],
  };

  for (const [section, patterns] of Object.entries(mandatorySections)) {
    const sectionErrors = testReadmeSection(content, section, patterns);
    if (sectionErrors.length > 0) {
      allErrors.push(`SECTION '${section}': ${sectionErrors.join('; ')}`);
    }
  }

  const agentsMatch = content.match(/(\d+)\s+agents/);
  if (agentsMatch) {
    const readmeAgents = parseInt(agentsMatch[1], 10);
    if (readmeAgents !== actualStats.Agents) {
      allErrors.push(
        `STATS: README says ${readmeAgents} agents, actual count is ${actualStats.Agents}`,
      );
    }
  }

  const skillsMatch = content.match(/(\d+)\s+skills/);
  if (skillsMatch) {
    const readmeSkills = parseInt(skillsMatch[1], 10);
    if (readmeSkills !== actualStats.Skills) {
      allErrors.push(
        `STATS: README says ${readmeSkills} skills, actual count is ${actualStats.Skills}`,
      );
    }
  }

  const mermaidMatches = content.match(/```mermaid/g);
  const mermaidCount = mermaidMatches ? mermaidMatches.length : 0;
  if (mermaidCount < 1) {
    allErrors.push(`MERMAID: Expected at least 1 Mermaid diagram, found ${mermaidCount}`);
  }

  const lineCount = content.split('\n').length;
  if (lineCount < 120) {
    allErrors.push(`LENGTH: README has ${lineCount} lines, minimum is 120 (governance policy)`);
  }

  return { Errors: allErrors, Warnings: allWarnings };
}

function main(): void {
  const { repo, strict } = parseArgs();
  const repoRoot = findRepoRoot();

  if (!repoRoot) {
    console.error(
      '[ERROR] Cannot determine repo root. Set GENTLE_VANGUARD_BASE_DIR or run from repo directory.',
    );
    process.exit(1);
  }

  let exitCode = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log(`\n=== README Governance Validation ===`);
  console.log(`Repo: ${repo} | Strict: ${strict}\n`);

  const actualStats = getActualStats(repoRoot);
  console.log('Actual project stats:');
  console.log(`  Agents: ${actualStats.Agents}`);
  console.log(`  Skills: ${actualStats.Skills}`);
  console.log(`  Workflows: ${actualStats.Workflows}`);
  console.log(`  Tests: ${actualStats.Tests}\n`);

  if (repo === 'private' || repo === 'both') {
    const privateReadme = path.join(repoRoot, 'README.md');
    if (fs.existsSync(privateReadme)) {
      console.log('--- Private README (gentle-vanguard) ---');
      const result = testPrivateReadme(privateReadme, actualStats);
      if (result.Errors.length > 0) {
        for (const e of result.Errors) {
          console.log(`  [ERROR] ${e}`);
        }
        errors.push(...result.Errors);
      }
      if (result.Warnings.length > 0) {
        for (const w of result.Warnings) {
          console.log(`  [WARN]  ${w}`);
        }
        warnings.push(...result.Warnings);
      }
      if (result.Errors.length === 0 && result.Warnings.length === 0) {
        console.log('  [PASS] All checks passed');
      }
    } else {
      console.log(`  [ERROR] Private README not found at ${privateReadme}`);
      errors.push('Private README not found');
    }
    console.log('');
  }

  if (repo === 'public' || repo === 'both') {
    let publicRoot = path.join(path.dirname(repoRoot), 'gentle-vanguard-public');
    if (!fs.existsSync(publicRoot)) {
      publicRoot = path.join(repoRoot, '..', 'gentle-vanguard-public');
    }
    if (!fs.existsSync(publicRoot)) {
      publicRoot = process.env.GENTLE_VANGUARD_PUBLIC_ROOT
        ? process.env.GENTLE_VANGUARD_PUBLIC_ROOT
        : path.join(path.dirname(repoRoot), 'gentle-vanguard-public');
    }
    const publicReadme = path.join(publicRoot, 'README.md');
    if (fs.existsSync(publicReadme)) {
      console.log('--- Public README (gentle-vanguard-public) ---');
      const result = testPublicReadme(publicReadme, actualStats);
      if (result.Errors.length > 0) {
        for (const e of result.Errors) {
          console.log(`  [ERROR] ${e}`);
        }
        errors.push(...result.Errors);
      }
      if (result.Warnings.length > 0) {
        for (const w of result.Warnings) {
          console.log(`  [WARN]  ${w}`);
        }
        warnings.push(...result.Warnings);
      }
      if (result.Errors.length === 0 && result.Warnings.length === 0) {
        console.log('  [PASS] All checks passed');
      }
    } else {
      console.log(`  [ERROR] Public README not found at ${publicReadme}`);
      errors.push('Public README not found');
    }
    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`  Errors:   ${errors.length}`);
  console.log(`  Warnings: ${warnings.length}`);

  if (errors.length > 0) {
    console.log('\n  FAIL — Fix errors before committing README changes');
    exitCode = 1;
  } else if (strict && warnings.length > 0) {
    console.log('\n  FAIL (strict mode) — Fix warnings before committing');
    exitCode = 1;
  } else {
    console.log('\n  PASS — README governance validation successful');
  }

  process.exit(exitCode);
}

main();
