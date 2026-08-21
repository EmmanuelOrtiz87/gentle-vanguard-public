#!/usr/bin/env node
/**
 * Documentation Migration Tool - Bulk replace PS1 references with TypeScript equivalents
 * Replaces: scripts/utilities/*.ps1 -> npx tsx src/*.ts
 * Replaces: pwsh -File scripts/... -> npx tsx src/...
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

interface Replacement {
  from: RegExp;
  to: string;
  description: string;
}

const REPLACEMENTS: Replacement[] = [
  // Main patterns
  {
    from: /scripts\/utilities\/pre-process-input\.ps1/g,
    to: 'src/pre-process-input.ts',
    description: 'Pre-process input hook',
  },
  {
    from: /scripts\/utilities\/session-manager\.ps1/g,
    to: 'src/session-manager.ts',
    description: 'Session manager',
  },
  {
    from: /scripts\/utilities\/session-autostart\.ps1/g,
    to: 'src/session-autostart.ts',
    description: 'Session autostart',
  },
  {
    from: /scripts\/utilities\/detect-tool\.ps1/g,
    to: 'src/detect-tool.ts',
    description: 'Tool detection',
  },
  {
    from: /scripts\/utilities\/self-diagnosis\.ps1/g,
    to: 'src/self-diagnosis.ts',
    description: 'Self diagnosis',
  },
  {
    from: /scripts\/utilities\/agent-verify\.ps1/g,
    to: 'src/agent-verify.ts',
    description: 'Agent verification',
  },
  {
    from: /scripts\/utilities\/validate-configs\.ps1/g,
    to: 'src/validate-configs.ts',
    description: 'Config validation',
  },
  {
    from: /scripts\/utilities\/semantic-search\.ps1/g,
    to: 'src/semantic-search.ts',
    description: 'Semantic search',
  },
  {
    from: /scripts\/utilities\/codegraph-semantic-search\.ps1/g,
    to: 'src/codegraph-semantic-search.ts',
    description: 'CodeGraph semantic search',
  },
  {
    from: /scripts\/utilities\/review-workload-guard\.ps1/g,
    to: 'src/review-workload-guard.ts',
    description: 'Workload guard',
  },
  {
    from: /scripts\/utilities\/pre-close-validator\.ps1/g,
    to: 'src/pre-close-validator.ts',
    description: 'Pre-close validator',
  },
  {
    from: /scripts\/utilities\/sdd-preflight\.ps1/g,
    to: 'src/sdd-preflight.ts',
    description: 'SDD preflight',
  },
  {
    from: /scripts\/utilities\/token-usage-auto\.ps1/g,
    to: 'src/token-usage-auto.ts',
    description: 'Token usage tracking',
  },
  {
    from: /scripts\/utilities\/token-budget-guard\.ps1/g,
    to: 'src/token-budget-guard.ts',
    description: 'Token budget guard',
  },
  {
    from: /scripts\/utilities\/handoff-compress\.ps1/g,
    to: 'src/handoff-compress.ts',
    description: 'Handoff compression',
  },
  {
    from: /scripts\/utilities\/pre-compact-hook\.ps1/g,
    to: 'src/pre-compact-hook.ts',
    description: 'Pre-compact hook',
  },
  {
    from: /scripts\/utilities\/install-hooks\.ps1/g,
    to: 'src/install-hooks.ts',
    description: 'Install hooks',
  },
  {
    from: /scripts\/utilities\/session-context-log\.ps1/g,
    to: 'src/session-context-log.ts',
    description: 'Session context log',
  },
  {
    from: /hooks\/pre-commit\.ps1/g,
    to: 'hooks/pre-commit',
    description: 'Pre-commit hook',
  },
  {
    from: /scripts\/adaptive\/auto-norm-learner\.ps1/g,
    to: 'src/auto-norm-learner.ts',
    description: 'Auto-norm learner',
  },
  {
    from: /scripts\/adaptive\/session-scoring\.ps1/g,
    to: 'src/session-scoring.ts',
    description: 'Session scoring',
  },
  {
    from: /scripts\/adaptive\/correction-capture\.ps1/g,
    to: 'src/correction-capture.ts',
    description: 'Correction capture',
  },
  {
    from: /scripts\/utilities\/engram\/backup-engram\.ps1/g,
    to: 'src/backup-engram.ts',
    description: 'Engram backup',
  },
  {
    from: /scripts\/utilities\/TELEMETRY-METRICS\/(.+?)\.ps1/g,
    to: 'src/telemetry/$1.ts',
    description: 'Telemetry scripts',
  },
  {
    from: /scripts\/utilities\/SESSION\/(.+?)\.ps1/g,
    to: 'src/$1.ts',
    description: 'Session scripts',
  },
  {
    from: /scripts\/utilities\/GUARD\/(.+?)\.ps1/g,
    to: 'src/$1.ts',
    description: 'Guard scripts',
  },
  {
    from: /scripts\/utilities\/DETECT\/(.+?)\.ps1/g,
    to: 'src/$1.ts',
    description: 'Detection scripts',
  },
  {
    from: /scripts\/utilities\/FEEDBACK\/(.+?)\.ps1/g,
    to: 'src/feedback/$1.ts',
    description: 'Feedback scripts',
  },
  {
    from: /scripts\/utilities\/DIGEST\/(.+?)\.ps1/g,
    to: 'src/digest/$1.ts',
    description: 'Digest scripts',
  },
  {
    from: /scripts\/utilities\/DEPLOYMENT\/(.+?)\.ps1/g,
    to: 'src/deployment/$1.ts',
    description: 'Deployment scripts',
  },
  {
    from: /scripts\/utilities\/FINE-TUNING\/(.+?)\.ps1/g,
    to: 'src/fine-tuning/$1.ts',
    description: 'Fine-tuning scripts',
  },
  {
    from: /scripts\/utilities\/WORKFLOW-ORCHESTRATION\/(.+?)\.ps1/g,
    to: 'src/$1.ts',
    description: 'Workflow orchestration',
  },
  {
    from: /scripts\/utilities\/SKILLS-TOOLS\/(.+?)\.ps1/g,
    to: 'src/skills/$1.ts',
    description: 'Skills tools',
  },
  // pwsh patterns
  {
    from: /pwsh\s+-NoProfile\s+-File\s+scripts\/(.+?)\.ps1/g,
    to: 'npx tsx src/$1.ts',
    description: 'pwsh -File pattern',
  },
  {
    from: /pwsh\s+-File\s+scripts\/(.+?)\.ps1/g,
    to: 'npx tsx src/$1.ts',
    description: 'pwsh -File pattern (simple)',
  },
  // PowerShell mentions
  {
    from: /PowerShell(-First)?/gi,
    to: 'TypeScript',
    description: 'PowerShell-first to TypeScript-first',
  },
  {
    from: /PowerShell\s+7\.4\+/gi,
    to: 'Node.js 20+',
    description: 'PowerShell version to Node version',
  },
  // Removal of Pester references where no longer relevant
  {
    from: /Pester\s+5\.x/g,
    to: 'node:test',
    description: 'Pester to node:test',
  },
];

interface MigrationResult {
  file: string;
  replacements: number;
  descriptions: string[];
}

function migrateFile(filePath: string, dryRun: boolean = false): MigrationResult | null {
  const content = readFileSync(filePath, 'utf-8');
  let newContent = content;
  const result: MigrationResult = {
    file: filePath,
    replacements: 0,
    descriptions: [],
  };

  for (const replacement of REPLACEMENTS) {
    const matches = newContent.match(replacement.from);
    if (matches) {
      if (!dryRun) {
        newContent = newContent.replace(replacement.from, replacement.to);
      }
      result.replacements += matches.length;
      if (!result.descriptions.includes(replacement.description)) {
        result.descriptions.push(replacement.description);
      }
    }
  }

  if (result.replacements > 0 && !dryRun) {
    writeFileSync(filePath, newContent, 'utf-8');
  }

  return result.replacements > 0 ? result : null;
}

function findMarkdownFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and .git
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      findMarkdownFiles(fullPath, files);
    } else if (
      entry.isFile() &&
      (extname(entry.name) === '.md' ||
        extname(entry.name) === '.yml' ||
        extname(entry.name) === '.json')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const targetFile = args.find((a) => a.endsWith('.md') || a.endsWith('.yml'));

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  DOCUMENTATION MIGRATION TOOL                             ║');
  console.log(
    `║  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will write files)'}                            ║`,
  );
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  const results: MigrationResult[] = [];

  if (targetFile) {
    // Single file mode
    const result = migrateFile(targetFile, dryRun);
    if (result) {
      results.push(result);
    }
  } else {
    // Bulk mode - docs and rules
    const docsFiles = findMarkdownFiles('docs');
    const rulesFiles = findMarkdownFiles('rules');
    const rootFiles = ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md'].filter((f) => {
      try {
        statSync(f);
        return true;
      } catch {
        return false;
      }
    });

    const allFiles = [...docsFiles, ...rulesFiles, ...rootFiles];

    for (const file of allFiles) {
      const result = migrateFile(file, dryRun);
      if (result) {
        results.push(result);
      }
    }
  }

  // Report
  console.log('MIGRATION REPORT');
  console.log('='.repeat(60));

  if (results.length === 0) {
    console.log('No files required migration.');
  } else {
    let totalReplacements = 0;
    for (const result of results) {
      console.log(`\n${result.file}`);
      console.log(`  Replacements: ${result.replacements}`);
      console.log(`  Types: ${result.descriptions.join(', ')}`);
      totalReplacements += result.replacements;
    }

    console.log();
    console.log('='.repeat(60));
    console.log(`TOTAL: ${results.length} files, ${totalReplacements} replacements`);
    console.log('='.repeat(60));

    if (!dryRun) {
      console.log('\n✅ Migration complete. Review changes with: git diff --stat');
    } else {
      console.log('\n⚠️  Dry run mode - no files were modified.');
      console.log('   Run without --dry-run to apply changes.');
    }
  }
}

main();
