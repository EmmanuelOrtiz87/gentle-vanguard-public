import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(__dirname, '../../..');
const STATS_PATH = join(ROOT, '.atl', 'skill-stats.json');
const REGISTRY_PATH = join(ROOT, '.atl', 'skill-registry.md');

interface MCPMetrics {
  timestamp: string;
  server: {
    version: string;
    status: string;
    uptime: number;
  };
  skills: {
    total: number;
    byAgent: Record<string, number>;
    recentlyUsed: string[];
  };
  calls: {
    total: number;
    byTool: Record<string, number>;
    bySkill: Record<string, number>;
    lastCall: string | null;
  };
  performance: {
    avgResponseTime: number | null;
    errorRate: number | null;
  };
}

function loadStats() {
  try {
    const content = readFileSync(STATS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      totalCalls: 0,
      callsByTool: {},
      callsBySkill: {},
      lastCall: null,
    };
  }
}

function countSkillsByAgent(): Record<string, number> {
  try {
    const content = readFileSync(REGISTRY_PATH, 'utf-8');
    const lines = content.split('\n');
    const counts: Record<string, number> = {};

    for (const line of lines) {
      const match = line.match(/^\|\s*([^|]+)\|\s*([^|]+)\|/);
      if (match && match[1].trim() !== 'Agent') {
        const agent = match[1].trim();
        counts[agent] = (counts[agent] || 0) + 1;
      }
    }

    return counts;
  } catch {
    return {};
  }
}

export function getMCPMetrics(): MCPMetrics {
  const stats = loadStats();
  const byAgent = countSkillsByAgent();
  const totalSkills = Object.values(byAgent).reduce((a, b) => a + b, 0);

  // Calculate top skills by usage
  const topSkills = Object.entries(stats.callsBySkill || {})
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([name]) => name);

  return {
    timestamp: new Date().toISOString(),
    server: {
      version: '2.0.0',
      status: 'healthy',
      uptime: process.uptime(),
    },
    skills: {
      total: totalSkills,
      byAgent,
      recentlyUsed: topSkills,
    },
    calls: {
      total: stats.totalCalls || 0,
      byTool: stats.callsByTool || {},
      bySkill: stats.callsBySkill || {},
      lastCall: stats.lastCall,
    },
    performance: {
      // Do not manufacture operational metrics. These values are populated
      // only when the tracker has real samples; null means unavailable.
      avgResponseTime: typeof stats.avgResponseTime === 'number' ? stats.avgResponseTime : null,
      errorRate: typeof stats.errorRate === 'number' ? stats.errorRate : null,
    },
  };
}

// Express-compatible handler
export function metricsHandler(_req: any, res: any) {
  res.json(getMCPMetrics());
}

// For direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(getMCPMetrics(), null, 2));
}
