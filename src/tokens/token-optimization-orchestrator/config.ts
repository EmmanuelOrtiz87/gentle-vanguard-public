import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { OrchestratorConfig } from './types.js';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'orchestrator.json');
const METRICS_PATH = join(ROOT, '.runtime', 'token-optimization-metrics.json');
const STATS_PATH = join(ROOT, '.runtime', 'token-optimization-stats.json');

let _config: OrchestratorConfig | null = null;

export function getConfig(): OrchestratorConfig {
  if (_config) return _config;

  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      const compression = raw?.compression ?? {};
      const chat = raw?.chat_response ?? {};
      const cache = raw?.caching ?? { enabled: true };

      _config = {
        enabled: compression?.enabled ?? true,
        mode: 'optimize',
        defaultChatLevel: chat?.default_level ?? 'chat-compact',
        cacheEnabled: cache?.enabled ?? true,
        cacheTtlMinutes: cache?.ttlMinutes ?? 60,
        preProcessCompression: true,
        postProcessCompression: true,
        tokenBudgetAware: true,
        metricsEnabled: true,
        metricsStoragePath: '.runtime/token-optimization-metrics.json',
        reportInterval: 100,
      };
      return _config;
    }
  } catch {
    /* ignore */
  }

  _config = {
    enabled: true,
    mode: 'optimize',
    defaultChatLevel: 'chat-compact',
    cacheEnabled: true,
    cacheTtlMinutes: 60,
    preProcessCompression: true,
    postProcessCompression: true,
    tokenBudgetAware: true,
    metricsEnabled: true,
    metricsStoragePath: '.runtime/token-optimization-metrics.json',
    reportInterval: 100,
  };
  return _config;
}

export { ROOT, CONFIG_PATH, METRICS_PATH, STATS_PATH };
