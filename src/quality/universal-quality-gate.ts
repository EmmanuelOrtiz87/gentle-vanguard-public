import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { gitStatus } from '../delivery/git-adapter.js';
import { classifyDiff } from '../delivery/diff-classifier.js';
import { openNexus, runContinuousEval } from '../eval/continuous-eval.js';
import { registryPath, verifyIndex } from '../plugins/skill-registry.js';

type Result = { id: string; status: 'pass' | 'warn' | 'fail'; detail: string };
type RiskProfile = ReturnType<typeof classifyDiff> & {
  changedPaths: number;
  autonomyTier: 'low' | 'medium' | 'high' | 'critical';
};
const root = resolve(process.cwd());
const configPath = join(root, 'config', 'universal-quality-gate.json');
const runtimeDir = join(root, '.runtime', 'universal-quality-gate');

function check(id: string, ok: boolean, detail: string, warn = false): Result {
  return { id, status: ok ? 'pass' : warn ? 'warn' : 'fail', detail };
}

function classifyWorkingTree(): RiskProfile {
  const status = gitStatus(root);
  const paths = [...status.dirty, ...status.untracked];
  const classification = classifyDiff(paths);
  const autonomyTier = classification.requiresHumanApproval
    ? classification.risk >= 95
      ? 'critical'
      : 'high'
    : classification.risk >= 40
      ? 'medium'
      : 'low';
  return { ...classification, changedPaths: paths.length, autonomyTier };
}

