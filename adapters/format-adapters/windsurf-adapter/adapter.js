/**
 * Windsurf Adapter
 * Converts Gentle-Vanguard skills to Windsurf plugin format
 *
 * Windsurf uses a plugin system with:
 * - Plugin manifest (plugin.json)
 * - Instruction files (for AI context)
 * - Trigger patterns for activation
 */

const fs = require('fs');
const path = require('path');

/**
 * Convert Gentle-Vanguard SKILL.md to Windsurf plugin format
 */
function convertSkillToWindsurf(skillPath, outputDir) {
  const skillContent = fs.readFileSync(skillPath, 'utf-8');
  const parsed = parseSkillMarkdown(skillContent);

  // Create plugin structure
  const pluginDir = path.join(outputDir, parsed.name);
  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
  }

  // Generate plugin.json (Windsurf manifest)
  const pluginManifest = {
    name: parsed.name,
    version: '1.0.0',
    description: parsed.description || `Gentle-Vanguard skill: ${parsed.name}`,
    triggers: parsed.triggers || [],
    author: 'Gentle-Vanguard',
    'gentle-vanguard': true,
  };

  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginManifest, null, 2));

  // Generate instructions.md (Windsurf reads this for context)
  const instructions = generateWindsurfInstructions(parsed);
  fs.writeFileSync(path.join(pluginDir, 'instructions.md'), instructions);

  console.log(`✓ Converted ${parsed.name} to Windsurf format: ${pluginDir}`);
  return pluginDir;
}

/**
 * Parse Gentle-Vanguard SKILL.md format
 */
function parseSkillMarkdown(content) {
  const result = {
    name: '',
    description: '',
    triggers: [],
    content: '',
  };

  const startMarker = content.indexOf('---');
  if (startMarker >= 0) {
    const secondMarker = content.indexOf('---', startMarker + 3);
    if (secondMarker >= 0) {
      const frontMatter = content.substring(startMarker + 3, secondMarker);
      const restContent = content.substring(secondMarker + 3);

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
 * Generate Windsurf-compatible instructions
 */
function generateWindsurfInstructions(parsed) {
  let instructions = `# ${parsed.name}\n\n`;
  instructions += `> Gentle-Vanguard Skill (converted for Windsurf)\n\n`;
  instructions += `## Description\n${parsed.description}\n\n`;
  instructions += `## Triggers\n`;
  parsed.triggers.forEach((t) => {
    instructions += `- ${t}\n`;
  });
  instructions += `\n## Instructions\n${parsed.content}\n`;
  return instructions;
}

/**
 * Generate windsurf.json config for project
 */
function generateWindsurfConfig(skillsDir, outputPath) {
  const files = fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith('SKILL.md'))
    .map((f) => path.join(skillsDir, f));

  const plugins = files.map((file) => {
    const parsed = parseSkillMarkdown(fs.readFileSync(file, 'utf-8'));
    return {
      name: parsed.name,
      path: `./.windsurf/plugins/${parsed.name}`,
      enabled: true,
    };
  });

  const config = {
    plugins: plugins,
    settings: {
      'enableGentle-VanguardSkills': true,
      autoLoad: true,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`✓ Generated windsurf.json: ${outputPath}`);
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'convert-skill') {
    const skillPath = args[1] || 'SKILL.md';
    const outputDir = args[2] || '.windsurf/plugins';
    convertSkillToWindsurf(skillPath, outputDir);
  } else if (command === 'generate-config') {
    const skillsDir = args[1] || 'skills/';
    const outputPath = args[2] || '.windsurf/windsurf.json';
    generateWindsurfConfig(skillsDir, outputPath);
  } else {
    console.log(`
Windsurf Adapter

Usage:
  node adapter.js convert-skill [skill-path] [output-dir]
  node adapter.js generate-config [skills-dir] [output-path]

Examples:
  node adapter.js convert-skill skills/react-19-skill/SKILL.md .windsurf/plugins
  node adapter.js generate-config skills/ .windsurf/windsurf.json
    `);
  }
}

module.exports = {
  convertSkillToWindsurf,
  generateWindsurfConfig,
};
