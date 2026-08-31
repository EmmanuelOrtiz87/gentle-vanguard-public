import { join } from 'path';
import { writeFileSync } from 'fs';
import {
  DEFAULT_CONFIG,
  ROOT,
  SYNTH_CONFIG,
  ensureDir,
  getDate,
  getLogger,
  loadJson,
  now,
} from './config.js';
import { analyzeGaps, analyzeTrends, buildKnowledgeMap, computeQualityScore } from './analyze.js';
import {
  categorizeConcepts,
  extractConceptsFromDigests,
  extractConceptsFromReflections,
} from './extract.js';
import { formatJson, formatMarkdown } from './format.js';
import {
  getGitActivity,
  getMetricsSummary,
  readAuditSessions,
  readKnowledgeBaseVaultFiles,
  readReflectionOutputs,
  readSessionDigests,
} from './readers.js';
import type {
  KnowledgeConcept,
  KnowledgeGap,
  KnowledgeRelationship,
  SynthArgs,
  SynthOutput,
  TrendAnalysis,
} from './types.js';

export function parseArgs(argv: string[]): SynthArgs {
  const args: SynthArgs = {
    mode: 'synthesize',
    output: 'json',
    quiet: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--synthesize') args.mode = 'synthesize';
    else if (arg === '--map') args.mode = 'map';
    else if (arg === '--trends') args.mode = 'trends';
    else if (arg === '--gaps') args.mode = 'gaps';
    else if (arg === '--output' && argv[i + 1]) {
      const val = argv[++i];
      args.output = val === 'md' ? 'md' : 'json';
    } else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

export function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[KNOWLEDGE-SYNTHESIZER] Starting...');

  // 1. Load config
  const config = loadJson<typeof DEFAULT_CONFIG>(SYNTH_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 2. Collect data from all sources
  log('Collecting data sources...');

  const sessions = readAuditSessions();
  log(`  Audit sessions: ${sessions.length}`);

  const digestFiles = readSessionDigests();
  log(`  Digest files: ${digestFiles.length}`);

  const reflections = readReflectionOutputs();
  log(`  Reflection outputs: ${reflections.length}`);

  const kbFiles = readKnowledgeBaseVaultFiles();
  log(`  Knowledge base files: ${kbFiles.length}`);

  const metrics = getMetricsSummary();
  log(`  Metrics: quality=${metrics.qualityScore}, delegations=${metrics.delegations}`);

  const git = getGitActivity();
  log(`  Git: ${git.commits} commits, ${git.changedFiles} files`);

  // 3. Build date range
  const dates = sessions
    .map((s) => s.date)
    .filter(Boolean)
    .sort();
  const dateRange = {
    from: dates[0] || getDate(),
    to: dates[dates.length - 1] || getDate(),
  };

  // 4. Extract and categorize concepts
  log('Extracting concepts...');
  let concepts: KnowledgeConcept[] = [];

  if (args.mode === 'synthesize' || args.mode === 'map') {
    const digestConcepts = extractConceptsFromDigests(digestFiles, log);
    const reflectionConcepts = extractConceptsFromReflections(reflections);
    concepts = categorizeConcepts([...digestConcepts, ...reflectionConcepts]);
    log(`  Total concepts: ${concepts.length}`);
  }

  // 5. Build knowledge map
  let relationships: KnowledgeRelationship[] = [];
  if (args.mode === 'synthesize' || args.mode === 'map') {
    const map = buildKnowledgeMap(concepts, reflections, digestFiles, config);
    concepts = map.concepts;
    relationships = map.relationships;
    log(`  Knowledge map: ${concepts.length} concepts, ${relationships.length} relationships`);
  }

  // 6. Analyze trends
  let trends: TrendAnalysis[] = [];
  if (args.mode === 'synthesize' || args.mode === 'trends') {
    trends = analyzeTrends(concepts, sessions, config);
    log(`  Trends: ${trends.length}`);
  }

  // 7. Analyze gaps
  let gaps: KnowledgeGap[] = [];
  if (args.mode === 'synthesize' || args.mode === 'gaps') {
    gaps = analyzeGaps(concepts, sessions, digestFiles, kbFiles, log, config.maxGaps || 8);
    log(`  Gaps: ${gaps.length}`);
  }

  // 8. Quality score
  const qualityScore = computeQualityScore(concepts, gaps, metrics);
  log(`  Quality score: ${qualityScore}/100`);

  // 9. Build output
  const output: SynthOutput = {
    timestamp: now(),
    sessionCount: sessions.length,
    dateRange,
    concepts: concepts.slice(0, config.knowledgeMap?.maxConcepts || 50),
    relationships: relationships.slice(0, config.knowledgeMap?.maxRelationships || 100),
    trends,
    gaps,
    qualityScore,
  };

  // 10. Output
  if (args.output === 'md') {
    const md = formatMarkdown(output);
    if (!args.quiet) console.log(`\n${md}\n`);
    if (!args.dryRun) {
      const outFile = join(outputDir, `synthesis-${getDate()}.md`);
      writeFileSync(outFile, md, 'utf-8');
      log(`[OK] Markdown report saved to ${outFile}`);
    }
  } else {
    const json = formatJson(output);
    if (!args.quiet) {
      // Print summary line for pipeline mode
      console.log(
        JSON.stringify({
          concepts: output.concepts.length,
          relationships: output.relationships.length,
          trends: output.trends.length,
          gaps: output.gaps.length,
          qualityScore: output.qualityScore,
        }),
      );
    }
    if (!args.dryRun) {
      const outFile = join(outputDir, `synthesis-${getDate()}.json`);
      writeFileSync(outFile, json, 'utf-8');
      log(`[OK] JSON report saved to ${outFile}`);
    }
  }

  log('[KNOWLEDGE-SYNTHESIZER] Done');
}
