import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PolicyEngine,
  evaluateCondition,
  loadDefaultConfig,
} from '../../src/security/policy-engine/policy-engine.js';

describe('policy-engine', () => {
  describe('evaluateCondition', () => {
    it('evaluates membership (in)', () => {
      assert.ok(evaluateCondition("action.type in ['delete', 'drop']", { type: 'delete' }));
      assert.ok(!evaluateCondition("action.type in ['delete', 'drop']", { type: 'read' }));
    });

    it('evaluates negation (not in)', () => {
      assert.ok(evaluateCondition("action.type not in ['delete']", { type: 'read' }));
      assert.ok(!evaluateCondition("action.type not in ['delete']", { type: 'delete' }));
    });

    it('evaluates equality (==)', () => {
      assert.ok(evaluateCondition("action.type == 'send_email'", { type: 'send_email' }));
      assert.ok(!evaluateCondition("action.type == 'send_email'", { type: 'read' }));
    });

    it('evaluates regex match', () => {
      assert.ok(
        evaluateCondition("action.target matches '(^|/)(\\.env)(/|$)'", {
          type: 'read',
          target: '/project/.env',
        }),
      );
      assert.ok(
        !evaluateCondition("action.target matches '(^|/)(\\.env)(/|$)'", {
          type: 'read',
          target: '/project/src/index.ts',
        }),
      );
    });

    it('evaluates boolean combinators (and/or)', () => {
      assert.ok(
        evaluateCondition("action.type == 'delete' and action.target == '/tmp/x'", {
          type: 'delete',
          target: '/tmp/x',
        }),
      );
      assert.ok(
        !evaluateCondition("action.type == 'delete' and action.target == '/tmp/x'", {
          type: 'delete',
          target: '/tmp/y',
        }),
      );
      assert.ok(
        evaluateCondition("action.type == 'a' or action.type == 'b'", { type: 'b' }),
      );
    });

    it('fails closed on unsupported predicates', () => {
      assert.ok(!evaluateCondition('action.type > 5', { type: 'delete' }));
    });
  });

  describe('PolicyEngine', () => {
    it('denies destructive operations (fail closed)', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate({ type: 'delete', target: '/tmp/x' });
      assert.ok(result.denied);
      assert.ok(!result.allowed);
    });

    it('denies credential file access', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate({ type: 'read', target: '/project/.env' });
      assert.ok(result.denied);
    });

    it('requires approval for external sends', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate({ type: 'send_email', target: 'user@example.com' });
      assert.ok(result.requiresApproval);
      assert.ok(!result.allowed);
    });

    it('allows safe operations', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate({ type: 'read', target: '/project/src/index.ts' });
      assert.ok(result.allowed);
    });

    it('denies unknown MCP tools (allowlist)', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate({ type: 'mcp_tool', tool: 'drop_table' });
      assert.ok(result.denied);
    });

    it('allows allowlisted MCP tools', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate({ type: 'mcp_tool', tool: 'list_skills' });
      assert.ok(result.allowed);
    });

    it('loads default config from disk', () => {
      const config = loadDefaultConfig();
      assert.ok(config.policies.length > 0);
      assert.ok(config.failClosed);
    });
  });
});
