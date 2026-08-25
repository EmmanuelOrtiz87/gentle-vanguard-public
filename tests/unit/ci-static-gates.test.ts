import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectKubernetesManifest } from '../../src/ci/static-gates.ts';

const valid = (image: string, extra = '') => `
apiVersion: apps/v1
kind: Deployment
metadata: { name: dashboard, labels: { component: dashboard } }
spec:
  template:
    metadata: { labels: { component: dashboard } }
    spec:
      containers:
        - name: dashboard
          image: ${image}
          env:
            - { name: NODE_ENV, value: production }
            - { name: GENTLE_TENANT_ID, value: tenant-a }
            - name: GV_DASHBOARD_TOKEN
              valueFrom: { secretKeyRef: { name: dashboard-secret, key: GV_DASHBOARD_TOKEN, optional: false } }
          ${extra}
`;

describe('CI static deployment gates', () => {
  it('accepts a rendered digest and required production auth/tenant inputs', () => {
    assert.deepEqual(
      inspectKubernetesManifest(valid(`registry.example/app@sha256:${'a'.repeat(64)}`)),
      [],
    );
  });

  it('reports mutable image references without fabricating a digest', () => {
    const findings = inspectKubernetesManifest(valid('registry.example/app:latest'));
    assert.equal(findings.filter((finding) => finding.rule === 'image').length, 1);
    assert.equal(findings[0].severity, 'warning');
    assert.match(findings[0].message, /release rendering/);
  });

  it('fails missing production auth and tenant configuration', () => {
    const findings = inspectKubernetesManifest(
      valid('registry.example/app@sha256:' + 'b'.repeat(64))
        .replace('value: tenant-a', '')
        .replace(
          'valueFrom: { secretKeyRef: { name: dashboard-secret, key: GV_DASHBOARD_TOKEN, optional: false } }',
          '',
        ),
    );
    assert.equal(findings.filter((finding) => finding.rule === 'production-env').length, 2);
    assert.ok(findings.every((finding) => finding.severity === 'error'));
  });
});
