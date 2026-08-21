#!/usr/bin/env node
/**
 * PS1 Ref Fixer - Automated repair of broken PS1 references
 *
 * Usage: npx tsx src/auto-ps1-fixer.ts [--dry-run] [--src-only]
 *
 * Strategy:
 * 1. Map PS1 paths to TS equivalents using known patterns
 * 2. Apply fixes to src/ files (prioridad alta)
 * 3. Config files need careful review antes de aplicar
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());

// Mapping de PS1 -> TS (basado en migraciones conocidas)
const PS1_TO_TS_MAP: Record<string, string> = {
  // Scripts de hooks
  'hooks/pre-commit.ps1': 'src/hooks/pre-commit.ts',
  'hooks/pre-commit-privacy.ps1': 'src/hooks/pre-commit-privacy.ts',
  'scripts/hooks/check-security.ps1': 'src/check-security.ts',
  'scripts/hooks/check-quality.ps1': 'src/hooks/check-quality.ts',
  'scripts/hooks/check-architecture.ps1': 'src/hooks/check-architecture.ts',
  'scripts/hooks/check-testing.ps1': 'src/hooks/check-testing.ts',
  'scripts/hooks/check-api.ps1': 'src/hooks/check-api.ts',
  'scripts/hooks/check-documentation.ps1': 'src/hooks/check-documentation.ts',
  'scripts/hooks/check-gitflow.ps1': 'src/hooks/check-gitflow.ts',
  'scripts/hooks/hook-output-safety.ps1': 'src/hooks/hook-output-safety.ts',
  'scripts/hooks/check-sdd-gate.ps1': 'src/hooks/check-sdd-gate.ts',
  'scripts/hooks/lockfile-lint-pre-commit.ps1': 'src/hooks/lockfile-lint-pre-commit.ts',
  'scripts/hooks/npm-audit-pre-push.ps1': 'src/hooks/npm-audit-pre-push.ts',

  // Scripts de adaptación
  'scripts/adaptive/karpathy-enforcer.ps1': 'src/karpathy-enforcer.ts',
  'scripts/adaptive/correction-rules-engine.ps1': 'src/correction-rules-engine.ts',
  'scripts/adaptive/session-scoring.ps1': 'src/session-scoring.ts',

  // Scripts de seguridad
  'scripts/security/security-orchestrator.ps1': 'src/security/security-orchestrator.ts',
  'scripts/security/privacy-gateway.ps1': 'src/privacy-gateway.ts',
  'scripts/security/audit-pipeline.ps1': 'src/audit-pipeline.ts',

  // Cloud connectors
  'scripts/utilities/ops/CLOUD-CONNECTORS/hybrid-executor.ps1': 'src/hybrid-executor.ts',
  'scripts/utilities/ops/CLOUD-CONNECTORS/aws-delegator.ps1': 'src/aws-delegator.ts',
  'scripts/utilities/ops/CLOUD-CONNECTORS/azure-delegator.ps1': 'src/azure-delegator.ts',

  // State persistence
  'scripts/utilities/ops/STATE-PERSISTENCE/checkpoint-manager.ps1': 'src/checkpoint-manager.ts',
  'scripts/utilities/ops/STATE-PERSISTENCE/snapshot-manager.ps1': 'src/snapshot-manager.ts',
  'scripts/utilities/ops/STATE-PERSISTENCE/rollback-orchestrator.ps1':
    'src/rollback-orchestrator.ts',

  // Tracing
  'scripts/utilities/ops/TRACING/tracing-instrument.ps1': 'src/tracing-instrument.ts',

  // Event sourcing
  'scripts/utilities/ops/ADVANCED-PATTERNS/event-sourcing.ps1': 'src/event-sourcing.ts',
  'scripts/utilities/ops/ADVANCED-PATTERNS/saga-orchestrator.ps1': 'src/saga-orchestrator.ts',

  // Engram
  'scripts/utilities/memory/ENGRAM/engram-integrity-check.ps1': 'src/engram-integrity-check.ts',
  'scripts/utilities/memory/ENGRAM/engram-auto-sync.ps1': 'src/engram-auto-sync.ts',
  'scripts/utilities/memory/ENGRAM-RAG/engram-rag-reindex.ps1': 'src/engram-rag-reindex.ts',

  // MCP
  'scripts/utilities/MCP/mcp-gateway.ps1': 'src/mcp-gateway.ts',
  'scripts/utilities/MCP/mcp-manager.ps1': 'src/mcp-manager.ts',

  // Dashboard
  'scripts/utilities/dashboard/dashboard-common.ps1': 'src/dashboard-common.ts',
  'scripts/utilities/dashboard/dashboard-start.ps1': 'src/dashboard-start.ts',
  'scripts/utilities/dashboard/dashboard-stop.ps1': 'src/dashboard-stop.ts',
  'scripts/utilities/dashboard/dashboard-ws-autostart.ps1': 'src/dashboard-ws-autostart.ts',

  // Session
  'scripts/utilities/session/session-cleanup-start.ps1': 'src/session-cleanup-start.ts',
  'scripts/utilities/session/session-notification.ps1': 'src/session-notification.ts',
  'scripts/utilities/session/session-manager.ps1': 'src/session-manager.ts',
  'scripts/utilities/session/session-metrics-tracker.ps1': 'src/session-metrics-tracker.ts',

  // Setup/Detect
  'scripts/utilities/setup/DETECT/detect-tool.ps1': 'src/detect-tool.ts',

  // Utilities
  'scripts/utilities/lefthook-verify.ps1': 'src/lefthook-verify.ts',
  'scripts/utilities/validate-tool-configs.ps1': 'src/validate-tool-configs.ts',
  'scripts/utilities/post-autostart-summary.ps1': 'src/post-autostart-summary.ts',

  'scripts/utilities/pre-process-input.ps1': 'src/pre-process-input.ts',
  'scripts/utilities/pre-compact-hook.ps1': 'src/pre-compact-hook.ts',
  'scripts/utilities/handoff-compress.ps1': 'src/handoff-compress.ts',

  'scripts/utilities/optimize-engram-usage.ps1': 'src/optimize-engram-usage.ts',
  'scripts/utilities/token-metrics-store.ps1': 'src/token-metrics-store.ts',

  // Perfiles adaptativos
  'scripts/utilities/profile/PROFILE-ADAPTIVE/adaptive-opencode-profile.ps1':
    'src/adaptive-opencode-profile.ts',
  'scripts/utilities/profile/PROFILE-ADAPTIVE/adaptive-codex-windsurf-profile.ps1':
    'src/adaptive-codex-windsurf-profile.ts',
  'scripts/utilities/adaptive-claude-cline-profile.ps1': 'src/adaptive-claude-profile.ts',

  // Knowledge base
  'scripts/utilities/knowledge-base/knowledge-base-manager.ps1': 'src/knowledge-base-manager.ts',
  'scripts/utilities/knowledge-base/knowledge-base-sync.ps1': 'src/knowledge-base-sync.ts',

  // Validators
  'scripts/utilities/WORKFLOW-ORCHESTRATION/validate-system-health.ps1':
    'src/validate-system-health.ts',
  'scripts/utilities/GIT-VERSION-CONTROL/pre-commit-validation.ps1': 'src/pre-commit-validation.ts',
  'scripts/utilities/GIT-VERSION-CONTROL/post-merge-sync.ps1': 'src/post-merge-sync.ts',

  // Bootstrap
  'scripts/gentle-vanguard/bootstrap.ps1': 'src/bootstrap.ts',
  'scripts/gentle-vanguard/bootstrap-machine.ps1': 'src/bootstrap-machine.ts',
  'scripts/gentle-vanguard/setup-complete.ps1': 'src/setup-complete.ts',
  'scripts/gentle-vanguard/setup-multi-machine.ps1': 'src/setup-multi-machine.ts',

  // Workflow orchestration
  'scripts/utilities/WORKFLOW-ORCHESTRATION/gv.ps1': 'src/cli/gv.ts',

  // Final
  'scripts/utilities/final-resolution.ps1': 'src/final-resolution.ts',

  // Testing
  'scripts/run-tests-simple.ps1': 'src/run-tests-simple.ts',

  // Skills
  'skills/docker-devops-skill/scripts/security-scan.ps1': 'src/security-scan.ts',
  'skills/documentation-manager.ps1': 'src/documentation-manager.ts',

  // Review
  'scripts/hooks/validate-readme.ps1': 'src/validate-readme.ts',
};

interface FixResult {
  file: string;
  line: number;
  original: string;
  replacement: string;
  applied: boolean;
  tsExists: boolean;
}

function findTsEquivalent(ps1Path: string): string | null {
  // Primero buscar en mapa conocido
  if (PS1_TO_TS_MAP[ps1Path]) {
    return PS1_TO_TS_MAP[ps1Path];
  }

  // Reglas generales
  if (ps1Path.includes('scripts/') || ps1Path.includes('hooks/')) {
    // Extraer nombre base
    const basename = ps1Path.replace(/.*\//, '').replace('.ps1', '');
    // Buscar en src/
    const candidates = [`src/${basename}.ts`, `src/hooks/${basename}.ts`];

    for (const candidate of candidates) {
      if (existsSync(join(ROOT, candidate))) {
        return candidate;
      }
    }
  }

  return null;
}

function fixFile(filePath: string, dryRun: boolean): FixResult[] {
  const results: FixResult[] = [];
  const fullPath = join(ROOT, filePath);

  if (!existsSync(fullPath)) {
    return results;
  }

  let content = readFileSync(fullPath, 'utf-8');
  const originalContent = content;

  // Buscar referencias PS1 en strings
  const ps1Regex = /['"]([^'"]*\.ps1)['"]/g;
  let match;
  const lineOffset = 0;

  while ((match = ps1Regex.exec(originalContent)) !== null) {
    const ps1Path = match[1];
    const tsEquivalent = findTsEquivalent(ps1Path);

    if (tsEquivalent) {
      // Verificar que TS existe
      const tsFullPath = join(ROOT, tsEquivalent);
      const tsExists = existsSync(tsFullPath);

      // Calcular línea
      const beforeMatch = originalContent.substring(0, match.index);
      const line = beforeMatch.split('\n').length + lineOffset;

      const fix: FixResult = {
        file: filePath,
        line,
        original: ps1Path,
        replacement: tsEquivalent,
        applied: false,
        tsExists,
      };

      // Solo aplicar si no es dry-run y TS existe
      if (!dryRun && tsExists) {
        // Reemplazar en content (escape special regex chars)
        const escaped = ps1Path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(escaped, 'g'), () => {
          fix.applied = true;
          return tsEquivalent;
        });
      }

      results.push(fix);
    }
  }

  // Guardar si hubo cambios y no es dry-run
  if (!dryRun && content !== originalContent) {
    writeFileSync(fullPath, content, 'utf-8');
  }

  return results;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Archivos críticos a procesar (de audit-ps1-refs.ts)
  const criticalFiles = [
    // src/ - prioridad alta
    'src/code-review.ts',
    'src/complete-stack-fix.ts',
    'src/core/maintenance-watchtower.ts',
    'src/cross-workspace-validator.ts',
    'src/digest-generator.ts',
    'src/engram-rag-reindex.ts',
    'src/hooks/karpathy-enforcer-hook.ts',
    'src/hooks/normative-audit-hook.ts',
    'src/hooks/post-checkout.ts',
    'src/hooks/pre-commit-privacy.ts',
    'src/hooks/pre-commit.ts',
    'src/hooks/validate-readme-hook.ts',
    'src/infrastructure/normative-audit-pipeline.ts',
    'src/karpathy-enforcer.ts',
    'src/knowledge-base-autoinit.ts',
    'src/knowledge-base-init.ts',
    'src/orchestrate-auto-fix.ts',
    'src/post-merge-sync.ts',
    'src/saga-orchestrator.ts',
    'src/setup-complete.ts',
    'src/setup-multi-machine.ts',
    'src/sync-to-public.ts',
    'src/token-usage-notifier.ts',
    'src/validate-readme.ts',
  ];

  console.log(`PS1 Auto-Fixer - ${dryRun ? 'DRY RUN' : 'LIVE MODE'}`);
  console.log('=====================================\n');

  let totalFixes = 0;
  let appliedFixes = 0;
  let missingTs = 0;

  for (const file of criticalFiles) {
    const results = fixFile(file, dryRun);

    if (results.length > 0) {
      console.log(`\n${file}:`);
      for (const fix of results) {
        totalFixes++;
        const status = fix.applied
          ? '✅ FIXED'
          : dryRun
            ? '📋 WOULD FIX'
            : !fix.tsExists
              ? '⚠️ TS MISSING'
              : '❌ FAILED';
        console.log(`  Line ${fix.line}: ${fix.original}`);
        console.log(`    → ${fix.replacement} ${status}`);

        if (fix.applied) appliedFixes++;
        if (!fix.tsExists) missingTs++;
      }
    }
  }

  console.log('\n=====================================');
  console.log(`Total references found: ${totalFixes}`);
  if (!dryRun) {
    console.log(`Fixed: ${appliedFixes}`);
    console.log(`Missing TS: ${missingTs}`);
  } else {
    console.log(`Would fix: ${totalFixes - missingTs}`);
    console.log(`TS missing: ${missingTs}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(import.meta.url).href) {
  main();
}

export { fixFile, findTsEquivalent };
