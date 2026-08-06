/**
 * Codex Adapter
 * Converts Gentle-Vanguard tools/skills to OpenAI function calling format
 *
 * Codex (OpenAI) uses:
 * - Function calling format (JSON Schema)
 * - Chat completions API
 * - Tool definitions with strict schemas
 */

const fs = require('fs');
const path = require('path');

/**
 * Convert Gentle-Vanguard SKILL.md to OpenAI function format
 */
function convertSkillToCodex(skillPath, outputPath) {
  const skillContent = fs.readFileSync(skillPath, 'utf-8');
  const parsed = parseSkillMarkdown(skillContent);

  // Convert to OpenAI function calling format
  const codexFunction = {
    type: 'function',
    function: {
      name: parsed.name.replace(/-/g, '_'),
      description: parsed.description || `Gentle-Vanguard skill: ${parsed.name}`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task to execute using this skill',
          },
          context: {
            type: 'string',
            description: 'Additional context for the skill execution',
          },
        },
        required: ['task'],
        additionalProperties: false,
      },
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(codexFunction, null, 2));
  console.log(`✓ Converted ${parsed.name} to Codex format: ${outputPath}`);
  return codexFunction;
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
 * Generate OpenAI-compatible tools array
 */
function generateToolsArray(skillsDir, outputPath) {
  const files = fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith('SKILL.md'))
    .map((f) => path.join(skillsDir, f));

  const tools = files.map((file) => {
    const parsed = parseSkillMarkdown(fs.readFileSync(file, 'utf-8'));
    return {
      type: 'function',
      function: {
        name: parsed.name.replace(/-/g, '_'),
        description: parsed.description,
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task to execute' },
          },
          required: ['task'],
          additionalProperties: false,
        },
      },
    };
  });

  const output = { tools };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`✓ Generated tools array: ${outputPath}`);
  return output;
}

/**
 * Generate proxy server for Codex
 */
function generateProxyServer(outputPath) {
  const serverCode = `const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Load all Gentle-Vanguard tools
const toolsPath = path.join(__dirname, 'tools.json');
const toolsData = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));

app.get('/v1/tools', (req, res) => {
  res.json(toolsData.tools);
});

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, tools } = req.body;
  
  // Forward to Gentle-Vanguard (simplified - actual implementation would call Gentle-Vanguard)
  const lastMessage = messages[messages.length - 1].content;
  
  res.json({
    choices: [{
      message: {
        role: 'assistant',
        content: \`Gentle-Vanguard processing: \${lastMessage}\`
      }
    }]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Codex proxy running on port \${PORT}\`);
});
`;

  fs.writeFileSync(outputPath, serverCode);
  console.log(`✓ Generated proxy server: ${outputPath}`);
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'convert-skill') {
    const skillPath = args[1] || 'SKILL.md';
    const outputPath = args[2] || 'output.json';
    convertSkillToCodex(skillPath, outputPath);
  } else if (command === 'generate-tools') {
    const skillsDir = args[1] || 'skills/';
    const outputPath = args[2] || 'tools.json';
    generateToolsArray(skillsDir, outputPath);
  } else if (command === 'generate-proxy') {
    const outputPath = args[1] || 'proxy.js';
    generateProxyServer(outputPath);
  } else {
    console.log(`
Codex Adapter

Usage:
  node adapter.js convert-skill [skill-path] [output-path]
  node adapter.js generate-tools [skills-dir] [output-path]
  node adapter.js generate-proxy [output-path]

Examples:
  node adapter.js convert-skill skills/react-19-skill/SKILL.md react-19.json
  node adapter.js generate-tools skills/ tools.json
  node adapter.js generate-proxy proxy.js
    `);
  }
}

module.exports = {
  convertSkillToCodex,
  generateToolsArray,
  generateProxyServer,
};
