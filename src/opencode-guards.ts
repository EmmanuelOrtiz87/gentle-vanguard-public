import { existsSync, readFileSync } from 'fs';

export function normalizeSteps(steps: number): number {
  if (Number.isNaN(steps) || steps <= 0) return 1;
  return Math.min(Math.max(Math.ceil(steps), 1), 80);
}

export function validateOpencodeJsonSteps(json: unknown, path: string = 'opencode.json'): string[] {
  const errors: string[] = [];
  if (!json || typeof json !== 'object') {
    errors.push(`${path}: expected an object`);
    return errors;
  }

  const agentMap = (json as Record<string, unknown>).agent;
  if (!agentMap || typeof agentMap !== 'object') return errors;

  for (const [agent, config] of Object.entries(agentMap as Record<string, unknown>)) {
    if (!config || typeof config !== 'object') continue;
    const stepsValue = (config as Record<string, unknown>).steps;
    if (stepsValue === undefined) continue;
    if (typeof stepsValue !== 'number' || !Number.isInteger(stepsValue) || stepsValue <= 0) {
      errors.push(
        `${path}.agent.${agent}.steps must be a positive integer, got ${JSON.stringify(stepsValue)}`,
      );
    }
  }

  return errors;
}

function parseFrontmatter(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/m);
  return match ? match[1] : null;
}

export function validateAgentMdSteps(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [`${filePath}: file not found`];
  }

  const content = readFileSync(filePath, 'utf-8');
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return [];

  const match = frontmatter.match(/^steps:\s*([^\n#]+)/m);
  if (!match) return [];

  const stepsValue = match[1].trim();
  const numeric = Number(stepsValue);
  if (Number.isNaN(numeric)) {
    return [`${filePath}: steps is not a number (${stepsValue})`];
  }
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return [`${filePath}: steps must be a positive integer, got ${stepsValue}`];
  }

  return [];
}
