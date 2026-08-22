#!/usr/bin/env node

/**
 * Container & Artifact Vulnerability Scanner (native TypeScript)
 *
 * Escanea artefactos y SBOMs en busca de vulnerabilidades conocidas sin requerir
 * Docker. Usa la cadena nativa Syft (SBOM) + Grype (correlación CVE) cuando está
 * disponible, con fallback a Trivy filesystem. Complementa el SBOM generado en
 * release (`sbom.json`) y cubre el item "container image scanning" del roadmap
 * para entornos sin Docker (rootfs/artifacts/directorios).
 *
 * Comandos:
 *   npx tsx src/container-scan.ts scan                  # escanear sbom.json (default)
 *   npx tsx src/container-scan.ts scan --sbom <path>    # escanear SBOM específico
 *   npx tsx src/container-scan.ts scan-dir <dir>        # SBOM del dir + escaneo
 *   npx tsx src/container-scan.ts status                # estado de la toolchain
 *   npx tsx src/container-scan.ts report                # reporte del último scan
 *
 * Exit codes: 0 = sin vulnerabilidades al nivel exigido | 1 = vulns encontradas
 * | 2 = error de ejecución.
 *
 * Resultados persistidos en `.session/container-scan/latest.json`.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, '.session', 'container-scan');
const LATEST_FILE = join(SCAN_DIR, 'latest.json');
const LOG_FILE = join(SCAN_DIR, 'container-scan.log');
const DEFAULT_SBOM = join(ROOT, 'sbom.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'negligible' | 'unknown';

export interface ScanVulnerability {
  id: string;
  severity: Severity;
  package: string;
  version: string;
  fixVersion: string | null;
  description: string;
  url: string;
}

export interface ScanResult {
  tool: 'syft+grype' | 'trivy' | 'none';
  source: string;
  sbom: string | null;
  scannedAt: string;
  totalPackages: number;
  vulnerabilities: ScanVulnerability[];
  bySeverity: Record<string, number>;
  durationSeconds: number;
  exitCode: number;
  rawOutput: string;
}

export interface ScanCliArgs {
  action: 'scan' | 'scan-dir' | 'status' | 'report' | 'db-update' | 'help';
  sbom: string;
  dir: string;
  failOn: Severity;
  json: boolean;
}

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'negligible', 'unknown'];

export function severityRank(s: string): number {
  const idx = SEVERITY_ORDER.indexOf(s as Severity);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

export function compareSeverity(a: Severity, b: Severity): number {
  return severityRank(a) - severityRank(b);
}

// ---------------------------------------------------------------------------
// Toolchain helpers
// ---------------------------------------------------------------------------

function runTool(
  command: string,
  args: string[],
  timeoutMs = 120000,
): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(command, args, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    windowsHide: true,
    // Disable grype's network update checks — they can hang indefinitely when
    // the update URL is unreachable (observed on Windows). The local DB is
    // refreshed explicitly via `grype db update` (watchtower task).
    env: {
      ...process.env,
      GRYPE_DB_AUTO_UPDATE: 'false',
      GRYPE_CHECK_FOR_APP_UPDATE: 'false',
    },
  });
  return {
    stdout: (res.stdout ?? '') as string,
    stderr: (res.stderr ?? '') as string,
    code: res.status ?? (res.error ? 2 : 0),
  };
}

function toolAvailable(command: string): boolean {
  const res = runTool(command, ['--version'], 15000);
  return res.code === 0 && res.stdout.length > 0;
}

export interface ToolchainStatus {
  syft: boolean;
  grype: boolean;
  trivy: boolean;
  docker: boolean;
  sbomExists: boolean;
  grypeDbValid: boolean;
}

export function detectToolchain(): ToolchainStatus {
  return {
    syft: toolAvailable('syft'),
    grype: toolAvailable('grype'),
    trivy: toolAvailable('trivy'),
    docker: toolAvailable('docker'),
    sbomExists: existsSync(DEFAULT_SBOM),
    grypeDbValid: true,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse Grype JSON output (v1 format: matches[].vulnerability + artifact).
 * Los campos `namespace`/`type` varían entre versiones; este parser es tolerante.
 */
