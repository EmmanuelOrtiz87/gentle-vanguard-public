#!/usr/bin/env node
/**
 * MCP Bridge Health Verification
 * Lightweight script to verify MCP bridge status without starting servers
 * Used by maintenance-watchtower for health checks
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '../..');

interface MCPConfig {
  mcp?: {
    enabled?: boolean;
    servers?: unknown[];
  };
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function verifyMCPBridge(): boolean {
  let allOk = true;
  const checks: string[] = [];

  // Check 1: mcp-bridge.ts exists
  const bridgePath = join(ROOT, 'src/mcp/mcp-bridge.ts');
  if (existsSync(bridgePath)) {
    checks.push('  [OK] mcp-bridge.ts');
  } else {
    checks.push('  [FAIL] mcp-bridge.ts - not found');
    allOk = false;
  }

  // Check 2: skill-server.js compiled
  const skillServerPath = join(ROOT, 'dist/scripts/mcp/skill-server.js');
  if (existsSync(skillServerPath)) {
    checks.push('  [OK] skill-server.js - compiled');
  } else {
    checks.push('  [FAIL] skill-server.js - not compiled (run: pnpm build:mcp)');
    allOk = false;
  }

  // Check 3: MCP config exists and enabled
  const configPath = join(ROOT, 'config/mcp-config.sd.json');
  if (existsSync(configPath)) {
    const config = readJson<MCPConfig>(configPath);
    if (config?.mcp?.enabled === true) {
      const serverCount = config.mcp.servers?.length || 0;
      checks.push(`  [OK] MCP config - enabled (${serverCount} servers)`);
    } else {
      checks.push('  [WARN] MCP config - disabled');
      allOk = false;
    }
  } else {
    checks.push('  [FAIL] MCP config - not found');
    allOk = false;
  }

  // Check 4: MCP registry exists
  const registryPath = join(ROOT, 'config/mcp-registry.json');
  if (existsSync(registryPath)) {
    checks.push('  [OK] mcp-registry.json');
  } else {
    checks.push('  [WARN] mcp-registry.json - not found');
  }

  // Output results
  console.log('MCP Bridge Verification:');
  checks.forEach((check) => console.log(check));

  if (allOk) {
    console.log('Bridge status: OK');
    return true;
  } else {
    console.log('Bridge status: INCOMPLETE');
    return false;
  }
}

// Run verification
const success = verifyMCPBridge();
process.exit(success ? 0 : 1);