function run(): {
  status: 'pass' | 'warn' | 'fail';
  results: Result[];
  timestamp: string;
  summary: { total: number; passed: number; warned: number; failed: number };
  risk: RiskProfile;
} {
  const timestamp = new Date().toISOString();
  const results: Result[] = [];
  let config: any;
  const risk = classifyWorkingTree();
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); results.push(check('config', true, 'universal-quality-gate.json válido')); }
  catch (error) {
    results.push(check('config', false, `configuración inválida: ${String(error)}`));
    return {
      status: 'fail',
      results,
      timestamp,
      summary: { total: results.length, passed: 0, warned: 0, failed: 1 },
      risk,
    };
  }

  const lifecycle = Array.isArray(config.lifecycle) ? config.lifecycle : [];
  const expectedStages = ['intake', 'plan', 'design', 'build', 'verify', 'release', 'operate', 'learn'];
  results.push(check('lifecycle', expectedStages.every((id) => lifecycle.some((stage: any) => stage.id === id)), '8 etapas transversales declaradas'));
  results.push(check('surfaces', Array.isArray(config.surfaces) && config.surfaces.length >= 12, `${config.surfaces?.length ?? 0} superficies declaradas`));
  results.push(check('disciplines', Array.isArray(config.disciplines) && config.disciplines.length >= 20, `${config.disciplines?.length ?? 0} disciplinas declaradas`));
  results.push(check('capabilities', Array.isArray(config.capabilities) && config.capabilities.length >= 30, `${config.capabilities?.length ?? 0} capacidades declaradas`));

  const sourceChecks = Object.entries(config.controlSources ?? {}).map(([id, paths]) => {
    const missing = (paths as string[]).filter((path) => path !== 'engram' && path !== 'Nexus' && !existsSync(join(root, path)));
    return check(`source:${id}`, missing.length === 0, missing.length ? `faltan: ${missing.join(', ')}` : 'fuentes disponibles');
  });
  results.push(...sourceChecks);
  const governancePath = join(root, config.governanceContract ?? 'config/stack-governance-contract.json');
  try {
    const governance = JSON.parse(readFileSync(governancePath, 'utf8')) as {
      categories?: Record<string, { artifacts?: string[]; mode?: string }>;
      requiredEvidence?: string[];
    };
    const artifacts = Object.values(governance.categories ?? {}).flatMap((category) => category.artifacts ?? []);
    const missingArtifacts = artifacts.filter((artifact) => !existsSync(join(root, artifact)));
    const evidenceOk = (governance.requiredEvidence ?? []).length >= 9;
    results.push(check('governance-contract', missingArtifacts.length === 0 && evidenceOk, missingArtifacts.length ? `faltan artefactos: ${missingArtifacts.join(', ')}` : 'contrato de gobernanza íntegro'));
  } catch (error) {
    results.push(check('governance-contract', false, `contrato no disponible: ${String(error)}`));
  }
  const disciplineSources = config.coverage?.disciplineSources ?? {};
  const capabilityStages = config.coverage?.capabilityStages ?? {};
  const sourceIds = new Set(Object.keys(config.controlSources ?? {}));
  const stageIds = new Set(lifecycle.map((stage: { id: string }) => stage.id));
  const uncoveredDisciplines = (config.disciplines ?? []).filter((discipline: string) => !sourceIds.has(disciplineSources[discipline]));
  const unmappedCapabilities = (config.capabilities ?? []).filter((capability: string) => !stageIds.has(capabilityStages[capability]));
  results.push(check('coverage:disciplines', uncoveredDisciplines.length === 0, uncoveredDisciplines.length ? `sin fuente: ${uncoveredDisciplines.join(', ')}` : 'todas las disciplinas tienen fuente'));
  results.push(check('coverage:capabilities', unmappedCapabilities.length === 0, unmappedCapabilities.length ? `sin etapa: ${unmappedCapabilities.join(', ')}` : 'todas las capacidades tienen etapa'));
  results.push(check('existing-gates', existsSync(join(root, 'config', 'quality-gates.json')), 'compone config/quality-gates.json sin duplicarlo'));
  results.push(check('checkpoint', existsSync(join(root, '.session', 'checkpoints')), 'checkpoint manager disponible', true));
  results.push(check('nexus', existsSync(join(root, '.runtime', 'gentle-vanguard.db')), 'Nexus operacional disponible'));
  results.push(check('memory', existsSync(join(root, 'knowledge-base')) || existsSync(join(root, '.session')), 'plano de memoria disponible'));

  // Live controls reuse the owning modules. They are intentionally bounded to
  // deterministic, local checks and leave the detailed gate logic in place.
  const liveControls = Array.isArray(config.liveControls) ? config.liveControls : [];
  results.push(check('live-controls', liveControls.length >= 2, `${liveControls.length} controles vivos declarados`));
  try {
    const db = openNexus(join(root, '.runtime', 'gentle-vanguard.db'));
    const evaluation = runContinuousEval(db, { gate: true });
    db.close();
    results.push(check('live:continuous-eval', evaluation.gate.passed, evaluation.gate.reason));
  } catch (error) {
    results.push(check('live:continuous-eval', false, `evaluación no disponible: ${String(error)}`));
  }

  if (existsSync(registryPath({ root }))) {
    const integrity = verifyIndex({ root });
    results.push(check('live:plugin-integrity', integrity.ok, integrity.ok ? 'registro íntegro' : 'integridad del registro no coincide'));
  } else {
    results.push(check('live:plugin-integrity', true, 'sin plugins instalados; control preparado'));
  }

  const failed = results.filter((result) => result.status === 'fail').length;
  const warned = results.filter((result) => result.status === 'warn').length;
  return {
    status: failed ? 'fail' : warned ? 'warn' : 'pass',
    results,
    timestamp,
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === 'pass').length,
      warned,
      failed,
    },
    risk,
  };
}

function recordNexus(report: ReturnType<typeof run>): void {
  const dbPath = join(root, '.runtime', 'gentle-vanguard.db');
  if (!existsSync(dbPath)) return;
  try {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO events (type, payload, tenant_id) VALUES (?, ?, ?)').run(
      'quality.universal_gate', JSON.stringify({ status: report.status, results: report.results }), 'gentle-vanguard');
    db.close();
  } catch (error) { console.warn(`[universal-quality-gate] Nexus no disponible: ${String(error)}`); }
}

const report = run();
mkdirSync(runtimeDir, { recursive: true });
writeFileSync(join(runtimeDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
recordNexus(report);
console.log(JSON.stringify(report, null, 2));
if (report.status === 'fail') process.exitCode = 1;
