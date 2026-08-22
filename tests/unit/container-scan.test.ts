/**
 * Unit tests for src/container-scan.ts
 * Parsers (Grype/Trivy), severity ordering, and CLI argument parsing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGrypeJson,
  parseTrivyJson,
  severityRank,
  compareSeverity,
  parseScanArgs,
  formatResults,
  type ScanResult,
} from '../../src/container-scan.js';

describe('container-scan parsers', () => {
  it('parses Grype JSON matches', () => {
    const json = JSON.stringify({
      matches: [
        {
          vulnerability: {
            id: 'CVE-2024-0001',
            severity: 'High',
            fix: { versions: ['1.2.3'] },
            description: 'test vuln',
            urls: ['https://nvd.nist.gov/vuln/detail/CVE-2024-0001'],
          },
          artifact: { name: 'lodash', version: '1.2.2' },
        },
      ],
    });
    const vulns = parseGrypeJson(json);
    assert.equal(vulns.length, 1);
    assert.equal(vulns[0].id, 'CVE-2024-0001');
    assert.equal(vulns[0].severity, 'high');
    assert.equal(vulns[0].package, 'lodash');
    assert.equal(vulns[0].fixVersion, '1.2.3');
    assert.equal(vulns[0].url, 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001');
  });

  it('tolerates missing fix/urls/description fields', () => {
    const json = JSON.stringify({
      matches: [{ vulnerability: { id: 'CVE-X', severity: 'critical' } }],
    });
    const vulns = parseGrypeJson(json);
    assert.equal(vulns.length, 1);
    assert.equal(vulns[0].fixVersion, null);
    assert.equal(vulns[0].url, '');
    assert.equal(vulns[0].description, '');
  });

  it('returns empty on invalid JSON', () => {
    assert.deepEqual(parseGrypeJson('not json'), []);
  });

  it('parses Trivy filesystem JSON results', () => {
    const json = JSON.stringify({
      Results: [
        {
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2023-9999',
              Severity: 'CRITICAL',
              PkgName: 'openssl',
              InstalledVersion: '3.0.0',
              FixedVersion: '3.0.1',
              Description: 'desc',
              PrimaryURL: 'https://example.com/CVE-2023-9999',
            },
          ],
        },
      ],
    });
    const vulns = parseTrivyJson(json);
    assert.equal(vulns.length, 1);
    assert.equal(vulns[0].id, 'CVE-2023-9999');
    assert.equal(vulns[0].severity, 'critical');
    assert.equal(vulns[0].fixVersion, '3.0.1');
    assert.equal(vulns[0].url, 'https://example.com/CVE-2023-9999');
  });

  it('parses Trivy multi-result arrays', () => {
    const json = JSON.stringify({
      Results: [
        { Vulnerabilities: [{ VulnerabilityID: 'A', Severity: 'low' }] },
        { Vulnerabilities: [{ VulnerabilityID: 'B', Severity: 'medium' }] },
      ],
    });
    assert.equal(parseTrivyJson(json).length, 2);
  });
});

describe('container-scan severity ordering', () => {
  it('ranks critical < high < medium < low < negligible < unknown', () => {
    assert.ok(severityRank('critical') < severityRank('high'));
    assert.ok(severityRank('high') < severityRank('medium'));
    assert.ok(severityRank('medium') < severityRank('low'));
    assert.ok(severityRank('low') < severityRank('negligible'));
    assert.ok(severityRank('negligible') < severityRank('unknown'));
  });

  it('compareSeverity sorts ascending by severity', () => {
    assert.ok(compareSeverity('critical', 'high') < 0);
    assert.ok(compareSeverity('medium', 'medium') === 0);
    assert.ok(compareSeverity('low', 'critical') > 0);
  });
});

describe('container-scan CLI args', () => {
  it('defaults to scan action with sbom.json', () => {
    const cli = parseScanArgs([]);
    assert.equal(cli.action, 'scan');
    assert.ok(cli.sbom.endsWith('sbom.json'));
    assert.equal(cli.failOn, 'high');
  });

  it('parses --sbom and --fail-on', () => {
    const cli = parseScanArgs(['scan', '--sbom', 'custom.json', '--fail-on', 'critical']);
    assert.equal(cli.sbom, 'custom.json');
    assert.equal(cli.failOn, 'critical');
  });

  it('parses scan-dir with positional dir', () => {
    const cli = parseScanArgs(['scan-dir', 'C:\\tmp\\app']);
    assert.equal(cli.action, 'scan-dir');
    assert.equal(cli.dir, 'C:\\tmp\\app');
  });

  it('parses --json flag', () => {
    const cli = parseScanArgs(['scan', '--json']);
    assert.equal(cli.json, true);
  });

  it('parses status and report actions', () => {
    assert.equal(parseScanArgs(['status']).action, 'status');
    assert.equal(parseScanArgs(['report']).action, 'report');
  });
});

describe('container-scan formatting', () => {
  it('formats results with severity summary', () => {
    const result: ScanResult = {
      tool: 'syft+grype',
      source: 'sbom.json',
      sbom: 'sbom.json',
      scannedAt: '2026-08-17T00:00:00.000Z',
      totalPackages: 464,
      vulnerabilities: [
        {
          id: 'CVE-2024-0001',
          severity: 'high',
          package: 'lodash',
          version: '1.2.2',
          fixVersion: '1.2.3',
          description: '',
          url: '',
        },
      ],
      bySeverity: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        negligible: 0,
        unknown: 0,
      },
      durationSeconds: 12.3,
      exitCode: 1,
      rawOutput: '',
    };
    const out = formatResults(result);
    assert.match(out, /syft\+grype/);
    assert.match(out, /CVE-2024-0001/);
    assert.match(out, /lodash@1\.2\.2/);
    assert.match(out, /fix: 1\.2\.3/);
  });

  it('reports no vulnerabilities when empty', () => {
    const result: ScanResult = {
      tool: 'syft+grype',
      source: 'sbom.json',
      sbom: 'sbom.json',
      scannedAt: '2026-08-17T00:00:00.000Z',
      totalPackages: 464,
      vulnerabilities: [],
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0, unknown: 0 },
      durationSeconds: 1,
      exitCode: 0,
      rawOutput: '',
    };
    assert.match(formatResults(result), /No vulnerabilities found/);
  });
});
