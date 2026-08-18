import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  COMMANDS,
  aggregateStatus,
  buildReleaseReport,
  computeExitCode,
  makeGateProfile,
  runGate,
  selectReleaseGates,
  skipGate,
  sortGatesByDuration,
  type ReleaseReport,
} from '../../src/cli/gv.ts';

describe('gv release profiling', () => {
  it('makeGateProfile computes duration and status from simulated inputs', () => {
    const pass = makeGateProfile('Homologation Gate', 0, 1234);
    assert.equal(pass.name, 'Homologation Gate');
    assert.equal(pass.duration_ms, 1234);
    assert.equal(pass.status, 'pass');
    assert.equal(pass.exit_code, 0);

    const fail = makeGateProfile('Secrets Gate', 1, 567);
    assert.equal(fail.duration_ms, 567);
    assert.equal(fail.status, 'fail');
    assert.equal(fail.exit_code, 1);
  });

  it('sorts gates by duration descending without mutating the input', () => {
    const gates = [
      makeGateProfile('A', 0, 100),
      makeGateProfile('B', 0, 300),
      makeGateProfile('C', 0, 200),
    ];
    const sorted = sortGatesByDuration(gates);
    assert.deepEqual(
      sorted.map((g) => g.name),
      ['B', 'C', 'A'],
    );
    assert.deepEqual(
      gates.map((g) => g.name),
      ['A', 'B', 'C'],
    );
  });

  it('computes exit code 0 when all gates pass and 1 when any fails', () => {
    const pass = [makeGateProfile('A', 0, 10), makeGateProfile('B', 0, 20)];
    assert.equal(computeExitCode(pass), 0);
    assert.equal(buildReleaseReport(pass).exitCode, 0);

    const fail = [makeGateProfile('A', 0, 10), makeGateProfile('B', 1, 20)];
    assert.equal(computeExitCode(fail), 1);
    assert.equal(buildReleaseReport(fail).exitCode, 1);

    const withSkip = [skipGate('A'), makeGateProfile('B', 0, 20)];
    assert.equal(computeExitCode(withSkip), 0);
  });

  it('buildReleaseReport serializes to parseable JSON with the expected structure', () => {
    const report = buildReleaseReport([
      makeGateProfile('Homologation Gate', 0, 100),
      skipGate('Tests Gate'),
    ]);
    const parsed = JSON.parse(JSON.stringify(report)) as ReleaseReport;
    assert.equal(parsed.command, 'release');
    assert.equal(parsed.gates.length, 2);
    assert.equal(parsed.gates[0].name, 'Homologation Gate');
    assert.equal(parsed.gates[0].status, 'pass');
    assert.equal(parsed.gates[0].exit_code, 0);
    assert.equal(parsed.gates[1].status, 'skip');
    assert.equal(typeof parsed.total_ms, 'number');
    assert.equal(typeof parsed.exitCode, 'number');
    assert.equal(typeof parsed.allPassed, 'boolean');
    assert.equal(typeof parsed.timestamp, 'string');
  });

  it('--skip-tests marks the tests gate as skip', () => {
    const skipped = selectReleaseGates(true);
    const testsSpec = skipped.find((s) => s.name === 'Tests Gate');
    assert.ok(testsSpec);
    assert.equal(testsSpec.skip, true);

    const gate = skipGate('Tests Gate');
    assert.equal(gate.status, 'skip');
    assert.equal(gate.duration_ms, 0);
    assert.equal(gate.exit_code, 0);

    const full = selectReleaseGates(false);
    assert.equal(full.find((s) => s.name === 'Tests Gate')?.skip, undefined);
    assert.equal(full.find((s) => s.name === 'Tests Gate')?.cmd, 'npm');
  });

  it('release is registered in the command list', () => {
    assert.ok(COMMANDS.includes('release'));
    assert.ok(COMMANDS.includes('help'));
    assert.ok(COMMANDS.includes('check'));
  });

  it('aggregateStatus fails when any gate fails and ignores skips', () => {
    assert.equal(aggregateStatus([makeGateProfile('A', 0, 1), makeGateProfile('B', 0, 1)]), 'pass');
    assert.equal(aggregateStatus([makeGateProfile('A', 0, 1), makeGateProfile('B', 1, 1)]), 'fail');
    assert.equal(aggregateStatus([skipGate('A'), makeGateProfile('B', 0, 1)]), 'pass');
  });

  it('runGate with a non-existent command reports fail with non-zero exit code', () => {
    const gate = runGate('Bogus Gate', 'definitely-not-a-real-command-xyz', []);
    assert.equal(gate.status, 'fail');
    assert.notEqual(gate.exit_code, 0);
    assert.ok(gate.duration_ms >= 0);
  });
});
