/** Read-only qualification. Configuration audits never certify model task execution. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { runSync, runNpxTsxSync } from '../core/run-command.js';
import { auditTools } from './tool-interoperability-audit.js';
import { freshProbe, inventoryCoverage, qualificationExit, bindingObservation, type ProbeRecord } from './client-runtime-evidence.js';
import Database from 'better-sqlite3';
import { EventRepo } from '../database/nexus/repositories/EventRepo.js';

export function surfaceQualification(status: string) {
  return { level: status === 'PASS' ? 'declared' : 'unverified', qualified: false,
    scope: 'Installation/configuration only; host model and tools need separate observed operations' };
}
export function assessBinding(status: number | null, stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout);
    return status === 0 && typeof parsed.session_id === 'string' && parsed.session_id.trim().length > 0;
  } catch { return false; }
}
export function assessModelProbe(status: number | null, stdout: string, stderr: string) {
  const scope = 'PIN requirements fixture only; not certification of other SDD agents or tool access';
  if (status !== 0 || /falling back|not a primary agent/i.test(stderr)) {
    return { qualified: false, scope, reason: 'Command failed or substituted another agent' };
  }
  try {
    const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    if (events.some(event => event.type === 'error')) throw new Error('error event');
    if (!events.some(event => event.type === 'step_finish' && event.part?.reason === 'stop')) throw new Error('completion absent');
    const tasks = events.filter(event => event.type === 'tool_use' && event.part?.tool === 'task');
    if (tasks.some(event => event.part.state?.status !== 'completed')) throw new Error('task failed');
    const matching = tasks.filter(event => event.part.state?.input?.subagent_type === 'sdd-explore');
    if (matching.length !== 1) throw new Error('expected subagent not observed exactly once');
    const text = matching[0].part.state.output ?? '';
    const marker = 'GV_SDD_PROBE';
    if (!text.includes(marker)) throw new Error('marker absent');
    const answer = JSON.parse(text.slice(text.indexOf(marker) + marker.length).replace(/<\/task_result>\s*$/, '').trim());
    if (!Array.isArray(answer.requirements) || !Array.isArray(answer.acceptance) || !Array.isArray(answer.unresolvedQuestions)) throw new Error('shape');
    if (!answer.requirements.length || answer.acceptance.length < 2 ||
      !/third|tercer|3/.test(answer.acceptance.join(' ').toLowerCase()) || !/60/.test(answer.acceptance.join(' '))) throw new Error('cases missing');
    return { qualified: true, scope, reason: 'Observed fixture response passed structural acceptance checks; human semantic review remains separate' };
  } catch { return { qualified: false, scope, reason: 'No accepted structured fixture output' }; }
}

function main(): void {
  const root = process.cwd();
  const dir = join(root, '.runtime/client-qualification'); mkdirSync(dir, { recursive: true });
  const readJson = (path: string): unknown => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
  const versionResult = runSync('opencode', ['--version'], { timeout: 5000 });
  const version = versionResult.status === 0 ? versionResult.stdout.trim() : 'unavailable';
  const sourceFiles = ['opencode.json', '.opencode/agents/sdd-explore.md'].map(path => join(root, path)).concat([
    join(homedir(), '.config/opencode/opencode.json'), join(homedir(), '.local/share/opencode/auth.json'),
    fileURLToPath(import.meta.url), fileURLToPath(new URL('./client-runtime-evidence.ts', import.meta.url)),
  ]);
  const fingerprint = createHash('sha256').update(version);
  for (const path of sourceFiles) fingerprint.update(path).update(existsSync(path) ? readFileSync(path) : 'missing');
  const configFingerprint = fingerprint.digest('hex'); // Hash only; never emit credentials or config bytes.
  const cached = freshProbe(readJson(join(dir, 'opencode-probe.json')), configFingerprint);
  const clients = auditTools().map(row => ({ tool: row.tool, configuration: row.status, ...surfaceQualification(row.status) }));
  const hostArg = process.argv.indexOf('--host-session');
  const explicitHostId = hostArg < 0 ? undefined : process.argv[hostArg + 1];
  if (hostArg >= 0 && (!explicitHostId || explicitHostId.startsWith('--'))) throw new Error('--host-session requires the actual identity supplied by the host');
  const hostId = explicitHostId || process.env.CODEX_SESSION_ID || process.env.CODEX_THREAD_ID;
  // Only consume an authoritative host value. Never create/register a session here.
  const binding = hostId ? runSync('engram', ['hook', 'codex-resolve'], {
    input: JSON.stringify({ session_id: hostId, cwd: root }), env: { ENGRAM_HOOK_OUTPUT: 'json' }, timeout: 5000,
  }) : null;
  const identityConfirmed = binding ? assessBinding(binding.status, binding.stdout) : null;
  let probe: ProbeRecord['result'] | null = cached?.result ?? null;
  let probeRecordedAt = cached?.recordedAt ?? null;
  if (process.argv.includes('--probe-opencode')) {
    const dir = mkdtempSync(join(tmpdir(), 'gv-sdd-qualification-'));
    const template = 'Read-only qualification. No tools or files. Requirement: lock after 3 wrong PINs, unlock after 60 seconds. Return GV_SDD_PROBE followed by JSON with requirements, acceptance (third-failure and time-boundary cases), unresolvedQuestions. No implementation.';
    // Official command contract invokes subagents natively. --agent would substitute a primary.
    const result = runSync('opencode', ['run', '--command', 'gv-sdd-qualification', '--format', 'json', '--dir', dir, 'PIN fixture'], {
      timeout: 45000, maxBuffer: 1024 * 1024,
      env: { OPENCODE_CONFIG: resolve('opencode.json'), OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { '*': 'deny', task: { '*': 'deny', 'sdd-explore': 'allow' } },
        command: { 'gv-sdd-qualification': { agent: 'sdd-explore', subtask: true, template } },
      }) },
    });
    probe = assessModelProbe(result.status, result.stdout, result.stderr);
    // Preserve operational errors without copying headers, provider config or credentials.
    const failure = /FreeTierError|statusCode.{0,8}403/.test(result.stdout) ? 'Provider denied request (HTTP 403 / FreeTierError)' : probe.reason;
    if (failure !== probe.reason) probe.reason += `; ${failure}`;
    writeFileSync(join(dir, 'probe-result.json'), JSON.stringify({ status: result.status, result: probe }, null, 2));
    probeRecordedAt = new Date().toISOString();
    // Failed probes are also evidence. Default observation never retries LLM calls.
    writeFileSync(join(root, '.runtime/client-qualification/opencode-probe.json'), JSON.stringify({
      fingerprint: configFingerprint, recordedAt: probeRecordedAt, result: probe,
    }, null, 2));
  }
  const smoke = runNpxTsxSync(fileURLToPath(new URL('./engram-mcp-smoke.ts', import.meta.url)), [], { cwd: root, timeout: 10000 });
  let memoryTransport: { status: string; toolCount?: number; listProjectsOk?: boolean } = { status: 'FAIL' };
  try { const parsed = JSON.parse(smoke.stdout); if (smoke.status === 0 && parsed.status === 'PASS' && parsed.listProjectsOk === true) memoryTransport = { status: 'PASS', toolCount: parsed.toolCount, listProjectsOk: true }; } catch { /* non-JSON is not success */ }
  const report = { generatedAt: new Date().toISOString(), clients, codex: {
    ...bindingObservation(identityConfirmed),
    resolverExit: binding?.status ?? null,
  }, opencodeVersion: version, opencodeFixture: probe, probeRecordedAt,
    configFingerprint, memoryTransport,
    mcpInventory: inventoryCoverage(readJson(join(root, '.runtime/mcp-inventory/mcp-inventory-latest.json'))),
    status: 'partial', qualificationComplete: false };
  const path = join(dir, `qualification-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), { flag: 'wx' });
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 2));
  const nexus = join(root, '.runtime/gentle-vanguard.db');
  let telemetryRecorded = false;
  if (existsSync(nexus)) {
    const connection = new Database(nexus, { fileMustExist: true, timeout: 3000 });
    try { new EventRepo(connection).insertEvent('gentle-vanguard', 'integration.client_qualification', report); telemetryRecorded = true; }
    finally { connection.close(); }
  }
  console.log(JSON.stringify({ ...report, report: path, telemetryRecorded }, null, 2));
  // An unqualified host must not become a green task gate.
  process.exitCode = qualificationExit({ complete: report.qualificationComplete, observe: process.argv.includes('--observe'), collected: true });
}
if (['client-qualification.ts', 'client-qualification.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '')) main();
