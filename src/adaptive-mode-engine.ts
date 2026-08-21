#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

interface PhaseStatus {
  State: string;
  Progress: number;
  Errors: string[];
  Warnings: string[];
}

interface PhaseConfig {
  agents: string[];
  description: string;
  timeout: number;
  parallel: boolean;
  required: boolean;
  dependencies: string[];
  feedback_target: string;
}

interface DAGConfig {
  enabled: boolean;
  dag: {
    phases: Record<string, PhaseConfig>;
    rollback_policy: {
      checkpoint_on_phase_complete: boolean;
      auto_rollback_on_qa_failure: boolean;
    };
    feedback_loops: Record<
      string,
      {
        source: string;
        target: string;
        enabled: boolean;
        description: string;
        max_iterations: number;
        trigger: string;
      }
    >;
  };
}

interface AgentResult {
  Agent: string;
  Phase: string;
  Status: string;
  Error: string;
  Warning: string;
  Metrics: {
    ExecutionTime: number;
    TasksCompleted: number;
    TasksFailed: number;
  };
}

interface PhaseResult {
  PhaseName: string;
  Status: string;
  Agents: string[];
  StartTime: Date;
  Duration: number;
  Errors: string[];
  Warnings: string[];
  Metrics: Record<string, { ExecutionTime: number; TasksCompleted: number; TasksFailed: number }>;
}

interface FeedbackInfo {
  Triggered: boolean;
  TargetPhase: string;
  Reason: string;
  MaxIterations: number;
  CurrentIteration: number;
}

interface WorkflowResult {
  Status: string;
  CompletedPhases: string[];
  FailedPhases: string[];
  ExecutionLog: ExecutionLog;
  Checkpoints: string[];
  Duration: number;
}

interface Checkpoint {
  PhaseName: string;
  Timestamp: Date;
  PhaseState: PhaseStatus;
  ExecutionLog: ExecutionLog;
}

interface ExecutionLog {
  StartTime: Date;
  Phases: PhaseResult[];
  FeedbackLoops: unknown[];
  Rollbacks: { Timestamp: Date; CheckpointName: string; PhaseName: string }[];
}

class AdaptivePhase {
  Name: string;
  Agents: string[];
  Description: string;
  Timeout: number;
  Parallel: boolean;
  Required: boolean;
  Dependencies: string[];
  FeedbackTarget: string;
  Status: PhaseStatus;
  StartTime: Date;
  EndTime: Date;
  Results: PhaseResult[];
  Iteration = 0;

  constructor(name: string, config: PhaseConfig) {
    this.Name = name;
    this.Agents = config.agents || [];
    this.Description = config.description || '';
    this.Timeout = config.timeout || 300;
    this.Parallel = config.parallel || false;
    this.Required = config.required ?? true;
    this.Dependencies = config.dependencies || [];
    this.FeedbackTarget = config.feedback_target || '';
    this.Status = { State: 'pending', Progress: 0, Errors: [], Warnings: [] };
    this.StartTime = new Date();
    this.EndTime = new Date();
    this.Results = [];
  }
}

class DAGExecutor {
  Config: DAGConfig;
  Phases: Record<string, AdaptivePhase> = {};
  ExecutionLog: ExecutionLog;
  Checkpoints: Record<string, Checkpoint> = {};
  FeedbackLoops: unknown[] = [];

  constructor(config: DAGConfig) {
    this.Config = config;
    this.ExecutionLog = {
      StartTime: new Date(),
      Phases: [],
      FeedbackLoops: [],
      Rollbacks: [],
    };
    this.initializePhases();
  }

  initializePhases(): void {
    for (const [phaseName, phaseConfig] of Object.entries(this.Config.dag.phases)) {
      this.Phases[phaseName] = new AdaptivePhase(phaseName, phaseConfig);
    }
  }

  checkDependencies(phaseName: string): boolean {
    const phase = this.Phases[phaseName];
    if (!phase.Dependencies || phase.Dependencies.length === 0) return true;
    for (const dep of phase.Dependencies) {
      const depPhase = this.Phases[dep];
      if (depPhase.Status.State !== 'completed') return false;
    }
    return true;
  }

