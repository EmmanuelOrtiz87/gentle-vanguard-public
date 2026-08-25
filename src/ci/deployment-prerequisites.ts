import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

const digest = /^sha256:[a-f0-9]{64}$/i;
const contractSchema = z.object({
  version: z.string().min(1),
  imagePromotion: z.object({
    required: z.boolean(),
    manifestPath: z.string().min(1),
    requiredContainers: z.array(z.string().min(1)).min(1),
    digestInputs: z.record(z.string().min(1), z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  }),
  networkPolicy: z.object({
    required: z.boolean(),
    manifestPath: z.string().nullable(),
    requiredEvidence: z.array(z.string().min(1)).min(1),
  }),
  mcpSandbox: z.object({
    required: z.boolean(),
    policyPath: z.string().min(1),
    requiredEvidence: z.array(z.string().min(1)).min(1),
  }),
});

type Contract = z.infer<typeof contractSchema>;
export interface PrerequisiteFinding {
  rule: 'contract' | 'image-promotion' | 'network-policy' | 'mcp-sandbox' | 'external-input';
  severity: 'error' | 'warning' | 'ok';
  message: string;
}

export interface ValidationOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  contractPath?: string;
  networkPolicyPath?: string;
  promotion?: boolean;
}

interface K8sDocument {
  kind?: string;
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: {
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: { containers?: Array<{ name?: string; image?: string }> };
    };
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function externalInput(
  findings: PrerequisiteFinding[],
  name: string,
  purpose: string,
  env: NodeJS.ProcessEnv,
  mustBeTrue = false,
) {
  const value = env[name]?.trim();
  if (
    !value ||
    value.startsWith('<') ||
    value.startsWith('${') ||
    value.toUpperCase().startsWith('REPLACE')
  ) {
    findings.push({
      rule: 'external-input',
      severity: 'error',
      message: `missing external input ${name} (${purpose}); provide it in the promotion/cluster environment`,
    });
  } else {
    findings.push({
      rule: 'external-input',
      severity: 'ok',
      message: `external input ${name} provided`,
    });
    if (mustBeTrue && value.toLowerCase() !== 'true') {
      findings.push({
        rule: 'external-input',
        severity: 'error',
        message: `${name} must be exactly true; refusing to treat an unenforced control as satisfied`,
      });
    }
  }
  return value;
}

function validateNetworkPolicy(path: string, findings: PrerequisiteFinding[]) {
  if (!existsSync(path)) {
    findings.push({
      rule: 'network-policy',
      severity: 'error',
      message: `NetworkPolicy manifest not found: ${path}`,
    });
    return;
  }
  let policies = 0;
  try {
    yaml.loadAll(readFileSync(path, 'utf8')).forEach((raw) => {
      const doc = raw as K8sDocument;
      if (doc?.kind !== 'NetworkPolicy') return;
      policies++;
      const spec = doc.spec as
        (K8sDocument['spec'] & { podSelector?: unknown; policyTypes?: unknown[] }) | undefined;
      if (!spec?.podSelector || !Array.isArray(spec.policyTypes) || spec.policyTypes.length === 0) {
        findings.push({
          rule: 'network-policy',
          severity: 'error',
          message: `${doc.metadata?.name ?? 'NetworkPolicy'} must declare podSelector and policyTypes`,
        });
      }
    });
  } catch (error) {
    findings.push({
      rule: 'network-policy',
      severity: 'error',
      message: `invalid NetworkPolicy YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  if (policies === 0)
    findings.push({
      rule: 'network-policy',
      severity: 'error',
      message: `no NetworkPolicy document found in ${path}`,
    });
  else
    findings.push({
      rule: 'network-policy',
      severity: 'ok',
      message: `${policies} NetworkPolicy document(s) structurally valid; ingress/egress topology remains an operator input`,
    });
}

export function validateDeploymentPrerequisites(
  options: ValidationOptions = {},
): PrerequisiteFinding[] {
  const root = resolve(options.root ?? process.cwd());
  const env = options.env ?? process.env;
  const contractPath =
    options.contractPath ?? join(root, 'config', 'deployment-prerequisites.json');
  const findings: PrerequisiteFinding[] = [];
  let contract: Contract;
  try {
    contract = contractSchema.parse(readJson(contractPath));
  } catch (error) {
    findings.push({
      rule: 'contract',
      severity: 'error',
      message: `invalid prerequisite contract ${contractPath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return findings;
  }

  const imageManifest = join(root, contract.imagePromotion.manifestPath);
  if (contract.imagePromotion.required && !existsSync(imageManifest)) {
    findings.push({
      rule: 'image-promotion',
      severity: 'error',
      message: `image promotion manifest not found: ${imageManifest}`,
    });
  } else if (existsSync(imageManifest)) {
    const deployments = yaml
      .loadAll(readFileSync(imageManifest, 'utf8'))
      .filter((raw): raw is K8sDocument => (raw as K8sDocument)?.kind === 'Deployment');
    for (const component of contract.imagePromotion.requiredContainers) {
      const deployment = deployments.find(
        (doc) =>
          doc.metadata?.labels?.component === component ||
          doc.spec?.template?.metadata?.labels?.component === component,
      );
      const container =
        deployment?.spec?.template?.spec?.containers?.find((entry) => entry.name === component) ??
        deployment?.spec?.template?.spec?.containers?.[0];
      if (!container?.image) {
        findings.push({
          rule: 'image-promotion',
          severity: 'error',
          message: `missing image for required component ${component}`,
        });
      } else if (!/@sha256:[a-f0-9]{64}$/i.test(container.image)) {
        findings.push({
          rule: 'image-promotion',
          severity: options.promotion ? 'error' : 'warning',
          message: `${component} image is not digest-pinned in rendered manifest (${container.image})`,
        });
      } else {
        findings.push({
          rule: 'image-promotion',
          severity: 'ok',
          message: `${component} image is digest-pinned`,
        });
      }
      const input = contract.imagePromotion.digestInputs[component];
      if (options.promotion && input) {
        const value = externalInput(findings, input, `immutable ${component} image reference`, env);
        if (value && !digest.test(value))
          findings.push({
            rule: 'image-promotion',
            severity: 'error',
            message: `${input} must contain only sha256:<64 hex characters>`,
          });
        if (
          value &&
          digest.test(value) &&
          container?.image &&
          !container.image.endsWith(`@${value}`)
        ) {
          findings.push({
            rule: 'image-promotion',
            severity: 'error',
            message: `${component} rendered image digest does not match ${input}`,
          });
        }
      }
    }
  }

  for (const input of contract.networkPolicy.requiredEvidence)
    externalInput(
      findings,
      input,
      'cluster NetworkPolicy enforcement evidence',
      env,
      input.endsWith('_ENFORCED'),
    );
  const policyPath =
    options.networkPolicyPath ??
    (contract.networkPolicy.manifestPath
      ? join(root, contract.networkPolicy.manifestPath)
      : undefined);
  if (!policyPath)
    findings.push({
      rule: 'external-input',
      severity: 'error',
      message:
        'missing external input NetworkPolicy manifest path/content; set --network-policy after topology is approved',
    });
  else validateNetworkPolicy(resolve(root, policyPath), findings);

  const mcpPolicyPath = join(root, contract.mcpSandbox.policyPath);
  if (!existsSync(mcpPolicyPath))
    findings.push({
      rule: 'mcp-sandbox',
      severity: 'error',
      message: `MCP execution policy not found: ${mcpPolicyPath}`,
    });
  else {
    try {
      const policy = readJson(mcpPolicyPath) as {
        skills?: Record<string, { network?: boolean; filesystem?: string }>;
      };
      for (const [skill, entry] of Object.entries(policy.skills ?? {})) {
        if (entry.network !== false || entry.filesystem !== 'workspace')
          findings.push({
            rule: 'mcp-sandbox',
            severity: 'error',
            message: `MCP skill ${skill} must explicitly set network:false and filesystem:workspace`,
          });
      }
      findings.push({
        rule: 'mcp-sandbox',
        severity: 'ok',
        message: 'MCP execution policy is present and does not enable unsafe defaults',
      });
    } catch (error) {
      findings.push({
        rule: 'mcp-sandbox',
        severity: 'error',
        message: `invalid MCP execution policy: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  for (const input of contract.mcpSandbox.requiredEvidence)
    externalInput(
      findings,
      input,
      'MCP OS sandbox/provider enforcement evidence',
      env,
      input.endsWith('_ENFORCED'),
    );
  return findings;
}

function main() {
  const json = process.argv.includes('--json');
  const report = process.argv.includes('--report');
  const promotion = process.argv.includes('--promotion');
  const policyArg = process.argv.indexOf('--network-policy');
  const networkPolicyPath = policyArg >= 0 ? process.argv[policyArg + 1] : undefined;
  const findings = validateDeploymentPrerequisites({ promotion, networkPolicyPath });
  if (json)
    console.log(
      JSON.stringify({ valid: !findings.some((f) => f.severity === 'error'), findings }, null, 2),
    );
  else
    findings.forEach((finding) =>
      console.log(`${finding.severity.toUpperCase()} [${finding.rule}] ${finding.message}`),
    );
  if (!report && findings.some((finding) => finding.severity === 'error')) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/deployment-prerequisites.ts')) main();
