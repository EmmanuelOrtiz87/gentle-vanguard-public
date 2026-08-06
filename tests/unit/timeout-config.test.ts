#!/usr/bin/env node
/**
 * Unit Tests: Timeout Config
 * Tests timeout configuration file
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TIMEOUT_CONFIG_PATH = join(process.cwd(), 'config', 'timeout-config.json');

describe('Timeout Config', () => {
  it('should have config file', () => {
    assert.ok(existsSync(TIMEOUT_CONFIG_PATH), 'Config file should exist');
  });

  it('should load valid JSON', () => {
    const content = readFileSync(TIMEOUT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    assert.ok(config.version, 'Should have version');
    assert.ok(config.timeouts, 'Should have timeouts');
  });

  it('should have required categories', () => {
    const content = readFileSync(TIMEOUT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    assert.ok(config.process_execution, 'Should have process_execution');
    assert.ok(config.http_server, 'Should have http_server');
    assert.ok(config.external_api, 'Should have external_api');
  });

  it('should have valid timeout values', () => {
    const content = readFileSync(TIMEOUT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    assert.ok(typeof config.process_execution.script_default_ms === 'number');
    assert.ok(typeof config.http_server.socket_timeout_ms === 'number');
    assert.ok(typeof config.external_api.http_client_default_ms === 'number');
    
    assert.ok(config.process_execution.script_default_ms > 0);
    assert.ok(config.http_server.socket_timeout_ms > 0);
    assert.ok(config.external_api.http_client_default_ms > 0);
  });
});
