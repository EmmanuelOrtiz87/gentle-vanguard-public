import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT = resolve(__dirname, '../../..');

const rootPackage = readJson<{ version?: string }>(resolve(ROOT, 'package.json'));
const dashboardPackage = readJson<{ version?: string }>(
  resolve(ROOT, 'apps/web-dashboard/package.json'),
);
export const STACK_VERSION = dashboardPackage?.version || rootPackage?.version || 'unknown';

export function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.warn(`[shared] Failed to read ${path}:`, (e as Error).message);
    return null;
  }
}

export interface SkillCount {
  total: number;
  byAgent: Record<string, number>;
}

export function countSkills(registryPath: string): SkillCount {
  try {
    if (!existsSync(registryPath)) return { total: 0, byAgent: {} };
    const content = readFileSync(registryPath, 'utf-8');
    const lines = content.split('\n');
    let total = 0;
    const byAgent: Record<string, number> = {};
    for (const line of lines) {
      const match = line.match(/^\|\s*([^|]+)\|\s*([^|]+)\|/);
      if (!match) continue;
      const agent = match[1].trim();
      if (agent === 'Agent' || agent.startsWith('---')) continue;
      byAgent[agent] = (byAgent[agent] || 0) + 1;
      total++;
    }
    return { total, byAgent };
  } catch (e) {
    console.warn('[shared] Failed to count skills:', (e as Error).message);
    return { total: 0, byAgent: {} };
  }
}
