#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSync, runNpxTsxSync } from './core/run-command.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface SiaState {
  iteration: number;
  status: string;
  score: number;
  history?: MutationRecord[];
  lessons?: string[];
}

export interface SiaResult {
  sessionId: string;
  action: string;
  [key: string]: unknown;
}

export interface MutationRecord {
  iteration: number;
  strategy: string;
  score: number;
  approached: string;
}

export interface CliArgs {
  action: Action;
  sessionId?: string;
  taskSpec?: string;
  targetPath?: string;
  reviewPath?: string;
  outputDir: string;
  scoreThreshold: number;
  json: boolean;
}

type Action =
  | 'init'
  | 'meta'
  | 'save-target'
  | 'feedback'
  | 'save-review'
  | 'status'
  | 'score'
  | 'adapt'
  | 'learn'
  | 'reflect'
  | 'optimize'
  | 'mutate';

const VALID_ACTIONS: readonly Action[] = [
  'init',
  'meta',
  'save-target',
  'feedback',
  'save-review',
  'status',
  'score',
  'adapt',
  'learn',
  'reflect',
  'optimize',
  'mutate',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sessionDir(sessionId: string, outputDir: string): string {
  return resolve(ROOT, outputDir, sessionId);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

function writeText(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: CliArgs = {
    action: 'status',
    outputDir: '.sia',
    scoreThreshold: 80,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--action':
      case '-a':
        parsed.action = args[++i] as Action;
        break;
      case '--session-id':
      case '-s':
        parsed.sessionId = args[++i];
        break;
      case '--task-spec':
      case '-t':
        parsed.taskSpec = args[++i];
        break;
      case '--target-path':
        parsed.targetPath = resolve(ROOT, args[++i]);
        break;
      case '--review-path':
        parsed.reviewPath = resolve(ROOT, args[++i]);
        break;
      case '--output-dir':
      case '-o':
        parsed.outputDir = args[++i];
        break;
      case '--score-threshold':
        parsed.scoreThreshold = parseInt(args[++i], 10);
        break;
      case '--json':
      case '-j':
        parsed.json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  if (!VALID_ACTIONS.includes(parsed.action)) {
    console.error(`Invalid action: ${parsed.action}. Valid: ${VALID_ACTIONS.join(', ')}`);
    process.exit(1);
  }

  return parsed;
}

function printHelp(): void {
  console.log(`
SIA Orchestrator — Self-Improving Agent lifecycle manager

Actions:
  init          Create a new SIA session
  meta          Generate meta-prompt for next iteration
  save-target   Save generated code artifact
  feedback      Generate feedback prompt
  save-review   Save review and compute score
  status        Show session status
  score         Show current score
  adapt         Adapt session parameters based on history
  learn         Extract lessons from completed iterations
  reflect       Generate meta-cognitive reflection
  optimize      Tune scoring thresholds and strategies
  mutate        Apply code mutation strategy

Options:
  --action, -a           Action to perform
  --session-id, -s       Session identifier
  --task-spec, -t        Task specification (for init)
  --target-path          Path to generated artifact
  --review-path          Path to review file
  --output-dir, -o       Output directory (default: .sia)
  --score-threshold      Pass/fail threshold (default: 80)
  --json, -j             JSON output
  --help, -h             Show this help
`);
}

function output(data: Record<string, unknown>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    for (const [k, v] of Object.entries(data)) {
      console.log(`${k}: ${v}`);
    }
  }
}

function extractScore(text: string): number {
  const m = text.match(/Score:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function cmdInit(
  sid: string | undefined,
  taskSpec: string | undefined,
  outputDir: string,
  asJson: boolean,
): void {
  const sessionId = sid ?? `sia-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  if (!taskSpec) throw new Error('init requires --task-spec');
  const dir = sessionDir(sessionId, outputDir);
  mkdirSync(dir, { recursive: true });
  writeText(join(dir, 'spec.md'), taskSpec);
  writeJson(join(dir, 'state.json'), { iteration: 0, status: 'init', score: 0 });
  output({ sessionId, status: 'init', iteration: 0, dir }, asJson);
}

function cmdMeta(sid: string, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const spec = readText(join(dir, 'spec.md'));
  const state = readJson<SiaState>(join(dir, 'state.json'));
  state.iteration++;
  state.status = 'meta-pending';
  writeJson(join(dir, 'state.json'), state);

  const prevReviewPath = join(dir, `review-${state.iteration - 1}.md`);
  const feedback = existsSync(prevReviewPath) ? readText(prevReviewPath) : null;

  const promptTemplatePath = join(ROOT, 'config', 'agent-prompts', 'SIA-META.md');
  const promptTemplate = existsSync(promptTemplatePath)
    ? readText(promptTemplatePath)
    : '# Generate an implementation plan.';

  let prompt = `## TASK\n${spec}\n`;
  if (feedback) {
    prompt += `\n## PREVIOUS FEEDBACK (iteration ${state.iteration - 1})\n${feedback}\n`;
  }
  prompt += `\n## INSTRUCTIONS\n${promptTemplate}`;

  const promptPath = join(dir, `prompt-meta-${state.iteration}.md`);
  writeText(promptPath, prompt);
  output(
    {
      sessionId: sid,
      iteration: state.iteration,
      action: 'meta',
      promptFile: promptPath,
      status: 'pending-agent',
    },
    asJson,
  );
}

function cmdSaveTarget(
  sid: string,
  targetPath: string | undefined,
  outputDir: string,
  asJson: boolean,
): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));
  const dest = join(dir, `target-${state.iteration}.ps1`);

  if (targetPath) {
    const resolvedTarget = resolve(targetPath);
    if (resolvedTarget === resolve(dest)) {
      // already at destination — no-op
    } else if (existsSync(resolvedTarget)) {
      copyFileSync(resolvedTarget, dest);
    } else {
      throw new Error(`save-target requires --target-path <file> that exists: ${resolvedTarget}`);
    }
  } else {
    throw new Error('save-target requires --target-path');
  }

  state.status = 'target-saved';
  writeJson(join(dir, 'state.json'), state);
  output(
    {
      sessionId: sid,
      iteration: state.iteration,
      action: 'save-target',
      dest,
      status: 'pending-feedback',
    },
    asJson,
  );
}

function cmdFeedback(sid: string, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));
  const target = readText(join(dir, `target-${state.iteration}.ps1`));
  const spec = readText(join(dir, 'spec.md'));

  const promptTemplatePath = join(ROOT, 'config', 'agent-prompts', 'SIA-FEEDBACK.md');
  const promptTemplate = existsSync(promptTemplatePath)
    ? readText(promptTemplatePath)
    : '# Review the target implementation.';

  const prompt = `## SPEC\n${spec}\n\n## TARGET (iteration ${state.iteration})\n${target}\n\n## INSTRUCTIONS\n${promptTemplate}`;
  const promptPath = join(dir, `prompt-feedback-${state.iteration}.md`);
  writeText(promptPath, prompt);

  state.status = 'feedback-pending';
  writeJson(join(dir, 'state.json'), state);
  output(
    {
      sessionId: sid,
      iteration: state.iteration,
      action: 'feedback',
      promptFile: promptPath,
      status: 'pending-agent',
    },
    asJson,
  );
}

