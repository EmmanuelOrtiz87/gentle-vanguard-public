import { existsSync, readFileSync, writeFileSync } from 'fs';
import { METRICS_PATH, STATS_PATH } from './config.js';
import { loadStats, generateReport } from './metrics.js';
import { checkCache, optimizePrompt, optimizeResponse } from './optimize.js';
import { runPipeline } from './pipeline.js';
import type { PipelineInput, PipelineResult } from './types.js';
import type { ChatLevel } from '../../orchestration/chat-level-enforcer.js';

export function printUsage(): void {
  console.log(`
Token Optimization Orchestrator

Usage:
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode pipeline --input "prompt text"
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-prompt --input "..." [--skill name]
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-response --input "..." [--level chat-compact]
  npx tsx src/tokens/token-optimization-orchestrator.ts --cache-check --input "prompt"
  npx tsx src/tokens/token-optimization-orchestrator.ts --stats
  npx tsx src/tokens/token-optimization-orchestrator.ts --report

Modes:
  pipeline         - Run full optimization pipeline
  optimize-prompt  - Compress input prompt only
  optimize-response - Compress output response only
  check            - Check token budget status

Options:
  --input TEXT          Input text
  --file PATH           Read input from file
  --skill NAME          Skill for prompt compression
  --level NAME          Chat level (chat-compact|chat-balanced|chat-detailed)
  --profile NAME        Compression profile (ultra|lleno|lite|simple)
  --context TEXT        Context for cache key
  --ttl MINUTES         Cache TTL in minutes
  --skip-cache          Skip cache check/store
  --skip-pre-process    Skip prompt compression
  --skip-post-process   Skip response compression
  --json                Output as JSON
  --quiet               Suppress extra output
  --stats               Show statistics
  --report              Generate optimization report
  --clear-metrics       Clear all stored metrics

Examples:
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-prompt --input "Long prompt..."
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-response --input "Long response..." --level chat-compact
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode pipeline --input "Create a function..." --skill typescript

Note:
  The "process" stage of --mode pipeline uses a SIMULATED LLM response.
  This mode benchmarks the compression pipeline and measures token savings
  WITHOUT making real LLM calls. For real LLM calls use the LLM Call Wrapper:
    npx tsx src/ml/llm-call-wrapper.ts --prompt "..." [--model "..."]
`);
}

