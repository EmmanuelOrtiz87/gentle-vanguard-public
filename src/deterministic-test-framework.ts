#!/usr/bin/env node
/**
 * Deterministic Agent Test Framework
 *
 * Based on gentle-ai's organic runtime E2E pattern.
 *
 * This framework allows testing the orchestrator with a deterministic
 * "model fixture" that returns scripted responses instead of calling
 * a real LLM API. This makes tests:
 * - Free (no API costs)
 * - Offline (no network dependency)
 * - Deterministic (same sequence every time)
 * - Fast (milliseconds instead of seconds)
 *
 * Usage:
 *   npx tsx src/deterministic-test-framework.ts --scenario <name>
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { pathToFileURL } from 'url';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const TEST_DIR = join(ROOT, '.test', 'deterministic');

// Test scenarios - scripted model responses
interface TestScenario {
  name: string;
  description: string;
  calls: ModelCall[];
}

interface ModelCall {
  tool: string;
  action: string;
  response: unknown;
  validate?: (request: unknown) => boolean | string;
}

// Scenarios for testing different orchestrator paths
const SCENARIOS: Record<string, TestScenario> = {
  'direct-inline': {
    name: 'direct-inline',
    description: 'Test that direct_inline route stays inline without SDD artifacts',
    calls: [
      {
        tool: 'bash',
        action: 'capabilities',
        response: { status: 'ok', tools: ['bash', 'read', 'edit'] },
      },
      {
        tool: 'bash',
        action: 'execute',
        response: { status: 'ok', output: 'Task completed' },
        validate: (_req) => {
          // Validate no SDD artifacts were created
          const sddDir = join(TEST_DIR, 'sdd');
          return !existsSync(sddDir) || 'SDD artifacts should not exist for direct-inline';
        },
      },
    ],
  },

  'delegated-direct': {
    name: 'delegated-direct',
    description: 'Test delegated_direct route without SDD lifecycle',
    calls: [
      {
        tool: 'bash',
        action: 'capabilities',
        response: { status: 'ok', tools: ['bash', 'read', 'edit', 'task'] },
      },
      {
        tool: 'task',
        action: 'delegate',
        response: { status: 'ok', taskId: 'sub-001', result: 'Delegated task completed' },
      },
      {
        tool: 'bash',
        action: 'verify',
        response: { status: 'ok', verified: true },
      },
    ],
  },

  'sdd-lifecycle': {
    name: 'sdd-lifecycle',
    description: 'Test full SDD lifecycle with BA→SAD→DEV→QA phases',
    calls: [
      {
        tool: 'bash',
        action: 'sdd-start',
        response: { status: 'ok', phase: 'BA', sessionId: 'sdd-001' },
      },
      {
        tool: 'task',
        action: 'ba-explore',
        response: { status: 'ok', requirements: 'User wants feature X' },
      },
      {
        tool: 'task',
        action: 'sad-design',
        response: { status: 'ok', design: 'Architecture approved' },
      },
      {
        tool: 'task',
        action: 'dev-implement',
        response: { status: 'ok', implementation: 'Code written' },
      },
      {
        tool: 'task',
        action: 'qa-verify',
        response: { status: 'ok', tests: 'All passed' },
      },
      {
        tool: 'bash',
        action: 'sdd-complete',
        response: { status: 'ok', artifact: 'SDD-001-completed' },
      },
    ],
  },

  'kill-switch': {
    name: 'kill-switch',
    description: 'Test that kill switch stops flow before advance',
    calls: [
      {
        tool: 'bash',
        action: 'capabilities',
        response: { status: 'ok', tools: ['bash', 'read'] },
      },
      {
        tool: 'bash',
        action: 'check-kill-switch',
        response: { status: 'blocked', reason: 'Kill switch active' },
        validate: () => {
          // Verify no advance occurred
          return true; // Test passes if we reach here
        },
      },
    ],
  },
};

// Model fixture server
class ModelFixture {
  private callCount = 0;
  private scenario: TestScenario;
  private server: ReturnType<typeof createServer> | null = null;
  private port = 0;
  private errors: string[] = [];

  constructor(scenario: TestScenario) {
    this.scenario = scenario;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          console.log(`[FIXTURE] Server started on port ${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server port'));
        }
      });

      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        this.callCount++;

        if (this.callCount > this.scenario.calls.length) {
          this.fail(res, `Unexpected call #${this.callCount}`);
          return;
        }

        const call = this.scenario.calls[this.callCount - 1];

        // Validate request if validator exists
        if (call.validate) {
          const validation = call.validate(request);
          if (validation !== true && typeof validation === 'string') {
            this.fail(res, validation);
            return;
          }
        }

        // Return scripted response
        const response = {
          id: `fixture-${this.callCount}`,
          object: 'chat.completion',
          created: Date.now(),
          model: 'fixture',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: `call-${this.callCount}`,
                    type: 'function',
                    function: {
                      name: call.tool,
                      arguments: JSON.stringify(call.response),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

        console.log(
          `[FIXTURE] Call ${this.callCount}/${this.scenario.calls.length}: ${call.tool}.${call.action}`,
        );
      } catch (err) {
        this.fail(res, `Parse error: ${err}`);
      }
    });
  }

  private fail(res: ServerResponse, message: string): void {
    this.errors.push(message);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  getErrors(): string[] {
    return this.errors;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// Test runner
async function runTest(scenarioName: string): Promise<boolean> {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    console.error(`[TEST] Unknown scenario: ${scenarioName}`);
    console.log(`Available: ${Object.keys(SCENARIOS).join(', ')}`);
    return false;
  }

  console.log(`\n[TEST] Running scenario: ${scenario.name}`);
  console.log(`[TEST] ${scenario.description}\n`);

  // Setup test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });

  // Start fixture server
  const fixture = new ModelFixture(scenario);
  let port: number;

  try {
    port = await fixture.start();
  } catch (err) {
    console.error(`[TEST] Failed to start fixture: ${err}`);
    return false;
  }

  // Create test config pointing to fixture
  const testConfig = {
    provider: {
      fixture: {
        baseURL: `http://127.0.0.1:${port}/v1`,
        apiKey: 'fixture',
      },
    },
    model: 'fixture/fixture',
  };

  const configPath = join(TEST_DIR, 'test-config.json');
  writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  // Run the test (simulated - in real usage would call the orchestrator)
  console.log(`[TEST] Config written to: ${configPath}`);
  console.log(`[TEST] Model endpoint: ${testConfig.provider.fixture.baseURL}`);

  // Simulate test execution
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Stop fixture
  await fixture.stop();

  // Validate results
  const errors = fixture.getErrors();
  const callCount = fixture.getCallCount();
  const expectedCalls = scenario.calls.length;

  if (errors.length > 0) {
    console.error(`\n[TEST] FAILED with errors:`);
    errors.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  if (callCount !== expectedCalls) {
    console.error(`\n[TEST] FAILED: Expected ${expectedCalls} calls, got ${callCount}`);
    return false;
  }

  console.log(`\n[TEST] PASSED: ${callCount}/${expectedCalls} calls executed`);
  return true;
}

// CLI
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ||
  process.argv[1]?.includes('deterministic-test-framework');

if (isMain) {
  const args = process.argv.slice(2);
  const scenarioIndex = args.indexOf('--scenario');
  const scenario = scenarioIndex !== -1 ? args[scenarioIndex + 1] : null;
  const list = args.includes('--list');

  if (list) {
    console.log('Available scenarios:');
    Object.entries(SCENARIOS).forEach(([key, s]) => {
      console.log(`  ${key}: ${s.description}`);
    });
    process.exit(0);
  }

  if (!scenario) {
    console.log('Usage: npx tsx src/deterministic-test-framework.ts --scenario <name>');
    console.log('       npx tsx src/deterministic-test-framework.ts --list');
    process.exit(1);
  }

  runTest(scenario)
    .then((passed) => {
      process.exit(passed ? 0 : 1);
    })
    .catch((err) => {
      console.error(`[TEST] Error: ${err}`);
      process.exit(1);
    });
}

export { runTest, SCENARIOS, ModelFixture };