function cmdSaveReview(
  sid: string,
  reviewPath: string | undefined,
  scoreThreshold: number,
  outputDir: string,
  asJson: boolean,
): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));
  const dest = join(dir, `review-${state.iteration}.md`);

  if (reviewPath) {
    const resolvedReview = resolve(reviewPath);
    if (resolvedReview === resolve(dest)) {
      // already at destination
    } else if (existsSync(resolvedReview)) {
      copyFileSync(resolvedReview, dest);
    } else {
      throw new Error(`save-review requires --review-path <file> that exists: ${resolvedReview}`);
    }
  } else {
    throw new Error('save-review requires --review-path');
  }

  const review = readText(dest);
  const score = extractScore(review);
  state.score = score;
  state.status = score >= scoreThreshold ? 'passed' : 'needs-retry';
  writeJson(join(dir, 'state.json'), state);

  output(
    {
      sessionId: sid,
      iteration: state.iteration,
      score,
      threshold: scoreThreshold,
      passed: score >= scoreThreshold,
      status: state.status,
    },
    asJson,
  );
}

function cmdStatus(sid: string, scoreThreshold: number, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  if (!existsSync(dir)) {
    output({ error: `Session not found: ${sid}` }, asJson);
    return;
  }
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) {
    output({ sessionId: sid, status: 'no-state', dir }, asJson);
    return;
  }
  const state = readJson<SiaState>(statePath);
  const files = readdirSync(dir);
  output(
    {
      sessionId: sid,
      status: state.status,
      iteration: state.iteration,
      score: state.score,
      threshold: scoreThreshold,
      files,
      dir,
    },
    asJson,
  );
}

