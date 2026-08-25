import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateDeploymentPrerequisites } from '../../src/ci/deployment-prerequisites.ts';

describe('deployment prerequisite contract', () => {
  it('reports missing registry, CNI, and sandbox evidence without inventing values', () => {
    const findings = validateDeploymentPrerequisites({ env: {} });
    const messages = findings.map((finding) => finding.message).join('\n');
    assert.match(messages, /GV_K8S_CNI_PROVIDER/);
    assert.match(messages, /GV_MCP_SANDBOX_PROVIDER/);
    assert.match(messages, /NetworkPolicy manifest path\/content/);
    assert.doesNotMatch(messages, /docker\.io|calico|cilium|gvisor|firecracker/);
  });

  it('accepts approved external evidence and a structurally valid policy supplied by the operator', () => {
    const env = {
      GV_K8S_CNI_PROVIDER: 'operator-supplied-cni',
      GV_K8S_NETWORKPOLICY_ENFORCED: 'true',
      GV_MCP_SANDBOX_PROVIDER: 'operator-supplied-runtime',
      GV_MCP_SANDBOX_ENFORCED: 'true',
      GV_MCP_SANDBOX_WORKSPACE: 'operator-supplied-workspace',
    };
    const findings = validateDeploymentPrerequisites({
      env,
      networkPolicyPath: 'tests/fixtures/valid-network-policy.yml',
    });
    assert.equal(
      findings.some((finding) => finding.rule === 'network-policy' && finding.severity === 'error'),
      false,
    );
    assert.equal(
      findings.filter(
        (finding) => finding.rule === 'external-input' && finding.severity === 'error',
      ).length,
      0,
    );
  });

  it('does not accept false enforcement evidence', () => {
    const findings = validateDeploymentPrerequisites({
      env: {
        GV_K8S_CNI_PROVIDER: 'operator-supplied-cni',
        GV_K8S_NETWORKPOLICY_ENFORCED: 'false',
        GV_MCP_SANDBOX_PROVIDER: 'operator-supplied-runtime',
        GV_MCP_SANDBOX_ENFORCED: 'false',
        GV_MCP_SANDBOX_WORKSPACE: 'operator-supplied-workspace',
      },
      networkPolicyPath: 'tests/fixtures/valid-network-policy.yml',
    });
    assert.ok(findings.some((finding) => finding.message.includes('must be exactly true')));
  });
});
