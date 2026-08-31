#!/usr/bin/env node
/**
 * Token Optimization Orchestrator — Central token optimization coordinator
 *
 * Coordinates all token optimization systems:
 * - Input compression (prompt-compression.ts)
 * - Output compression (output-compression.ts)
 * - Chat level enforcement (chat-level-enforcer.ts)
 * - Response caching (response-cache.ts)
 * - Token budget guard (token-budget-guard.ts)
 *
 * Pipeline: Pre-process → Process → Post-process
 * Metrics collection and reporting
 *
 * Usage:
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize --input "..."
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --mode pipeline --file input.txt
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --metrics
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --status
 */

import { pathToFileURL } from 'url';
import { main } from './token-optimization-orchestrator/cli.js';

export * from './token-optimization-orchestrator/types.js';
export * from './token-optimization-orchestrator/config.js';
export * from './token-optimization-orchestrator/pipeline.js';
export * from './token-optimization-orchestrator/optimize.js';
export * from './token-optimization-orchestrator/metrics.js';
export * from './token-optimization-orchestrator/cli.js';

// ─── Run CLI if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