export function formatPipelineResult(result: PipelineResult): string {
  const lines: string[] = [
    '',
    '╔═══════════════════════════════════════════════════╗',
    '║     Token Optimization Orchestrator Result        ║',
    '╚═══════════════════════════════════════════════════╝',
    '',
    `  Duration:      ${result.durationMs}ms`,
    `  From Cache:    ${result.output.fromCache ? 'Yes ✓' : 'No'}`,
    '',
    '  ── Stages ──────────────────────────────────────',
    '',
  ];

  for (const stage of result.stages) {
    const status = stage.success ? '✓' : '✗';
    const savings = stage.savings > 0 ? `(-${stage.savings} tokens)` : '';
    lines.push(`    ${status} ${stage.stage.padEnd(15)} ${stage.durationMs}ms  ${savings}`);
  }

  lines.push(
    '',
    '  ── Metrics ─────────────────────────────────────',
    '',
    `    Total Input:           ~${result.metrics.totalTokensIn} tokens`,
    `    Total Output:          ~${result.metrics.totalTokensOut} tokens`,
    `    Total Savings:         ${result.metrics.totalSavings} tokens`,
    `    Reduction:             ${result.metrics.totalReduction.toFixed(1)}%`,
    `    Cache Hit:             ${result.metrics.cacheHit ? 'Yes' : 'No'}`,
  );

  if (result.metrics.cacheHit) {
    lines.push(`    Cache Tokens Saved:    ${result.metrics.cacheTokensSaved}`);
  }

  lines.push(
    '',
    '  ── Output ───────────────────────────────────────',
    '',
    result.output.response.slice(0, 500),
  );

  if (result.output.response.length > 500) {
    lines.push('...');
  }

  lines.push('');
  return lines.join('\n');
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const inputIdx = args.indexOf('--input');
  const fileIdx = args.indexOf('--file');
  const skillIdx = args.indexOf('--skill');
  const levelIdx = args.indexOf('--level');
  const profileIdx = args.indexOf('--profile');
  const contextIdx = args.indexOf('--context');
  const ttlIdx = args.indexOf('--ttl');
  const cacheCheckFlag = args.includes('--cache-check');
  const statsFlag = args.includes('--stats');
  const reportFlag = args.includes('--report');
  const skipCacheFlag = args.includes('--skip-cache');
  const quietFlag = args.includes('--quiet');
  const jsonFlag = args.includes('--json');
  const clearMetricsFlag = args.includes('--clear-metrics');

  if (clearMetricsFlag) {
    try {
      if (existsSync(METRICS_PATH)) {
        writeFileSync(METRICS_PATH, '[]');
        console.log('[OK] Metrics cleared');
      }
      if (existsSync(STATS_PATH)) {
        writeFileSync(
          STATS_PATH,
          JSON.stringify(
            {
              totalRuns: 0,
              successfulRuns: 0,
              failedRuns: 0,
              cacheHits: 0,
              cacheMisses: 0,
              cacheHitRate: 0,
              totalTokenSavings: 0,
              avgSavingsPct: 0,
              byStage: {},
            },
            null,
            2,
          ),
        );
        console.log('[OK] Stats cleared');
      }
    } catch (err) {
      console.error('Error clearing metrics:', err);
    }
    return;
  }

  if (statsFlag) {
    const stats = loadStats();
    if (jsonFlag) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║    Token Optimization Statistics     ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Total Runs:           ${stats.totalRuns}`);
    console.log(`  Successful:           ${stats.successfulRuns}`);
    console.log(`  Cache Hits:           ${stats.cacheHits} (${stats.cacheHitRate.toFixed(1)}%)`);
    console.log(`  Total Token Savings:  ${stats.totalTokenSavings.toLocaleString()}`);
    console.log(`  Avg Savings Per Run:  ${stats.avgSavingsPct.toFixed(0)} tokens`);
    console.log('');
    console.log('  By Stage:');
    for (const [stage, s] of Object.entries(stats.byStage)) {
      console.log(
        `    ${stage.padEnd(15)} ${s.runs} runs, ${s.avgDurationMs.toFixed(0)}ms avg, ${s.avgSavings.toFixed(0)} tokens saved`,
      );
    }
    console.log('');
    return;
  }

  if (reportFlag) {
    const report = generateReport();
    if (jsonFlag) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║    Token Optimization Report         ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Total Runs:       ${report.stats.totalRuns}`);
    console.log(`  Cache Hit Rate:   ${report.stats.cacheHitRate.toFixed(1)}%`);
    console.log(`  Token Savings:    ${report.stats.totalTokenSavings.toLocaleString()}`);
    console.log('');
    console.log('  Recommendations:');
    if (report.recommendations.length === 0) {
      console.log('    No recommendations - optimization is performing well');
    } else {
      for (const rec of report.recommendations) {
        console.log(`    • ${rec}`);
      }
    }
    console.log('');
    return;
  }

  if (cacheCheckFlag) {
    let input = '';
    if (inputIdx >= 0) {
      input = args[inputIdx + 1] ?? '';
    } else if (fileIdx >= 0) {
      const filePath = args[fileIdx + 1] ?? '';
      if (existsSync(filePath)) {
        input = readFileSync(filePath, 'utf-8');
      }
    }
    const context = contextIdx >= 0 ? args[contextIdx + 1] : '';
    const result = checkCache(input, context);

    if (jsonFlag) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.hit ? 'Cache HIT' : 'Cache MISS');
    if (result.response) {
      console.log(`Response: ${result.response.slice(0, 200)}...`);
    }
    return;
  }

  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'pipeline';

  let input = '';
  if (inputIdx >= 0) {
    input = args[inputIdx + 1] ?? '';
  } else if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1] ?? '';
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    input = readFileSync(filePath, 'utf-8');
  }

  if (!input && !statsFlag && !reportFlag) {
    printUsage();
    process.exit(1);
  }

  const skill = skillIdx >= 0 ? args[skillIdx + 1] : undefined;
  const level = (levelIdx >= 0 ? args[levelIdx + 1] : 'chat-compact') as ChatLevel;
  const profile =
    profileIdx >= 0 ? (args[profileIdx + 1] as 'ultra' | 'lleno' | 'lite' | 'simple') : undefined;
  const context = contextIdx >= 0 ? args[contextIdx + 1] : undefined;
  const ttl = ttlIdx >= 0 ? parseInt(args[ttlIdx + 1] ?? '60', 10) : undefined;

  switch (mode) {
    case 'optimize-prompt': {
      const result = optimizePrompt(input, skill);
      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!quietFlag) {
        console.log(result.compressed);
      } else {
        console.log(result.compressed);
      }
      break;
    }

    case 'optimize-response': {
      const result = optimizeResponse(input, level, profile);
      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!quietFlag) {
        console.log('Chat Level Enforcement:');
        console.log(`  Level: ${result.chatEnforcement.level}`);
        console.log(
          `  Lines: ${result.chatEnforcement.originalLines} → ${result.chatEnforcement.enforcedLines}`,
        );
        console.log('');
        console.log('Output Compression:');
        console.log(`  Profile: ${result.outputCompression.profile}`);
        console.log(`  Savings: ${result.outputCompression.tokenSavings} tokens`);
        console.log('');
        console.log('Result:');
        console.log(result.outputCompression.compressed);
      } else {
        console.log(result.outputCompression.compressed);
      }
      break;
    }

    case 'pipeline':
    default: {
      if (!quietFlag) {
        console.warn(
          '[token-optimization] ℹ Mode "pipeline" uses a SIMULATED LLM response — benchmarks the compression pipeline without real LLM calls. Use src/ml/llm-call-wrapper.ts for real calls.',
        );
      }
      const pipelineInput: PipelineInput = {
        prompt: input,
        context,
        skill,
        chatLevel: level,
        cacheEnabled: !skipCacheFlag,
        ttlMinutes: ttl,
      };

      const result = await runPipeline(pipelineInput);

      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!quietFlag) {
        console.log(formatPipelineResult(result));
      } else {
        console.log(result.output.response);
      }
      break;
    }
  }
}