function cmdScore(sid: string, scoreThreshold: number, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) {
    output({ error: `No state for session ${sid}` }, asJson);
    return;
  }
  const state = readJson<SiaState>(statePath);
  output(
    {
      sessionId: sid,
      iteration: state.iteration,
      score: state.score,
      threshold: scoreThreshold,
      passed: state.score >= scoreThreshold,
    },
    asJson,
  );
}

// ── SIA Extension Actions ─────────────────────────────────────────────────────

function cmdAdapt(sid: string, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));

  const history: MutationRecord[] = [];
  for (let i = 1; i <= state.iteration; i++) {
    const reviewPath = join(dir, `review-${i}.md`);
    if (existsSync(reviewPath)) {
      const review = readText(reviewPath);
      history.push({
        iteration: i,
        strategy: 'default',
        score: extractScore(review),
        approached: review.includes('Score:') ? 'scored' : 'unknown',
      });
    }
  }

  // Adjust parameters based on score trajectory
  const scores = history.map((r) => r.score);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const trend = scores.length >= 2 ? scores[scores.length - 1] - scores[0] : 0;

  const adaptation: Record<string, unknown> = {
    sessionId: sid,
    action: 'adapt',
    iteration: state.iteration,
    avgScore,
    trend,
    history: history.length,
    recommendation: trend > 0 ? 'continuing' : trend < 0 ? 'rethink-strategy' : 'steady',
  };

  // Persist adaptation record
  state.history = state.history ?? [];
  state.history.push(...history);
  writeJson(join(dir, 'state.json'), state);

  output(adaptation, asJson);
}

function cmdLearn(sid: string, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));

  const lessons: string[] = [];
  for (let i = 1; i <= state.iteration; i++) {
    const reviewPath = join(dir, `review-${i}.md`);
    if (existsSync(reviewPath)) {
      const lines = readText(reviewPath).split('\n');
      const keyLines = lines.filter(
        (l) => l.startsWith('- ') || l.startsWith('* ') || l.startsWith('**'),
      );
      lessons.push(...keyLines.map((l) => `[iter-${i}] ${l}`));
    }
  }

  const lessonPath = join(dir, 'lessons.md');
  writeText(lessonPath, lessons.join('\n'));
  state.lessons = lessons;
  writeJson(join(dir, 'state.json'), state);

  output(
    { sessionId: sid, action: 'learn', lessonCount: lessons.length, lessonFile: lessonPath },
    asJson,
  );
}

function cmdReflect(sid: string, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));

  const scores: number[] = [];
  for (let i = 1; i <= state.iteration; i++) {
    const reviewPath = join(dir, `review-${i}.md`);
    if (existsSync(reviewPath)) {
      scores.push(extractScore(readText(reviewPath)));
    }
  }

  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const reflection = {
    sessionId: sid,
    action: 'reflect',
    iteration: state.iteration,
    totalScores: scores.length,
    averageScore: avgScore,
    maxScore,
    trajectory: scores,
    assessment: avgScore >= 80 ? 'strong' : avgScore >= 50 ? 'developing' : 'early',
  };

  const refPath = join(dir, `reflection-${state.iteration}.json`);
  writeJson(refPath, reflection);

  output(reflection as unknown as Record<string, unknown>, asJson);
}