  executePhase(phaseName: string): PhaseResult {
    const phase = this.Phases[phaseName];
    console.log(`\x1b[36m[ADAPTIVE] Starting phase: ${phaseName}\x1b[0m`);
    phase.StartTime = new Date();
    phase.Status.State = 'executing';
    phase.Iteration++;

    const result: PhaseResult = {
      PhaseName: phaseName,
      Status: 'success',
      Agents: phase.Agents,
      StartTime: phase.StartTime,
      Duration: 0,
      Errors: [],
      Warnings: [],
      Metrics: {},
    };

    try {
      for (const agent of phase.Agents) {
        console.log(`   \x1b[33mExecuting agent: ${agent}\x1b[0m`);
        const agentResult = this.executeAgent(agent, phaseName);
        if (agentResult.Status === 'failed') {
          result.Status = 'failed';
          result.Errors.push(agentResult.Error);
          phase.Status.Errors.push(agentResult.Error);
        } else if (agentResult.Status === 'warning') {
          result.Warnings.push(agentResult.Warning);
          phase.Status.Warnings.push(agentResult.Warning);
        }
        result.Metrics[agent] = agentResult.Metrics;
      }

      phase.EndTime = new Date();
      result.Duration = (phase.EndTime.getTime() - phase.StartTime.getTime()) / 1000;

      if (result.Status === 'success') {
        phase.Status.State = 'completed';
        phase.Status.Progress = 100;
        console.log(`   \x1b[32mPhase completed: ${phaseName}\x1b[0m`);
      } else {
        phase.Status.State = 'failed';
        console.log(`   \x1b[31mPhase failed: ${phaseName}\x1b[0m`);
      }
    } catch (e: unknown) {
      result.Status = 'error';
      const msg = e instanceof Error ? e.message : String(e);
      result.Errors.push(msg);
      phase.Status.State = 'error';
      console.log(`   \x1b[31mError in phase: ${msg}\x1b[0m`);
    }

    phase.Results.push(result);
    this.ExecutionLog.Phases.push(result);
    return result;
  }

  executeAgent(agent: string, phaseName: string): AgentResult {
    const result: AgentResult = {
      Agent: agent,
      Phase: phaseName,
      Status: 'success',
      Error: '',
      Warning: '',
      Metrics: { ExecutionTime: 0, TasksCompleted: 0, TasksFailed: 0 },
    };
    result.Metrics.ExecutionTime = 100;
    result.Metrics.TasksCompleted = 1;
    return result;
  }

  createCheckpoint(phaseName: string): string {
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const checkpointName = `checkpoint-${phaseName}-${ts}`;

    this.Checkpoints[checkpointName] = {
      PhaseName: phaseName,
      Timestamp: now,
      PhaseState: { ...this.Phases[phaseName].Status },
      ExecutionLog: { ...this.ExecutionLog },
    };

    console.log(`\x1b[36m[CHECKPOINT] Created: ${checkpointName}\x1b[0m`);
    return checkpointName;
  }

  rollbackToCheckpoint(checkpointName: string): boolean {
    if (!this.Checkpoints[checkpointName]) {
      console.log(`\x1b[31m[ROLLBACK] Checkpoint not found: ${checkpointName}\x1b[0m`);
      return false;
    }

    const checkpoint = this.Checkpoints[checkpointName];
    console.log(`\x1b[33m[ROLLBACK] Reverting to: ${checkpointName}\x1b[0m`);

    const phaseName = checkpoint.PhaseName;
    this.Phases[phaseName].Status = { ...checkpoint.PhaseState };

    this.ExecutionLog.Rollbacks.push({
      Timestamp: new Date(),
      CheckpointName: checkpointName,
      PhaseName: phaseName,
    });

    console.log(`\x1b[32m[ROLLBACK] Completed: ${checkpointName}\x1b[0m`);
    return true;
  }

  checkFeedbackLoopCondition(sourcePhaseName: string): FeedbackInfo {
    const phase = this.Phases[sourcePhaseName];
    const lastResult = phase.Results[phase.Results.length - 1];

    const feedbackNeeded: FeedbackInfo = {
      Triggered: false,
      TargetPhase: '',
      Reason: '',
      MaxIterations: 0,
      CurrentIteration: 0,
    };

    for (const loop of Object.values(this.Config.dag.feedback_loops)) {
      if (loop.source === sourcePhaseName && loop.enabled) {
        if (this.evaluateFeedbackCondition(loop, lastResult)) {
          feedbackNeeded.Triggered = true;
          feedbackNeeded.TargetPhase = loop.target;
          feedbackNeeded.Reason = loop.description;
          feedbackNeeded.MaxIterations = loop.max_iterations;
          feedbackNeeded.CurrentIteration = phase.Iteration;
          break;
        }
      }
    }

    return feedbackNeeded;
  }

  evaluateFeedbackCondition(loop: { trigger: string }, result: PhaseResult): boolean {
    switch (loop.trigger) {
      case 'test_failure':
        return result.Status === 'failed' || result.Errors.length > 0;
      case 'architecture_issue':
        return result.Warnings.some((w) => /architecture|design/i.test(w));
      case 'security_issue':
        return result.Errors.some((e) => /security|vulnerability/i.test(e));
      default:
        return false;
    }
  }

