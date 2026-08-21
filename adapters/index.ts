import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

function parseSkillMarkdown(content: string): {
  name: string;
  description: string;
  triggers: string[];
  content: string;
} {
  const result = { name: '', description: '', triggers: [] as string[], content: '' };
  const startMarker = content.indexOf('---');
  if (startMarker >= 0) {
    const secondMarker = content.indexOf('---', startMarker + 3);
    if (secondMarker >= 0) {
      const frontMatter = content.substring(startMarker + 3, secondMarker);
      for (const line of frontMatter.split('\n')) {
        if (line.startsWith('name:')) result.name = line.substring(5).trim();
        else if (line.startsWith('description:')) result.description = line.substring(12).trim();
        else if (line.startsWith('trigger:'))
          result.triggers = line
            .substring(8)
            .trim()
            .split(',')
            .map((t) => t.trim().replace(/"/g, ''));
      }
      result.content = content.substring(secondMarker + 3).trim();
    }
  }
  return result;
}

// Antigravity adapter
function convertToAntigravity(skillPath: string, outputPath: string): void {
  const parsed = parseSkillMarkdown(readFileSync(skillPath, 'utf-8'));
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        name: parsed.name,
        version: '1.0.0',
        description: parsed.description,
        triggers: parsed.triggers,
        mission: {
          name: `${parsed.name} Mission`,
          max_agents: 1,
          timeout: 3600,
          agents: [
            {
              role: 'generalist',
              model: 'gemini-3-pro',
              instructions: parsed.content,
              tools: ['file_reader', 'code_executor'],
            },
          ],
        },
      },
      null,
      2,
    ),
  );
}

// Codex adapter
function convertToCodex(skillPath: string, outputPath: string): void {
  const parsed = parseSkillMarkdown(readFileSync(skillPath, 'utf-8'));
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        type: 'function',
        function: {
          name: parsed.name.replace(/-/g, '_'),
          description: parsed.description || `Skill: ${parsed.name}`,
          parameters: {
            type: 'object',
            properties: { task: { type: 'string', description: 'Task to execute' } },
            required: ['task'],
            additionalProperties: false,
          },
        },
      },
      null,
      2,
    ),
  );
}

// Windsurf adapter
function convertToWindsurf(skillPath: string, outputDir: string): void {
  const parsed = parseSkillMarkdown(readFileSync(skillPath, 'utf-8'));
  const pluginDir = join(outputDir, parsed.name);
  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify(
      {
        name: parsed.name,
        version: '1.0.0',
        description: parsed.description,
        triggers: parsed.triggers,
        author: 'Gentle-Vanguard',
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(pluginDir, 'instructions.md'),
    `# ${parsed.name}\n\n> Gentle-Vanguard Skill\n\n## Description\n${parsed.description}\n\n## Triggers\n${parsed.triggers.map((t) => `- ${t}`).join('\n')}\n\n## Instructions\n${parsed.content}\n`,
  );
}

// ─── Unified CLI ───────────────────────────────────────────────────────
// The CLI only runs when this module is executed directly (node adapters/index.ts).
// Importing the module as a library (e.g. loadAdapters) has NO side effects.

export { convertToAntigravity, convertToCodex, convertToWindsurf };

function isMainModule(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const entryUrl = pathToFileURL(entry).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const cmd = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  switch (cmd) {
    case 'antigravity':
      convertToAntigravity(arg1 || 'SKILL.md', arg2 || 'output.json');
      break;
    case 'codex':
      convertToCodex(arg1 || 'SKILL.md', arg2 || 'output.json');
      break;
    case 'windsurf':
      convertToWindsurf(arg1 || 'SKILL.md', arg2 || '.windsurf/plugins');
      break;
    default:
      console.log(`Adapters: antigravity | codex | windsurf
  node adapters/index.ts antigravity <skill.md> <output.json>
  node adapters/index.ts codex <skill.md> <output.json>
  node adapters/index.ts windsurf <skill.md> <output-dir>`);
  }
}

// Dynamically load adapter instances if present. Returns null for adapters that aren't available.
export async function loadAdapters(): Promise<{
  codexAdapter: any | null;
  windsurfAdapter: any | null;
  antigravityAdapter: any | null;
}> {
  // Use dynamic imports so the module can be used in environments that don't have the adapters built.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const codexAdapter = await import('./format-adapters/codex-adapter/CodexAdapter.js')
    .then((m) => m.default)
    .catch(() => null);
  // @ts-ignore
  const windsurfAdapter = await import('./format-adapters/windsurf-adapter/WindsurfAdapter.js')
    .then((m) => m.default)
    .catch(() => null);
  // @ts-ignore
  const antigravityAdapter =
    await import('./format-adapters/antigravity-adapter/AntigravityAdapter.js')
      .then((m) => m.default)
      .catch(() => null);

  return { codexAdapter, windsurfAdapter, antigravityAdapter };
}
