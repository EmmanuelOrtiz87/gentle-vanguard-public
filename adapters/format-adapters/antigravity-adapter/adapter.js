/**
 * Antigravity Mission Control Adapter
 * Converts Gentle-Vanguard skills to Antigravity Mission Control format
 *
 * Antigravity uses:
 * - Mission Control: Multi-agent orchestration dashboard
 * - AGENTS.md: Agent configuration file (cross-tool compatible)
 * - AgentKit 2.0: Framework for building agents
 * - Mission YAML: Multi-agent task definitions
 */

const fs = require('fs');
const path = require('path');

/**
 * Convert Gentle-Vanguard SKILL.md to Antigravity Mission Control format
 * @param {string} skillPath - Path to SKILL.md
 * @param {string} outputPath - Output path for converted file
 */
function convertSkillToAntigravity(skillPath, outputPath) {
  const skillContent = fs.readFileSync(skillPath, 'utf-8');

  // Parse Gentle-Vanguard SKILL.md format (frontmatter + content)
  const parsed = parseSkillMarkdown(skillContent);

  // Convert to Antigravity format (Mission Control compatible)
  const antigravityFormat = {
    name: parsed.name,
    version: '1.0.0',
    description: parsed.description || '',
    triggers: parsed.triggers || [],
    mission: {
      name: `${parsed.name} Mission`,
      max_agents: 1,
      timeout: 3600,
      agents: [
        {
          role: mapSkillToAgentRole(parsed.name),
          model: 'gemini-3-pro',
          instructions: parsed.content,
          tools: parsed.tools || ['file_reader', 'code_executor'],
        },
      ],
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(antigravityFormat, null, 2));
  console.log(`✓ Converted ${parsed.name} to Antigravity format: ${outputPath}`);
}

/**
 * Parse Gentle-Vanguard SKILL.md markdown format
 */
function parseSkillMarkdown(content) {
  const result = {
    name: '',
    description: '',
    triggers: [],
    tools: [],
    content: '',
  };

  // Extract frontmatter (between --- markers)
  const startMarker = content.indexOf('---');
  if (startMarker >= 0) {
    const secondMarker = content.indexOf('---', startMarker + 3);
    if (secondMarker >= 0) {
      const frontMatter = content.substring(startMarker + 3, secondMarker);
      const restContent = content.substring(secondMarker + 3);

      // Parse frontmatter lines
      const lines = frontMatter.split('\n');
      for (const line of lines) {
        if (line.startsWith('name:')) {
          result.name = line.substring(5).trim();
        } else if (line.startsWith('description:')) {
          result.description = line.substring(12).trim();
        } else if (line.startsWith('trigger:')) {
          const triggerText = line.substring(8).trim();
          result.triggers = triggerText.split(',').map((t) => t.trim().replace(/"/g, ''));
        }
      }

      result.content = restContent.trim();
    }
  }

  return result;
}

/**
 * Map Gentle-Vanguard skill names to Antigravity agent roles
 */
function mapSkillToAgentRole(skillName) {
  const roleMap = {
    'react-19-skill': 'frontend',
    'angular-spa-skill': 'frontend',
    'go-api': 'backend',
    'django-drf-skill': 'backend',
    'docker-devops-skill': 'devops',
    'testing-skill': 'tester',
    'security-skill': 'security',
    'documentation-governance': 'writer',
  };

  return roleMap[skillName] || 'generalist';
}

/**
 * Generate AGENTS.md from Gentle-Vanguard skills
 * AGENTS.md is cross-tool compatible (Antigravity, Cursor, Claude Code)
 */
function generateAGENTSmd(skillsDir, outputPath) {
  const files = fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith('SKILL.md'))
    .map((f) => path.join(skillsDir, f));

  let agentsMd = '# Agents Configuration\n\n';
  agentsMd += '> Cross-tool compatible: Antigravity, Cursor, Claude Code\n\n';

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const parsed = parseSkillMarkdown(content);

    agentsMd += `## ${parsed.name}\n`;
    agentsMd += `Role: ${mapSkillToAgentRole(parsed.name)}\n`;
    agentsMd += `Description: ${parsed.description}\n`;
    agentsMd += `Triggers: ${parsed.triggers.join(', ')}\n\n`;
  }

  fs.writeFileSync(outputPath, agentsMd);
  console.log(`✓ Generated AGENTS.md: ${outputPath}`);
}

/**
 * Generate mission.yaml for multi-agent workflows
 */
function generateMissionYaml(skills, outputPath) {
  const mission = {
    mission: {
      name: 'Gentle-Vanguard Multi-Agent Mission',
      max_agents: 5,
      timeout: 7200,
    },
    agents: skills.map((skill) => ({
      role: mapSkillToAgentRole(skill.name),
      model: 'gemini-3-pro',
      instructions: skill.instructions || `Execute ${skill.name} tasks`,
      depends_on: skill.dependsOn || [],
    })),
  };

  const yaml = JSON.stringify(mission, null, 2)
    .replace(/"/g, '')
    .replace(/: "(.+?)"/g, ': $1');

  fs.writeFileSync(outputPath, yaml);
  console.log(`✓ Generated mission.yaml: ${outputPath}`);
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'convert-skill') {
    const skillPath = args[1] || 'SKILL.md';
    const outputPath = args[2] || 'output.json';
    convertSkillToAntigravity(skillPath, outputPath);
  } else if (command === 'generate-agents-md') {
    const skillsDir = args[1] || 'skills/';
    const outputPath = args[2] || 'AGENTS.md';
    generateAGENTSmd(skillsDir, outputPath);
  } else if (command === 'generate-mission') {
    const skillsJson = args[1] || '[]';
    const outputPath = args[2] || 'mission.yaml';
    const skills = JSON.parse(skillsJson);
    generateMissionYaml(skills, outputPath);
  } else {
    console.log(`
Antigravity Mission Control Adapter

Usage:
  node adapter.js convert-skill [skill-path] [output-path]
  node adapter.js generate-agents-md [skills-dir] [output-path]
  node adapter.js generate-mission [skills-json] [output-path]

Examples:
  node adapter.js convert-skill skills/react-19-skill/SKILL.md output/react-19.json
  node adapter.js generate-agents-md skills/ AGENTS.md
  node adapter.js generate-mission '[{"name":"dev","instructions":"Implement code"}]' mission.yaml
    `);
  }
}

module.exports = {
  convertSkillToAntigravity,
  generateAGENTSmd,
  generateMissionYaml,
};