  executeAdaptiveWorkflow(): WorkflowResult {
    console.log(`\n\x1b[36m[ADAPTIVE MODE] Starting adaptive orchestration\x1b[0m`);

    const executionPlan = this.buildExecutionPlan();
    console.log(`\n\x1b[33m[PLAN] Phases to execute:\x1b[0m`);
    for (const phase of executionPlan) {
      console.log(`   \x1b[90m${phase}\x1b[0m`);
    }
    console.log('');

    const completedPhases: string[] = [];
    const failedPhases: string[] = [];

    for (const phaseName of executionPlan) {
      if (!this.checkDependencies(phaseName)) {
        console.log(`\x1b[33m[SKIP] Phase skipped (dependencies not met): ${phaseName}\x1b[0m`);
        continue;
      }

      if (this.Config.dag.rollback_policy.checkpoint_on_phase_complete) {
        this.createCheckpoint(phaseName);
      }

      const result = this.executePhase(phaseName);

      if (result.Status === 'success') {
        completedPhases.push(phaseName);

        const feedback = this.checkFeedbackLoopCondition(phaseName);
        if (feedback.Triggered && feedback.CurrentIteration < feedback.MaxIterations) {
          console.log(`\n\x1b[35m[FEEDBACK LOOP] Triggered: ${feedback.Reason}\x1b[0m`);
          console.log(`  \x1b[35mSource: ${phaseName}  Target: ${feedback.TargetPhase}\x1b[0m`);

          this.Phases[feedback.TargetPhase].Status.State = 'pending';
          this.Phases[feedback.TargetPhase].Iteration = feedback.CurrentIteration;

          const retryResult = this.executePhase(feedback.TargetPhase);
          if (retryResult.Status === 'success') {
            completedPhases.push(feedback.TargetPhase);
          } else {
            failedPhases.push(feedback.TargetPhase);
          }
        }
      } else {
        failedPhases.push(phaseName);

        if (
          this.Config.dag.rollback_policy.auto_rollback_on_qa_failure &&
          phaseName === 'quality_assurance'
        ) {
          console.log(`\n\x1b[31m[AUTO-ROLLBACK] Triggered by QA failure\x1b[0m`);
          const checkpointNames = Object.keys(this.Checkpoints).sort().reverse();
          if (checkpointNames.length > 0) {
            this.rollbackToCheckpoint(checkpointNames[0]);
          }
        }
      }
    }

    return {
      Status: failedPhases.length === 0 ? 'success' : 'partial',
      CompletedPhases: completedPhases,
      FailedPhases: failedPhases,
      ExecutionLog: this.ExecutionLog,
      Checkpoints: Object.keys(this.Checkpoints),
      Duration: (new Date().getTime() - this.ExecutionLog.StartTime.getTime()) / 1000,
    };
  }

  buildExecutionPlan(): string[] {
    const plan: string[] = [];
    const visited: Record<string, boolean> = {};
    this.topologicalSort('planning', visited, plan);
    return plan;
  }

  topologicalSort(phaseName: string, visited: Record<string, boolean>, plan: string[]): void {
    if (visited[phaseName]) return;
    visited[phaseName] = true;

    const phase = this.Phases[phaseName];
    if (phase && phase.Dependencies) {
      for (const dep of phase.Dependencies) {
        this.topologicalSort(dep, visited, plan);
      }
    }

    plan.push(phaseName);
  }
}

function startAdaptiveMode(
  configPath: string,
  _taskDescription: string,
  dryRun: boolean,
): WorkflowResult | null {
  if (!existsSync(configPath)) {
    console.log(`\x1b[31m[ERROR] Config file not found: ${configPath}\x1b[0m`);
    return null;
  }

  let config: DAGConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    console.log('\x1b[31m[ERROR] Invalid config JSON\x1b[0m');
    return null;
  }

  if (!config.enabled) {
    console.log('\x1b[33m[INFO] Adaptive Mode is disabled\x1b[0m');
    return null;
  }

  if (dryRun) {
    console.log('\x1b[33m[DRY RUN] Phases to execute:\x1b[0m');
    for (const phaseName of Object.keys(config.dag.phases)) {
      console.log(`   \x1b[90m${phaseName}\x1b[0m`);
    }
    return null;
  }

  const executor = new DAGExecutor(config);
  const result = executor.executeAdaptiveWorkflow();

  console.log(`\n\x1b[36m[SUMMARY] Adaptive Execution\x1b[0m`);
  const statusColor = result.Status === 'success' ? '\x1b[32m' : '\x1b[33m';
  console.log(`${statusColor}Status: ${result.Status}\x1b[0m`);
  console.log(`\x1b[32mPhases completed: ${result.CompletedPhases.length}\x1b[0m`);
  const failColor = result.FailedPhases.length > 0 ? '\x1b[31m' : '\x1b[32m';
  console.log(`${failColor}Phases failed: ${result.FailedPhases.length}\x1b[0m`);
  console.log(`\x1b[36mTotal duration: ${Math.round(result.Duration * 100) / 100}s\x1b[0m`);

  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  let configPath = resolve('config/adaptive-dag-config.json');
  let taskDescription = '';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--config':
        configPath = resolve(args[++i]);
        break;
      case '--task':
        taskDescription = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
    }
  }

  const result = startAdaptiveMode(configPath, taskDescription, dryRun);
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
