#!/usr/bin/env node
/**
 * Tenant context resolution and routing for multi-tenant Gentle-Vanguard.
 * TS migration of scripts/utilities/TENANT/tenant-context.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface TenantContext {
  tenantId: string;
  isMultiTenant: boolean;
  repoRoot: string;
  sessionDir: string;
  codegraphDir: string;
  telemetryDir: string;
  runtimeDir: string;
  auditDir: string;
  evalDir: string;
}

interface TenantRegistry {
  tenants: Array<{ id: string; lastActive: string }>;
}

const ROOT = resolve(process.cwd());

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  while (current) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

const repoRoot =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);
const tenantRegistryPath = join(repoRoot, 'config', 'tenant-registry.json');
const sessionRoot = join(repoRoot, '.session');
const codegraphRoot = join(repoRoot, '.codegraph');
const telemetryRoot = join(repoRoot, '.telemetry');
const runtimeRoot = join(repoRoot, '.runtime');

function getTenantId(): string {
  if (process.env.GENTLE_TENANT_ID) return process.env.GENTLE_TENANT_ID;
  const tenantConfigPath = join(repoRoot, 'tenant-config.json');
  if (existsSync(tenantConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(tenantConfigPath, 'utf-8'));
      if (config.tenantId) return config.tenantId;
    } catch {
      /* ignore */
    }
  }
  const workspaceName = repoRoot.split(/[\\/]/).pop() || '';
  if (workspaceName && workspaceName !== 'gentle-vanguard') return workspaceName;
  return '';
}

function getTenantContext(): TenantContext {
  const tenantId = getTenantId();
  const isMultiTenant = tenantId !== '';
  const base: TenantContext = {
    tenantId,
    isMultiTenant,
    repoRoot,
    sessionDir: '',
    codegraphDir: '',
    telemetryDir: '',
    runtimeDir: '',
    auditDir: '',
    evalDir: '',
  };
  if (isMultiTenant) {
    base.sessionDir = join(sessionRoot, tenantId);
    base.codegraphDir = join(codegraphRoot, tenantId);
    base.telemetryDir = join(telemetryRoot, tenantId);
    base.runtimeDir = join(runtimeRoot, tenantId);
    base.auditDir = join(sessionRoot, tenantId, 'audit');
    base.evalDir = join(sessionRoot, tenantId, 'eval');
  } else {
    base.sessionDir = sessionRoot;
    base.codegraphDir = codegraphRoot;
    base.telemetryDir = telemetryRoot;
    base.runtimeDir = runtimeRoot;
    base.auditDir = join(sessionRoot, 'audit');
    base.evalDir = join(sessionRoot, 'eval');
  }
  const dirsToCreate: string[] = [base.sessionDir, base.auditDir];
  if (isMultiTenant) {
    dirsToCreate.push(base.codegraphDir, base.evalDir);
  }
  for (const dir of dirsToCreate) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return base;
}

function setTenantContext(tenantId: string): void {
  if (!tenantId) {
    console.warn('[TENANT] Tenant ID cannot be empty');
    return;
  }
  process.env.GENTLE_TENANT_ID = tenantId;
  console.log(`[TENANT] Tenant set to: ${tenantId}`);
}

function getTenantRegistry(): TenantRegistry {
  if (existsSync(tenantRegistryPath)) {
    try {
      return JSON.parse(readFileSync(tenantRegistryPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  return { tenants: [] };
}

interface ValidationResult {
  pass: boolean;
  errors: string[];
  context: TenantContext;
}

function validateIsolation(): ValidationResult {
  const errors: string[] = [];
  const ctx = getTenantContext();
  if (!existsSync(ctx.sessionDir)) errors.push(`Session dir missing: ${ctx.sessionDir}`);
  if (ctx.isMultiTenant) {
    const parentSession = resolve(ctx.sessionDir, '..');
    if (existsSync(parentSession)) {
      for (const entry of readdirSync(parentSession, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== ctx.tenantId) {
          console.warn(`[TENANT] Cross-tenant data detected: ${join(parentSession, entry.name)}`);
        }
      }
    }
  }
  if (errors.length === 0) console.log('[TENANT] Isolation validation PASS');
  else {
    console.log('[TENANT] Isolation validation FAIL');
    for (const e of errors) console.log(`  - ${e}`);
  }
  return { pass: errors.length === 0, errors, context: ctx };
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : 'get';
  const tenantId = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : '';

  switch (action) {
    case 'get': {
      const ctx = getTenantContext();
      if (ctx.isMultiTenant) console.log(`[TENANT] Current tenant: ${ctx.tenantId}`);
      else console.log('[TENANT] Single-tenant mode');
      console.log(JSON.stringify(ctx));
      break;
    }
    case 'set': {
      if (!tenantId) {
        console.error('[TENANT] TenantId required for set action');
        process.exit(1);
      }
      setTenantContext(tenantId);
      break;
    }
    case 'list': {
      const reg = getTenantRegistry();
      console.log('[TENANT] Known tenants:');
      for (const t of reg.tenants) console.log(`  - ${t.id} (last active: ${t.lastActive})`);
      break;
    }
    case 'validate': {
      validateIsolation();
      break;
    }
    default:
      console.error(`[TENANT] Unknown action: ${action}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
