#!/usr/bin/env node
/**
 * SLSA Provenance Generator (native TypeScript)
 *
 * Generates in-toto v1 attestation statements with SLSA v1.0 provenance predicate
 * (https://slsa.dev/spec/v1.0/provenance) for built artifacts, satisfying
 * SLSA Build L1 provenance generation without external tooling (cosign/slsa-verifier).
 *
 * Usage:
 *   npx tsx src/slsa-provenance.ts generate --artifacts sbom/gentle-vanguard-sbom.json
 *   npx tsx src/slsa-provenance.ts verify --file provenance/gentle-vanguard-provenance.json
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';

// ---------------------------------------------------------------------------
// Types (SLSA v1.0 + in-toto v1)
// ---------------------------------------------------------------------------

export interface ResourceDescriptor {
  uri: string;
  digest?: Record<string, string>;
  name?: string;
  downloadLocation?: string;
  mediaType?: string;
  content?: string; // base64-encoded
  annotations?: Record<string, unknown>;
}

export interface BuildDefinition {
  buildType: string;
  externalParameters: Record<string, unknown>;
  internalParameters?: Record<string, unknown>;
  resolvedDependencies?: ResourceDescriptor[];
}

export interface BuildMetadata {
  invocationId?: string;
  startedOn?: string;
  finishedOn?: string;
}

export interface Builder {
  id: string;
  version?: Record<string, string>;
  builderDependencies?: ResourceDescriptor[];
}

export interface RunDetails {
  builder: Builder;
  metadata?: BuildMetadata;
  byproducts?: ResourceDescriptor[];
}

export interface ProvenancePredicate {
  buildDefinition: BuildDefinition;
  runDetails: RunDetails;
}

export interface InTotoStatement {
  _type: string;
  subject: ResourceDescriptor[];
  predicateType: string;
  predicate: ProvenancePredicate;
}

export interface ProvenanceOptions {
  artifacts: string[];
  buildType: string;
  builderId: string;
  builderVersion?: Record<string, string>;
  repoUrl?: string;
  gitCommit?: string;
  gitRef?: string;
  invocationId?: string;
  environment?: Record<string, string>;
  output: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IN_TOTO_STATEMENT_V1 = 'https://in-toto.io/Statement/v1';
export const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
export const DEFAULT_BUILD_TYPE = 'https://github.com/gentle-vanguard/gentle-vanguard@v1';
export const DEFAULT_BUILDER_ID =
  'https://github.com/gentle-vanguard/gentle-vanguard/.github/workflows/ci.yml';
export const DEFAULT_OUTPUT = 'provenance/gentle-vanguard-provenance.json';

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Compute SHA-256 digest of a file. */
export function sha256Digest(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/** Compute SHA-256 digest of a string (e.g. repo URL + commit). */
export function sha256Of(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Format a Date as RFC3339 UTC timestamp (<YYYY>-<MM>-<DD>T<hh>:<mm>:<ss>Z). */
export function toTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Get the current git commit SHA from .git/HEAD (or empty string). */
export function detectGitCommit(): string {
  try {
    const headFile = '.git/HEAD';
    if (!existsSync(headFile)) return '';
    const head = readFileSync(headFile, 'utf-8').trim();
    if (head.startsWith('ref: ')) {
      const refPath = head.slice(5).trim().replace(/\//g, '\\');
      const ref = `.git\\${refPath}`;
      if (existsSync(ref)) return readFileSync(ref, 'utf-8').trim();
      return '';
    }
    return head;
  } catch {
    return '';
  }
}

/** Detect the git remote origin URL (best effort). */
export function detectRepoUrl(): string {
  try {
    const config = '.git/config';
    if (!existsSync(config)) return '';
    const content = readFileSync(config, 'utf-8');
    const match = content.match(/\[remote "origin"\]\s*\n\s*url\s*=\s*(.+)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/** Detect the current git branch/ref (best effort). */
export function detectGitRef(): string {
  try {
    const headFile = '.git/HEAD';
    if (!existsSync(headFile)) return '';
    const head = readFileSync(headFile, 'utf-8').trim();
    if (head.startsWith('ref: ')) return head.slice(5).trim();
    return head;
  } catch {
    return '';
  }
}

/** Build a ResourceDescriptor for one artifact file. */
export function artifactDescriptor(filePath: string, repoUrl?: string): ResourceDescriptor {
  const name = basename(filePath);
  return {
    name,
    uri: repoUrl ? `${repoUrl}#${name}` : `file://${filePath.replace(/\\/g, '/')}`,
    digest: { sha256: sha256Digest(filePath) },
    mediaType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
  };
}

/** Build a full in-toto v1 statement with SLSA v1.0 provenance predicate. */
export function buildProvenance(options: ProvenanceOptions): InTotoStatement {
  const startedOn = new Date();
  const finishedOn = new Date(startedOn.getTime());

  const repoUrl = options.repoUrl ?? detectRepoUrl() ?? '';
  const gitCommit = options.gitCommit ?? detectGitCommit() ?? '';
  const gitRef = options.gitRef ?? detectGitRef() ?? '';
  const invocationId =
    options.invocationId ?? `${basename(process.cwd())}-${toTimestamp(startedOn)}`;

  const resolvedDependencies: ResourceDescriptor[] = [];
  if (repoUrl) {
    const dep: ResourceDescriptor = { uri: repoUrl };
    if (gitCommit) dep.digest = { gitCommit };
    if (gitRef) dep.name = gitRef;
    resolvedDependencies.push(dep);
  }

  return {
    _type: IN_TOTO_STATEMENT_V1,
    subject: options.artifacts.map((a) => artifactDescriptor(a, repoUrl)),
    predicateType: SLSA_PROVENANCE_V1,
    predicate: {
      buildDefinition: {
        buildType: options.buildType,
        externalParameters: {
          ...(repoUrl ? { repository: repoUrl } : {}),
          ...(gitRef ? { ref: gitRef } : {}),
        },
        internalParameters: options.environment
          ? { environment: options.environment }
          : { environment: { node: process.version } },
        resolvedDependencies,
      },
      runDetails: {
        builder: {
          id: options.builderId,
          ...(options.builderVersion
            ? { version: options.builderVersion }
            : { version: { 'gentle-vanguard': '3.8.1' } }),
        },
        metadata: {
          invocationId,
          startedOn: toTimestamp(startedOn),
          finishedOn: toTimestamp(finishedOn),
        },
      },
    },
  };
}

/**
 * Validate a provenance statement against SLSA Build L1 requirements.
 * Returns array of error strings (empty = valid).
 */
export function validateProvenance(statement: InTotoStatement): string[] {
  const errors: string[] = [];

  if (statement._type !== IN_TOTO_STATEMENT_V1) {
    errors.push(`_type must be ${IN_TOTO_STATEMENT_V1}`);
  }
  if (statement.predicateType !== SLSA_PROVENANCE_V1) {
    errors.push(`predicateType must be ${SLSA_PROVENANCE_V1}`);
  }
  if (!Array.isArray(statement.subject) || statement.subject.length === 0) {
    errors.push('subject must be a non-empty array');
  } else {
    statement.subject.forEach((s, i) => {
      if (!s.uri) errors.push(`subject[${i}].uri is required`);
      if (!s.digest || !s.digest.sha256) errors.push(`subject[${i}].digest.sha256 is required`);
    });
  }

  const bd = statement.predicate?.buildDefinition;
  if (!bd) {
    errors.push('predicate.buildDefinition is required (SLSA Build L1)');
  } else {
    if (!bd.buildType) errors.push('buildDefinition.buildType is required');
    if (!bd.externalParameters || typeof bd.externalParameters !== 'object') {
      errors.push('buildDefinition.externalParameters is required');
    }
  }

  const rd = statement.predicate?.runDetails;
  if (!rd) {
    errors.push('predicate.runDetails is required (SLSA Build L1)');
  } else {
    if (!rd.builder?.id) errors.push('runDetails.builder.id is required');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliArgs {
  action: 'generate' | 'verify';
  artifacts: string[];
  buildType: string;
  builderId: string;
  repoUrl?: string;
  gitCommit?: string;
  gitRef?: string;
  invocationId?: string;
  environment?: string;
  output: string;
  file: string;
}

export function parseArgs(args: string[] = process.argv.slice(2)): CliArgs {
  const action = (args[0] === 'generate' || args[0] === 'verify' ? args[0] : 'generate') as
    'generate' | 'verify';
  const parsed: CliArgs = {
    action,
    artifacts: [],
    buildType: DEFAULT_BUILD_TYPE,
    builderId: DEFAULT_BUILDER_ID,
    output: DEFAULT_OUTPUT,
    file: DEFAULT_OUTPUT,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--artifacts':
      case '-a':
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          parsed.artifacts.push(args[++i]);
        }
        break;
      case '--build-type':
        parsed.buildType = args[++i];
        break;
      case '--builder-id':
        parsed.builderId = args[++i];
        break;
      case '--repo':
        parsed.repoUrl = args[++i];
        break;
      case '--commit':
        parsed.gitCommit = args[++i];
        break;
      case '--ref':
        parsed.gitRef = args[++i];
        break;
      case '--invocation-id':
        parsed.invocationId = args[++i];
        break;
      case '--env':
        parsed.environment = args[++i];
        break;
      case '--output':
      case '-o':
        parsed.output = args[++i];
        parsed.file = parsed.output;
        break;
      case '--file':
      case '-f':
        parsed.file = args[++i];
        break;
      case '--help':
      case '-h':
        parsed.action = 'generate';
        break;
    }
  }

  return parsed;
}

/** Parse an --env string like "key=value,key2=value2" into an object. */
export function parseEnvironment(raw?: string): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [k, ...v] = pair.split('=');
    if (k) result[k.trim()] = v.join('=').trim();
  }
  return result;
}

export function printHelp(): void {
  console.log(`
SLSA Provenance Generator (native TypeScript)

Usage:
  npx tsx src/slsa-provenance.ts generate [options]   # build provenance statement
  npx tsx src/slsa-provenance.ts verify -f <file>     # validate an existing statement

Options:
  -a, --artifacts <files...>   Artifact files to attest (comma/space separated)
      --build-type <uri>       buildType (default: ${DEFAULT_BUILD_TYPE})
      --builder-id <uri>       builder.id (default: ${DEFAULT_BUILDER_ID})
      --repo <url>             Repository URL (auto-detected from .git)
      --commit <sha>           Git commit SHA (auto-detected from .git)
      --ref <ref>              Git ref/branch (auto-detected from .git)
      --env <k=v,k2=v2>        Environment metadata for internalParameters
  -o, --output <path>          Output path (default: ${DEFAULT_OUTPUT})
  -f, --file <path>            File to verify
  -h, --help                   Show this help
`);
}

function runGenerate(cli: CliArgs): boolean {
  if (cli.artifacts.length === 0) {
    console.error('ERROR: no artifacts specified (use -a <file> ...)');
    return false;
  }
  for (const artifact of cli.artifacts) {
    if (!existsSync(artifact)) {
      console.error(`ERROR: artifact not found: ${artifact}`);
      return false;
    }
  }

  const env = parseEnvironment(cli.environment);
  const statement = buildProvenance({
    artifacts: cli.artifacts,
    buildType: cli.buildType,
    builderId: cli.builderId,
    repoUrl: cli.repoUrl,
    gitCommit: cli.gitCommit,
    gitRef: cli.gitRef,
    invocationId: cli.invocationId,
    environment: env,
    output: cli.output,
  });

  const errors = validateProvenance(statement);
  if (errors.length > 0) {
    console.error('ERROR: generated statement failed validation:');
    for (const e of errors) console.error(`  - ${e}`);
    return false;
  }

  const outputPath = resolve(cli.output);
  const outputDir = outputPath.slice(
    0,
    Math.max(outputPath.lastIndexOf('\\'), outputPath.lastIndexOf('/')),
  );
  if (outputDir) mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(statement, null, 2) + '\n', 'utf-8');

  console.log(`[OK] SLSA provenance generated (${cli.artifacts.length} artifact(s))`);
  console.log(`     predicateType: ${SLSA_PROVENANCE_V1}`);
  console.log(`     builder:       ${cli.builderId}`);
  for (const s of statement.subject) {
    console.log(`     subject:       ${s.name} (sha256:${s.digest?.sha256?.slice(0, 12)}...)`);
  }
  console.log(`     output:        ${outputPath}`);
  return true;
}

function runVerify(cli: CliArgs): boolean {
  if (!existsSync(cli.file)) {
    console.error(`ERROR: file not found: ${cli.file}`);
    return false;
  }
  let statement: InTotoStatement;
  try {
    statement = JSON.parse(readFileSync(cli.file, 'utf-8'));
  } catch (err) {
    console.error(`ERROR: invalid JSON: ${(err as Error).message}`);
    return false;
  }

  const errors = validateProvenance(statement);
  if (errors.length > 0) {
    console.error('[FAIL] SLSA provenance validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    return false;
  }

  console.log(`[OK] Valid SLSA Build L1 provenance: ${cli.file}`);
  console.log(`     subject count: ${statement.subject.length}`);
  console.log(`     buildType:     ${statement.predicate.buildDefinition.buildType}`);
  console.log(`     builder.id:    ${statement.predicate.runDetails.builder.id}`);
  return true;
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase().endsWith('slsa-provenance.ts');

if (isDirectRun) {
  const cli = parseArgs();
  if (cli.action === 'verify') {
    process.exitCode = runVerify(cli) ? 0 : 1;
  } else {
    process.exitCode = runGenerate(cli) ? 0 : 1;
  }
}