export function parseGrypeJson(jsonText: string): ScanVulnerability[] {
  try {
    const data = JSON.parse(jsonText) as {
      matches?: Array<{
        vulnerability?: {
          id?: string;
          severity?: string;
          fix?: { versions?: string[] };
          description?: string;
          urls?: string[];
        };
        artifact?: { name?: string; version?: string };
      }>;
    };
    const out: ScanVulnerability[] = [];
    for (const m of data.matches ?? []) {
      const v = m.vulnerability ?? {};
      const a = m.artifact ?? {};
      const fixVersions = v.fix?.versions;
      out.push({
        id: v.id ?? 'UNKNOWN',
        severity: (v.severity ?? 'unknown').toLowerCase() as Severity,
        package: a.name ?? 'unknown',
        version: a.version ?? '',
        fixVersion: fixVersions && fixVersions.length > 0 ? fixVersions.join(', ') : null,
        description: v.description ?? '',
        url: v.urls?.[0] ?? '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Parse Trivy filesystem JSON (Results[].Vulnerabilities[]). */
export function parseTrivyJson(jsonText: string): ScanVulnerability[] {
  try {
    const data = JSON.parse(jsonText) as {
      Results?: Array<{
        Vulnerabilities?: Array<{
          VulnerabilityID?: string;
          Severity?: string;
          PkgName?: string;
          InstalledVersion?: string;
          FixedVersion?: string;
          Description?: string;
          PrimaryURL?: string;
        }>;
      }>;
    };
    const out: ScanVulnerability[] = [];
    for (const r of data.Results ?? []) {
      for (const v of r.Vulnerabilities ?? []) {
        out.push({
          id: v.VulnerabilityID ?? 'UNKNOWN',
          severity: (v.Severity ?? 'unknown').toLowerCase() as Severity,
          package: v.PkgName ?? 'unknown',
          version: v.InstalledVersion ?? '',
          fixVersion: v.FixedVersion || null,
          description: v.Description ?? '',
          url: v.PrimaryURL ?? '',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function log(message: string): void {
  const ts = new Date().toISOString();
  try {
    mkdirSync(SCAN_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${ts}] ${message}\n`, 'utf-8');
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Core scan logic
// ---------------------------------------------------------------------------

function countBySeverity(vulns: ScanVulnerability[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const s of SEVERITY_ORDER) by[s] = 0;
  for (const v of vulns) by[v.severity] = (by[v.severity] ?? 0) + 1;
  return by;
}

export interface ScanOptions {
  sbomFile?: string;
  dir?: string;
  failOn?: Severity;
}

/**
 * Escanea un SBOM o un directorio. Orden de proveedores:
 *   1. syft + grype (SBOM → correlación CVE)
 *   2. trivy filesystem (fallback sin Syft)
 *   3. ninguno → resultado con exitCode 2 (error)
 */
export function scanArtifacts(options: ScanOptions = {}): ScanResult {
  const started = Date.now();
  const failOn = options.failOn ?? 'high';
  const sbomFile = options.sbomFile
    ? resolve(options.sbomFile)
    : existsSync(DEFAULT_SBOM)
      ? DEFAULT_SBOM
      : null;

  // Path 1: scan an existing SBOM with Grype
  if (sbomFile && existsSync(sbomFile) && toolAvailable('grype')) {
    const g = runTool('grype', [sbomFile, '-o', 'json', '--fail-on', failOn], 180000);
    const vulns = parseGrypeJson(g.stdout);
    const duration = (Date.now() - started) / 1000;
    const result: ScanResult = {
      tool: 'syft+grype',
      source: sbomFile,
      sbom: sbomFile,
      scannedAt: new Date().toISOString(),
      totalPackages: vulns.length > 0 || true ? countSbomPackages(sbomFile) : 0,
      vulnerabilities: vulns,
      bySeverity: countBySeverity(vulns),
      durationSeconds: Math.round(duration * 10) / 10,
      exitCode: g.code,
      rawOutput: g.stdout + g.stderr,
    };
    saveResult(result);
    return result;
  }

  // Path 1b: scan an existing SBOM with Trivy (fallback when Grype is unavailable
  // or hangs on its network update check). --skip-db-update avoids the network
  // fetch that hangs when the update URL is unreachable.
  if (sbomFile && existsSync(sbomFile) && toolAvailable('trivy')) {
    const t = runTool(
      'trivy',
      [
        'sbom',
        sbomFile,
        '--scanners',
        'vuln',
        '-f',
        'json',
        '--no-progress',
        '--quiet',
        '--skip-db-update',
      ],
      180000,
    );
    const vulns = parseTrivyJson(t.stdout);
    const duration = (Date.now() - started) / 1000;
    const result: ScanResult = {
      tool: 'trivy',
      source: sbomFile,
      sbom: sbomFile,
      scannedAt: new Date().toISOString(),
      totalPackages: countSbomPackages(sbomFile),
      vulnerabilities: vulns,
      bySeverity: countBySeverity(vulns),
      durationSeconds: Math.round(duration * 10) / 10,
      exitCode: t.code,
      rawOutput: t.stdout + t.stderr,
    };
    saveResult(result);
    return result;
  }

  // Path 2: generate SBOM from a directory with Syft, then scan with Grype
  const dir = options.dir ?? ROOT;
  if (existsSync(dir) && toolAvailable('syft') && toolAvailable('grype')) {
    const sbomGen = runTool('syft', ['dir:' + dir, '-o', 'cyclonedx-json', '--quiet'], 180000);
    if (sbomGen.code === 0 && sbomGen.stdout.trim().length > 0) {
      const tempSbom = join(SCAN_DIR, 'generated-sbom.json');
      mkdirSync(SCAN_DIR, { recursive: true });
      writeFileSync(tempSbom, sbomGen.stdout, 'utf-8');
      const g = runTool('grype', [tempSbom, '-o', 'json', '--fail-on', failOn], 180000);
      const vulns = parseGrypeJson(g.stdout);
      const duration = (Date.now() - started) / 1000;
      const result: ScanResult = {
        tool: 'syft+grype',
        source: dir,
        sbom: tempSbom,
        scannedAt: new Date().toISOString(),
        totalPackages: countSbomPackages(tempSbom),
        vulnerabilities: vulns,
        bySeverity: countBySeverity(vulns),
        durationSeconds: Math.round(duration * 10) / 10,
        exitCode: g.code,
        rawOutput: g.stdout + g.stderr + sbomGen.stderr,
      };
      saveResult(result);
      return result;
    }
  }

  // Path 3: Trivy filesystem fallback (--skip-db-update to avoid network hang)
  if (existsSync(dir) && toolAvailable('trivy')) {
    const t = runTool(
      'trivy',
      [
        'fs',
        '--scanners',
        'vuln',
        '-f',
        'json',
        '--no-progress',
        '--quiet',
        '--skip-db-update',
        dir,
      ],
      300000,
    );
    const vulns = parseTrivyJson(t.stdout);
    const duration = (Date.now() - started) / 1000;
    const result: ScanResult = {
      tool: 'trivy',
      source: dir,
      sbom: null,
      scannedAt: new Date().toISOString(),
      totalPackages: 0,
      vulnerabilities: vulns,
      bySeverity: countBySeverity(vulns),
      durationSeconds: Math.round(duration * 10) / 10,
      exitCode: t.code,
      rawOutput: t.stdout + t.stderr,
    };
    saveResult(result);
    return result;
  }

  const result: ScanResult = {
    tool: 'none',
    source: dir,
    sbom: null,
    scannedAt: new Date().toISOString(),
    totalPackages: 0,
    vulnerabilities: [],
    bySeverity: countBySeverity([]),
    durationSeconds: 0,
    exitCode: 2,
    rawOutput: 'No scanner toolchain available (syft/grype/trivy) and no SBOM found.',
  };
  saveResult(result);
  return result;
}

function countSbomPackages(sbomPath: string): number {
  try {
    const data = JSON.parse(readFileSync(sbomPath, 'utf-8')) as {
      components?: unknown[];
    };
    return data.components?.length ?? 0;
  } catch {
    return 0;
  }
}

function saveResult(result: ScanResult): void {
  try {
    mkdirSync(SCAN_DIR, { recursive: true });
    const { rawOutput, ...persisted } = result;
    writeFileSync(
      LATEST_FILE,
      JSON.stringify({ ...persisted, rawOutputPreview: rawOutput.slice(0, 500) }, null, 2),
      'utf-8',
    );
    log(
      `[scan] tool=${result.tool} source=${result.source} vulns=${result.vulnerabilities.length} ` +
        `critical=${result.bySeverity.critical} high=${result.bySeverity.high} exit=${result.exitCode}`,
    );
  } catch (err) {
    log(`[scan] failed to persist result: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatResults(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`Container/Artifact Scan — ${result.tool}`);
  lines.push(`  source:       ${result.source}`);
  lines.push(`  scannedAt:    ${result.scannedAt}`);
  lines.push(`  packages:     ${result.totalPackages}`);
  lines.push(`  duration:     ${result.durationSeconds}s`);
  lines.push(`  exitCode:     ${result.exitCode}`);
  lines.push('');
  lines.push('  by severity:');
  for (const s of SEVERITY_ORDER) {
    const n = result.bySeverity[s] ?? 0;
    if (n > 0 || s === 'critical' || s === 'high') {
      lines.push(`    ${s.padEnd(11)} ${n}`);
    }
  }
  const sorted = [...result.vulnerabilities].sort((a, b) =>
    compareSeverity(a.severity, b.severity),
  );
  if (sorted.length > 0) {
    lines.push('');
    lines.push(`  vulnerabilities (${sorted.length}):`);
    for (const v of sorted.slice(0, 25)) {
      const fix = v.fixVersion ? ` → fix: ${v.fixVersion}` : ' (no fix)';
      lines.push(`    [${v.severity.padEnd(9)}] ${v.id}  ${v.package}@${v.version}${fix}`);
    }
    if (sorted.length > 25) lines.push(`    ... and ${sorted.length - 25} more`);
  } else {
    lines.push('');
    lines.push('  No vulnerabilities found.');
  }
  return lines.join('\n');
}

export function printToolchainStatus(): string {
  const t = detectToolchain();
  const lines = [
    'Container Scan Toolchain:',
    `  syft:    ${t.syft ? 'available' : 'NOT available'}`,
    `  grype:   ${t.grype ? 'available' : 'NOT available'}`,
    `  trivy:   ${t.trivy ? 'available' : 'NOT available'}`,
    `  docker:  ${t.docker ? 'available' : 'NOT available'}`,
    `  sbom:    ${t.sbomExists ? 'present (sbom.json)' : 'not found'}`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseScanArgs(args: string[] = process.argv.slice(2)): ScanCliArgs {
  const first = args[0] ?? 'scan';
  const action = (
    ['scan', 'scan-dir', 'status', 'report', 'db-update', 'help'].includes(first) ? first : 'scan'
  ) as 'scan' | 'scan-dir' | 'status' | 'report' | 'db-update' | 'help';
  const parsed: ScanCliArgs = {
    action,
    sbom: DEFAULT_SBOM,
    dir: ROOT,
    failOn: 'high',
    json: false,
  };

  for (let i = action === first ? 1 : 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--sbom':
      case '-s':
        parsed.sbom = args[++i] ?? parsed.sbom;
        break;
      case '--dir':
      case '-d':
        parsed.dir = args[++i] ?? parsed.dir;
        break;
      case '--fail-on':
        parsed.failOn = (args[++i] ?? 'high') as Severity;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--help':
      case '-h':
        parsed.action = 'help';
        break;
      default:
        if (parsed.action === 'scan-dir' && parsed.dir === ROOT) parsed.dir = arg;
    }
  }
  return parsed;
}

export function printScanHelp(): void {
  console.log(`
Container/Artifact Vulnerability Scanner (native TypeScript)

Usage:
  npx tsx src/container-scan.ts scan [--sbom <path>] [--fail-on <sev>] [--json]
  npx tsx src/container-scan.ts scan-dir [<dir>] [--fail-on <sev>] [--json]
  npx tsx src/container-scan.ts status
  npx tsx src/container-scan.ts report
  npx tsx src/container-scan.ts db-update

Options:
  -s, --sbom <path>    SBOM file to scan (default: sbom.json)
  -d, --dir <dir>      Directory to generate SBOM from (default: project root)
      --fail-on <sev>  Exit 1 if any vuln >= this severity (default: high)
      --json           Output machine-readable JSON (stdout)
  -h, --help           Show this help

Exit codes: 0 = clean at fail-on level | 1 = vulnerabilities found | 2 = error
`);
}

function isMain(): boolean {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]).toLowerCase().endsWith('container-scan.ts')
  );
}

export function runScanCli(): number {
  const cli = parseScanArgs();

  if (cli.action === 'help') {
    printScanHelp();
    return 0;
  }
  if (cli.action === 'status') {
    console.log(printToolchainStatus());
    return 0;
  }
  if (cli.action === 'report') {
    if (!existsSync(LATEST_FILE)) {
      console.error('No scan result found. Run: npx tsx src/container-scan.ts scan');
      return 2;
    }
    const result = JSON.parse(readFileSync(LATEST_FILE, 'utf-8')) as ScanResult;
    console.log(formatResults(result));
    return 0;
  }
  if (cli.action === 'db-update') {
    if (!toolAvailable('grype')) {
      console.error('grype not available — cannot update vulnerability DB');
      return 2;
    }
    console.log('Updating grype vulnerability database (this may take a while)...');
    const u = runTool('grype', ['db', 'update'], 300000);
    if (u.code === 0) {
      console.log('grype DB updated successfully.');
      return 0;
    }
    console.error(`grype db update failed (exit ${u.code}): ${u.stderr.slice(0, 300)}`);
    return u.code === 2 ? 2 : 1;
  }

  const result = scanArtifacts({
    sbomFile: cli.action === 'scan' ? cli.sbom : undefined,
    dir: cli.dir,
    failOn: cli.failOn,
  });

  if (cli.json) {
    const clean = { ...result };
    delete (clean as { rawOutput?: string }).rawOutput;
    console.log(JSON.stringify(clean, null, 2));
  } else {
    console.log(formatResults(result));
  }

  return result.exitCode;
}

if (isMain()) {
  process.exit(runScanCli());
}
