#!/usr/bin/env node
/**
 * Humanizer CLI — command-line interface for src/humanize/humanizer.ts.
 *
 * Usage:
 *   npx tsx src/humanize/humanizer-cli.ts analyze --text "The system ..." [--json]
 *   npx tsx src/humanize/humanizer-cli.ts transform --file ./docs/readme.md --tone professional
 *   npx tsx src/humanize/humanizer-cli.ts score --file ./content/blog-post.md [--json]
 *
 * Options:
 *   --text <string>    Analyze/transform inline text
 *   --file <path>      Read input from a file
 *   --tone <tone>      professional | neutral | conversational | casual (default conversational)
 *   --intensity <0-1>  How aggressively to transform (default 0.6)
 *   --output <path>    Write transformed text to a file
 *   --json             Emit JSON instead of human-readable output
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  analyzeText,
  humanizeText,
  scoreHumanization,
  type AnalysisResult,
  type Tone,
} from './humanizer.js';

interface CliArgs {
  command: 'analyze' | 'transform' | 'score';
  text: string;
  file: string;
  tone: Tone;
  intensity: number;
  json: boolean;
  output: string;
}

const VALID_TONES: readonly Tone[] = ['professional', 'neutral', 'conversational', 'casual'];
const VALID_COMMANDS: readonly CliArgs['command'][] = ['analyze', 'transform', 'score'];

function parseArgs(argv: string[]): CliArgs | null {
  let command: CliArgs['command'] = 'analyze';
  let text = '';
  let file = '';
  let tone: Tone = 'conversational';
  let intensity = 0.6;
  let json = false;
  let output = '';

  const rest: string[] = [];
  for (const arg of argv) {
    if ((VALID_COMMANDS as readonly string[]).includes(arg)) {
      command = arg as CliArgs['command'];
    } else if (arg === '--json') {
      json = true;
    } else {
      rest.push(arg);
    }
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--text') text = rest[++i] ?? '';
    else if (arg === '--file') file = rest[++i] ?? '';
    else if (arg === '--tone') {
      const value = rest[++i] ?? 'conversational';
      if ((VALID_TONES as readonly string[]).includes(value)) {
        tone = value as Tone;
      }
    } else if (arg === '--intensity') {
      const value = Number.parseFloat(rest[++i] ?? '0.6');
      if (Number.isFinite(value)) intensity = value;
    } else if (arg === '--output') output = rest[++i] ?? '';
  }

  if (!text && !file) return null;
  return { command, text, file, tone, intensity, json, output };
}

function loadInput(args: CliArgs): string {
  if (args.file) return readFileSync(join(process.cwd(), args.file), 'utf-8');
  return args.text;
}

function formatAnalysis(analysis: AnalysisResult): string {
  const lines: string[] = [];
  lines.push('── Humanizer Analysis ─────────────────────────────────');
  lines.push(`aiScore:      ${analysis.aiScore.toFixed(3)}  (0 = human, 1 = AI)`);
  lines.push(`naturalness:  ${analysis.naturalness.toFixed(3)}`);
  lines.push(`variety:      ${analysis.variety.toFixed(3)}`);
  lines.push(`voice:        ${analysis.voice}`);
  lines.push('');
  lines.push('Metrics:');
  lines.push(`  words:             ${analysis.metrics.wordCount}`);
  lines.push(`  sentences:         ${analysis.metrics.sentenceCount}`);
  lines.push(`  avg sentence:      ${analysis.metrics.avgSentenceLength.toFixed(1)} words`);
  lines.push(`  length variance:   ${analysis.metrics.sentenceLengthCv.toFixed(3)} cv`);
  lines.push(`  adverbs:           ${analysis.metrics.adverbCount}`);
  lines.push(`  passive voice:     ${analysis.metrics.passiveCount}`);
  lines.push(`  contractions/100:  ${analysis.metrics.contractionPer100.toFixed(1)}`);
  lines.push(`  filler phrases:    ${analysis.metrics.genericPhraseCount}`);
  lines.push(
    `  transitions:       ${analysis.metrics.uniqueTransitions} unique / ${analysis.metrics.transitionTotal} total`,
  );
  lines.push(`  personal markers:  ${analysis.metrics.personalMarkerCount}`);
  lines.push(`  hedges:            ${analysis.metrics.hedgingCount}`);
  lines.push(`  em-dashes:         ${analysis.metrics.emDashCount}`);
  if (analysis.patterns.length > 0) {
    lines.push('');
    lines.push('Patterns detected:');
    for (const pattern of analysis.patterns) {
      const preview =
        pattern.matches.length > 0 ? `  e.g. "${pattern.matches.slice(0, 3).join('", "')}"` : '';
      lines.push(`  - ${pattern.pattern} (${pattern.count})${preview}`);
    }
  }
  lines.push('──────────────────────────────────────────────────────────');
  return lines.join('\n');
}

function runCli(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(`Usage:
  npx tsx src/humanize/humanizer-cli.ts analyze --text "The system ..." [--json]
  npx tsx src/humanize/humanizer-cli.ts transform --file ./docs/readme.md --tone professional [--intensity 0.6]
  npx tsx src/humanize/humanizer-cli.ts score --file ./content/blog-post.md [--json]

Options:
  --text <string>    Analyze/transform inline text
  --file <path>      Read input from a file
  --tone <tone>      professional | neutral | conversational | casual (default conversational)
  --intensity <0-1>  How aggressively to transform (default 0.6)
  --output <path>    Write transformed text to a file
  --json             Emit JSON instead of human-readable output`);
    process.exit(1);
  }

  const input = loadInput(parsed);

  if (parsed.command === 'analyze') {
    const analysis = analyzeText(input);
    if (parsed.json) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      console.log(formatAnalysis(analysis));
    }
    return;
  }

  if (parsed.command === 'score') {
    const score = scoreHumanization(input, {
      tone: parsed.tone,
      intensity: parsed.intensity,
    });
    if (parsed.json) {
      console.log(JSON.stringify(score, null, 2));
    } else {
      console.log(`aiScore:      ${score.aiScore}  (0 = human, 1 = AI)`);
      console.log(`naturalness:  ${score.naturalness}`);
      console.log(`variety:      ${score.variety}`);
      console.log(`voice:        ${score.voice}`);
      console.log('');
      console.log('Suggestions:');
      for (const suggestion of score.suggestions) console.log(`  - ${suggestion}`);
      console.log('');
      console.log('Humanized:');
      console.log(score.transformations);
    }
    return;
  }

  const transformed = humanizeText(input, {
    tone: parsed.tone,
    intensity: parsed.intensity,
  });
  if (parsed.output) {
    writeFileSync(join(process.cwd(), parsed.output), transformed, 'utf-8');
    console.log(`Wrote humanized text to ${parsed.output}`);
  } else if (parsed.json) {
    console.log(JSON.stringify({ input, output: transformed, tone: parsed.tone }, null, 2));
  } else {
    console.log('── Original ─────────────────────────────────────────────');
    console.log(input);
    console.log('');
    console.log('── Humanized ────────────────────────────────────────────');
    console.log(transformed);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
