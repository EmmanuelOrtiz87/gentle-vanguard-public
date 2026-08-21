#!/usr/bin/env node
/**
 * Config PS1 Fixer - Repairs PS1 references in config files
 * Optimized for: config/*.json, tool-*.json, quality-gates.json, etc.
 *
 * Strategy: Most config references are documentation/examples.
 * Only fix functional refs (command previews). Remove or update descriptive refs.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());

const PS1_TO_TS_MAP: Record<string, string> = {
  // Hooks
  'hooks/pre-commit.ps1': 'src/hooks/pre-commit.ts',
  'hooks/pre-commit-privacy.ps1': 'src/hooks/pre-commit-privacy.ts',
  'scripts/hooks/check-security.ps1': 'src/check-security.ts',
  'scripts/hooks/check-sdd-gate.ps1': 'src/hooks/check-sdd-gate.ts',
  'scripts/hooks/lockfile-lint-pre-commit.ps1': 'src/hooks/lockfile-lint-pre-commit.ts',
  'scripts/hooks/npm-audit-pre-push.ps1': 'src/hooks/npm-audit-pre-push.ts',

  // Session
  'scripts/utilities/session/session-manager.ps1': 'src/session-manager.ts',
  'scripts/utilities/session/session-start-optimized.ps1': 'src/session-start-optimized.ts',
  'scripts/utilities/session/session-cleanup-start.ps1': 'src/session-cleanup-start.ts',
  'scripts/utilities/session/session-metrics-tracker.ps1': 'src/session-metrics-tracker.ts',
  'scripts/utilities/session/session-notification.ps1': 'src/session-notification.ts',

  // Security
  'scripts/security/security-orchestrator.ps1': 'src/security/security-orchestrator.ts',
  'scripts/security/privacy-gateway.ps1': 'src/privacy-gateway.ts',
  'scripts/security/audit-pipeline.ps1': 'src/audit-pipeline.ts',

  // Ops
  'scripts/utilities/ops/CLOUD-CONNECTORS/hybrid-executor.ps1': 'src/hybrid-executor.ts',
  'scripts/utilities/ops/CLOUD-CONNECTORS/aws-delegator.ps1': 'src/aws-delegator.ts',
  'scripts/utilities/ops/CLOUD-CONNECTORS/azure-delegator.ps1': 'src/azure-delegator.ts',
  'scripts/utilities/ops/STATE-PERSISTENCE/checkpoint-manager.ps1': 'src/checkpoint-manager.ts',
  'scripts/utilities/ops/STATE-PERSISTENCE/snapshot-manager.ps1': 'src/snapshot-manager.ts',
  'scripts/utilities/ops/STATE-PERSISTENCE/rollback-orchestrator.ps1':
    'src/rollback-orchestrator.ts',
  'scripts/utilities/ops/TRACING/tracing-instrument.ps1': 'src/tracing-instrument.ts',
  'scripts/utilities/ops/ADVANCED-PATTERNS/event-sourcing.ps1': 'src/event-sourcing.ts',
  'scripts/utilities/ops/ADVANCED-PATTERNS/saga-orchestrator.ps1': 'src/saga-orchestrator.ts',

  // Engram
  'scripts/utilities/memory/ENGRAM/engram-integrity-check.ps1': 'src/engram-integrity-check.ts',
  'scripts/utilities/memory/ENGRAM/engram-auto-sync.ps1': 'src/engram-auto-sync.ts',
  'scripts/utilities/memory/ENGRAM-RAG/engram-rag-reindex.ps1': 'src/engram-rag-reindex.ts',
  'scripts/utilities/ENGRAM/engram-policy.ps1': 'src/engram-policy.ts',

  // MCP
  'scripts/utilities/MCP/mcp-gateway.ps1': 'src/mcp-gateway.ts',
  'scripts/utilities/MCP/mcp-manager.ps1': 'src/mcp-manager.ts',
  'scripts/mcp-bridge/mcp-bridge.ps1': 'src/mcp-bridge.ts',

  // Dashboard
  'scripts/utilities/dashboard/dashboard-common.ps1': 'src/dashboard-common.ts',
  'scripts/utilities/dashboard/dashboard-start.ps1': 'src/dashboard-start.ts',
  'scripts/utilities/dashboard/dashboard-stop.ps1': 'src/dashboard-stop.ts',
  'scripts/utilities/dashboard/dashboard-ws-autostart.ps1': 'src/dashboard-ws-autostart.ts',
  'scripts/utilities/dashboard/optimize-dashboard.ps1': 'src/optimize-dashboard.ts',

  // Utilities
  'scripts/utilities/lefthook-verify.ps1': 'src/lefthook-verify.ts',
  'scripts/utilities/validate-tool-configs.ps1': 'src/validate-tool-configs.ts',
  'scripts/utilities/post-autostart-summary.ps1': 'src/post-autostart-summary.ts',
  'scripts/utilities/pre-process-input.ps1': 'src/pre-process-input.ts',
  'scripts/utilities/pre-compact-hook.ps1': 'src/pre-compact-hook.ts',
  'scripts/utilities/handoff-compress.ps1': 'src/handoff-compress.ts',
  'scripts/utilities/optimize-engram-usage.ps1': 'src/optimize-engram-usage.ts',
  'scripts/utilities/token-metrics-store.ps1': 'src/token-metrics-store.ts',

  // Profiles
  'scripts/utilities/profile/PROFILE-ADAPTIVE/adaptive-opencode-profile.ps1':
    'src/adaptive-opencode-profile.ts',
  'scripts/utilities/profile/PROFILE-ADAPTIVE/adaptive-codex-windsurf-profile.ps1':
    'src/adaptive-codex-windsurf-profile.ts',
  'scripts/utilities/adaptive-claude-cline-profile.ps1': 'src/adaptive-claude-profile.ts',

  // Knowledge
  'scripts/utilities/knowledge-base/knowledge-base-manager.ps1': 'src/knowledge-base-manager.ts',
  'scripts/utilities/knowledge-base/knowledge-base-sync.ps1': 'src/knowledge-base-sync.ts',
  'scripts/utilities/knowledge-base/knowledge-base-autoinit.ps1': 'src/knowledge-base-autoinit.ts',
  'scripts/utilities/knowledge-base/knowledge-base-init.ps1': 'src/knowledge-base-init.ts',

  // Workflow
  'scripts/utilities/WORKFLOW-ORCHESTRATION/gv.ps1': 'src/cli/gv.ts',
  'scripts/utilities/GIT-VERSION-CONTROL/pre-commit-validation.ps1': 'src/pre-commit-validation.ts',
  'scripts/utilities/GIT-VERSION-CONTROL/post-merge-sync.ps1': 'src/post-merge-sync.ts',

  // Bootstrap
  'scripts/gentle-vanguard/bootstrap.ps1': 'src/bootstrap.ts',
  'scripts/gentle-vanguard/bootstrap-machine.ps1': 'src/bootstrap-machine.ts',
  'scripts/gentle-vanguard/setup-complete.ps1': 'src/setup-complete.ts',
  'scripts/gentle-vanguard/setup-multi-machine.ps1': 'src/setup-multi-machine.ts',

  // Hook genericos
  'scripts/hooks/validate-readme.ps1': 'src/validate-readme.ts',
  'hooks/validate-readme-hook.ps1': 'src/hooks/validate-readme-hook.ts',
};

interface FixResult {
  file: string;
  original: string;
  replacement: string | null;
  action: 'fixed' | 'removed' | 'skipped';
}

function findTsEquivalent(ps1Path: string): string | null {
  // Direct map lookup
  if (PS1_TO_TS_MAP[ps1Path]) {
    const tsPath = PS1_TO_TS_MAP[ps1Path];
    if (existsSync(join(ROOT, tsPath))) {
      return tsPath;
    }
  }

  // Try generic rule: scripts/X/Y.ps1 -> src/X/Y.ts
  if (ps1Path.startsWith('scripts/')) {
    const genericTs = ps1Path.replace('scripts/', 'src/').replace('.ps1', '.ts');
    if (existsSync(join(ROOT, genericTs))) {
      return genericTs;
    }
  }

  // Try src/root level
  const basename = ps1Path.replace(/.*\//, '').replace('.ps1', '.ts');
  if (existsSync(join(ROOT, 'src', basename))) {
    return `src/${basename}`;
  }

  return null;
}

function fixConfigFile(filePath: string): FixResult[] {
  const results: FixResult[] = [];
  const fullPath = join(ROOT, filePath);

  if (!existsSync(fullPath)) {
    return results;
  }

  let content = readFileSync(fullPath, 'utf-8');
  const originalContent = content;

  // Match PS1 references in strings
  const ps1Regex = /(['"`])([^'"`]*\.ps1)\1/g;
  let match;

  while ((match = ps1Regex.exec(originalContent)) !== null) {
    const quote = match[1];
    const ps1Path = match[2];
    const tsEquivalent = findTsEquivalent(ps1Path);

    if (tsEquivalent) {
      // Replace PS1 with TS
      const escaped = ps1Path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${quote}${escaped}${quote}`, 'g');
      content = content.replace(regex, `${quote}${tsEquivalent}${quote}`);

      results.push({
        file: filePath,
        original: ps1Path,
        replacement: tsEquivalent,
        action: 'fixed',
      });
    } else if (!ps1Path.includes('*')) {
      // Mark for removal (obsolete single-file reference)
      results.push({
        file: filePath,
        original: ps1Path,
        replacement: null,
        action: 'skipped',
      });
    }
  }

  // Only save if changed
  if (content !== originalContent) {
    writeFileSync(fullPath, content, 'utf-8');
  }

  return results;
}

function main(): void {
  const configFiles = [
    'config/quality-gates.json',
    'config/ps1-ts-migration.json',
    'config/gentle-vanguard-sync.json',
    'config/testing.config.json',
    'config/tool-opencode.json',
    'config/tool-cline.json',
    'config/tool-codex.json',
    'config/tool-cursor.json',
    'config/tool-windsurf.json',
    'config/adaptive-config.json',
    'config/hooks-config.json',
    'config/skill-evolution-engine.json',
    'config/security-privacy.json',
    'config/observability-config.json',
  ];

  console.log('Config PS1 Fixer - Processing config files...\n');

  let totalFixed = 0;
  let totalSkipped = 0;

  for (const file of configFiles) {
    const results = fixConfigFile(file);

    if (results.length > 0) {
      console.log(`${file}:`);
      for (const r of results) {
        if (r.action === 'fixed') {
          console.log(`  ✅ ${r.original} -> ${r.replacement}`);
          totalFixed++;
        } else {
          console.log(`  ⚠️  ${r.original} (no TS equivalent)`);
          totalSkipped++;
        }
      }
      console.log();
    }
  }

  console.log('=====================================');
  console.log(`Total processed: ${totalFixed + totalSkipped}`);
  console.log(`Fixed: ${totalFixed}`);
  console.log(`Skipped (no TS): ${totalSkipped}`);
}

if (process.argv[1] && import.meta.url === new URL(import.meta.url).href) {
  main();
}