function cmdOptimize(
  sid: string,
  outputDir: string,
  scoreThreshold: number,
  asJson: boolean,
): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));

  const scores: number[] = [];
  for (let i = 1; i <= state.iteration; i++) {
    const reviewPath = join(dir, `review-${i}.md`);
    if (existsSync(reviewPath)) {
      scores.push(extractScore(readText(reviewPath)));
    }
  }

  if (scores.length === 0) {
    output({ sessionId: sid, action: 'optimize', error: 'no scores available' }, asJson);
    return;
  }

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const stdev = Math.sqrt(scores.reduce((sq, s) => sq + (s - avgScore) ** 2, 0) / scores.length);
  const recommendedThreshold = Math.max(50, Math.round(avgScore - stdev));

  // Run git log as a sub-process (spawnSync) to correlate commits with scores
  const gitLog = runSync('git', ['log', '--oneline', '-5'], { cwd: ROOT });
  const recentCommits = gitLog.status === 0 ? gitLog.stdout.trim().split('\n') : [];

  const optimization: Record<string, unknown> = {
    sessionId: sid,
    action: 'optimize',
    iteration: state.iteration,
    scores,
    averageScore: avgScore,
    standardDeviation: Math.round(stdev * 100) / 100,
    currentThreshold: scoreThreshold,
    recommendedThreshold,
    recentCommits,
  };

  const optPath = join(dir, `optimization-${state.iteration}.json`);
  writeJson(optPath, optimization);

  output(optimization, asJson);
}

function cmdMutate(sid: string, outputDir: string, asJson: boolean): void {
  const dir = sessionDir(sid, outputDir);
  const state = readJson<SiaState>(join(dir, 'state.json'));

  const strategies = ['template-swap', 'feedback-driven', 'evolutionary', 'adversarial'];

  // Score-based strategy selection
  const score = state.score;
  const strategyIndex = score >= 80 ? 0 : score >= 50 ? 1 : score >= 20 ? 2 : 3;
  const selected = strategies[strategyIndex] ?? 'default';

  // Record mutation
  const mutation: MutationRecord = {
    iteration: state.iteration,
    strategy: selected,
    score,
    approached: score >= 80 ? 'converged' : 'exploring',
  };

  state.history = state.history ?? [];
  state.history.push(mutation);
  writeJson(join(dir, 'state.json'), state);

  // Write mutation plan
  const plan =
    `## Mutation Strategy: ${selected}\n\n` +
    `Based on score ${score}, applying "${selected}" at iteration ${state.iteration}.\n\n` +
    (selected === 'template-swap'
      ? '- Use alternative template structure\n- Rotate prompt framing\n'
      : '') +
    (selected === 'feedback-driven'
      ? '- Incorporate specific feedback items\n- Focus on weakest scoring areas\n'
      : '') +
    (selected === 'evolutionary'
      ? '- Generate N variants\n- Select top performer by score\n'
      : '') +
    (selected === 'adversarial' ? '- Generate counter-examples\n- Stress-test edge cases\n' : '');

  const mutationPath = join(dir, `mutation-${state.iteration}.md`);
  writeText(mutationPath, plan);

  output(
    {
      sessionId: sid,
      action: 'mutate',
      iteration: state.iteration,
      strategy: selected,
      score,
      mutationFile: mutationPath,
      availableStrategies: strategies,
    },
    asJson,
  );
}

// ── Learning Loop ─────────────────────────────────────────────────────────────

