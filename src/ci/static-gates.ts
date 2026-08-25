import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as yaml from 'js-yaml';

export interface GateFinding {
  rule: 'image' | 'production-env' | 'generated-artifact';
  severity: 'error' | 'warning';
  message: string;
}

interface KubernetesContainer {
  name?: string;
  image?: string;
  env?: Array<{
    name?: string;
    value?: string;
    valueFrom?: { secretKeyRef?: { optional?: boolean } };
  }>;
}

interface KubernetesDocument {
  kind?: string;
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: {
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: { containers?: KubernetesContainer[] };
    };
  };
}

const GENERATED_PATHS = [
  /^dist\//,
  /^build\/(?!.*\.(?:ts|md)$)/,
  /^graphify-out\//,
  /^coverage\//,
  /^\.runtime\//,
  /^\.session\//,
  /^sbom(?:\.json|\/)/,
  /^update-manifest\.json$/,
];

function isImmutableImage(image: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(image.trim());
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return (
    normalized.startsWith('${') ||
    normalized.startsWith('<') ||
    normalized === 'REPLACE' ||
    normalized === 'CHANGE_ME' ||
    normalized.startsWith('REPLACE_') ||
    normalized.startsWith('CHANGE_ME_')
  );
}

export function inspectKubernetesManifest(content: string): GateFinding[] {
  const findings: GateFinding[] = [];
  yaml.loadAll(content).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const doc = raw as KubernetesDocument;
    if (doc.kind !== 'Deployment') return;
    const template = doc.spec?.template;
    const containers = template?.spec?.containers ?? [];
    const labels = { ...(doc.metadata?.labels ?? {}), ...(template?.metadata?.labels ?? {}) };
    const authSensitive = ['dashboard', 'websocket'].includes(labels.component ?? '');
    const production = containers.some((container) =>
      container.env?.some((entry) => entry.name === 'NODE_ENV' && entry.value === 'production'),
    );

    for (const container of containers) {
      if (!container.image) {
        findings.push({
          rule: 'image',
          severity: 'error',
          message: `${doc.metadata?.name ?? 'Deployment'}/${container.name ?? 'container'} has no image`,
        });
      } else if (!isImmutableImage(container.image)) {
        findings.push({
          rule: 'image',
          severity: 'warning',
          message: `${doc.metadata?.name ?? 'Deployment'}/${container.name ?? 'container'} uses mutable image "${container.image}"; release rendering must provide a sha256 digest`,
        });
      }
    }

    if (production && authSensitive) {
      const env = new Map(
        containers.flatMap((container) => container.env ?? []).map((entry) => [entry.name, entry]),
      );
      const tenant = env.get('GENTLE_TENANT_ID');
      if (!tenant?.value?.trim() || isPlaceholder(tenant.value)) {
        findings.push({
          rule: 'production-env',
          severity: 'error',
          message: `${doc.metadata?.name ?? 'Deployment'} requires a concrete GENTLE_TENANT_ID in production`,
        });
      }
      const token = env.get('GV_DASHBOARD_TOKEN');
      if (!token?.valueFrom?.secretKeyRef || token.valueFrom.secretKeyRef.optional === true) {
        findings.push({
          rule: 'production-env',
          severity: 'error',
          message: `${doc.metadata?.name ?? 'Deployment'} requires GV_DASHBOARD_TOKEN from a non-optional Secret in production`,
        });
      }
    }
  });
  return findings;
}

export function trackedGeneratedArtifacts(root = process.cwd()): string[] {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
    return output
      .split('\0')
      .filter((file) => file && GENERATED_PATHS.some((pattern) => pattern.test(file)));
  } catch {
    return [];
  }
}

export function inspectGeneratedArtifactHygiene(root = process.cwd()): GateFinding[] {
  return trackedGeneratedArtifacts(root).map((file) => ({
    rule: 'generated-artifact' as const,
    severity: 'error' as const,
    message: `generated/runtime artifact is tracked: ${file}`,
  }));
}

function main(): void {
  const root = resolve(process.cwd());
  const manifestPath = join(root, 'config', 'k8s', 'gentle-vanguard-deployment.yml');
  const strictImages = process.argv.includes('--strict-images');
  const reportOnly = process.argv.includes('--report');
  const findings = [
    ...(existsSync(manifestPath)
      ? inspectKubernetesManifest(readFileSync(manifestPath, 'utf8'))
      : [
          {
            rule: 'production-env' as const,
            severity: 'error' as const,
            message: `Kubernetes manifest not found: ${manifestPath}`,
          },
        ]),
    ...inspectGeneratedArtifactHygiene(root),
  ];
  const effective = findings.filter(
    (finding) => finding.severity === 'error' || (strictImages && finding.rule === 'image'),
  );
  for (const finding of findings)
    console.log(`${finding.severity.toUpperCase()} [${finding.rule}] ${finding.message}`);
  if (!findings.some((finding) => finding.rule === 'image'))
    console.log('OK [image] no Kubernetes images found');
  if (!findings.some((finding) => finding.rule === 'generated-artifact'))
    console.log('OK [generated-artifact] no generated artifacts are tracked');
  if (effective.length > 0 && !reportOnly) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/static-gates.ts')) main();