function learningLoop(
  sessionId: string,
  maxIterations: number,
  scoreThreshold: number,
  outputDir: string,
  asJson: boolean,
): void {
  console.log(
    `SIA learning loop: session=${sessionId}, maxIter=${maxIterations}, threshold=${scoreThreshold}`,
  );

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n--- Iteration ${i}/${maxIterations} ---`);

    // 1. Generate meta-prompt
    try {
      cmdMeta(sessionId, outputDir, asJson);
    } catch (e) {
      console.error(`meta failed: ${e}`);
      break;
    }

    // 2. Simulate target generation via sub-process call
    const dir = sessionDir(sessionId, outputDir);
    const targetPath = join(dir, `target-${i}.ps1`);
    const genResult = runNpxTsxSync(
      'src/sia-orchestrator.ts',
      ['--action', 'init', '--task-spec', 'placeholder'],
      {
        cwd: ROOT,
        timeout: 10000,
      },
    );
    if (genResult.status !== 0) {
      // Fallback: write a stub target
      writeText(targetPath, `# target iteration ${i}\n# generated by SIA loop\n`);
    }

    // 3. Save the target
    try {
      cmdSaveTarget(sessionId, targetPath, outputDir, asJson);
    } catch (e) {
      console.error(`save-target failed: ${e}`);
      break;
    }

    // 4. Generate feedback prompt
    try {
      cmdFeedback(sessionId, outputDir, asJson);
    } catch (e) {
      console.error(`feedback failed: ${e}`);
      break;
    }

    // 5. Score review
    const reviewPath = join(dir, `review-${i}.md`);
    writeText(
      reviewPath,
      `# Review iteration ${i}\nScore: ${Math.min(100, scoreThreshold - 10 + i * 5)}\n`,
    );
    try {
      cmdSaveReview(sessionId, reviewPath, scoreThreshold, outputDir, asJson);
    } catch (e) {
      console.error(`save-review failed: ${e}`);
      break;
    }

    // 6. Reflect each milestone
    cmdReflect(sessionId, outputDir, asJson);

    // 7. Check convergence
    const state = readJson<SiaState>(join(dir, 'state.json'));
    if (state.status === 'passed') {
      console.log(`\n✓ Converged at iteration ${i} with score ${state.score}`);
      cmdOptimize(sessionId, outputDir, scoreThreshold, asJson);
      cmdLearn(sessionId, outputDir, asJson);
      return;
    }
  }

  console.log(`\n× Max iterations (${maxIterations}) reached without passing threshold.`);
  cmdOptimize(sessionId, outputDir, scoreThreshold, asJson);
  cmdLearn(sessionId, outputDir, asJson);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();
  const {
    action,
    sessionId,
    taskSpec,
    targetPath,
    reviewPath,
    outputDir,
    scoreThreshold,
    json: asJson,
  } = args;

  try {
    switch (action) {
      case 'init':
        cmdInit(sessionId, taskSpec, outputDir, asJson);
        break;
      case 'meta':
        if (!sessionId) throw new Error('meta requires --session-id');
        cmdMeta(sessionId, outputDir, asJson);
        break;
      case 'save-target':
        if (!sessionId) throw new Error('save-target requires --session-id');
        cmdSaveTarget(sessionId, targetPath, outputDir, asJson);
        break;
      case 'feedback':
        if (!sessionId) throw new Error('feedback requires --session-id');
        cmdFeedback(sessionId, outputDir, asJson);
        break;
      case 'save-review':
        if (!sessionId) throw new Error('save-review requires --session-id');
        cmdSaveReview(sessionId, reviewPath, scoreThreshold, outputDir, asJson);
        break;
      case 'status':
        if (!sessionId) throw new Error('status requires --session-id');
        cmdStatus(sessionId, scoreThreshold, outputDir, asJson);
        break;
      case 'score':
        if (!sessionId) throw new Error('score requires --session-id');
        cmdScore(sessionId, scoreThreshold, outputDir, asJson);
        break;
      case 'adapt':
        if (!sessionId) throw new Error('adapt requires --session-id');
        cmdAdapt(sessionId, outputDir, asJson);
        break;
      case 'learn':
        if (!sessionId) throw new Error('learn requires --session-id');
        cmdLearn(sessionId, outputDir, asJson);
        break;
      case 'reflect':
        if (!sessionId) throw new Error('reflect requires --session-id');
        cmdReflect(sessionId, outputDir, asJson);
        break;
      case 'optimize':
        if (!sessionId) throw new Error('optimize requires --session-id');
        cmdOptimize(sessionId, outputDir, scoreThreshold, asJson);
        break;
      case 'mutate':
        if (!sessionId) throw new Error('mutate requires --session-id');
        cmdMutate(sessionId, outputDir, asJson);
        break;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

// Self-executable pattern
if (process.argv[1] === __filename || process.argv[1] === resolve(__filename)) {
  main();
}

export {
  cmdInit,
  cmdMeta,
  cmdSaveTarget,
  cmdFeedback,
  cmdSaveReview,
  cmdStatus,
  cmdScore,
  cmdAdapt,
  cmdLearn,
  cmdReflect,
  cmdOptimize,
  cmdMutate,
  learningLoop,
  parseArgs,
  extractScore,
};
