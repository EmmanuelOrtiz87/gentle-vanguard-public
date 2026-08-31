#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';

function findProjectRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (!parent || parent === current) break;
    current = parent;
  }
  return dir;
}

const ROOT = resolve(process.cwd());
const projectRoot = findProjectRoot(ROOT);
const vaultPath = join(projectRoot, 'knowledge-base');
const configPath = join(projectRoot, 'config', 'knowledge-base-config.json');

interface KBConfig {
  folders: Record<string, string>;
  sync: { enabled: boolean };
}

function getConfig(): KBConfig | null {
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      /* */
    }
  }
  return null;
}

function initializeVault(force: boolean, quiet: boolean): boolean {
  const config = getConfig();
  if (!config) {
    if (!quiet) console.log(`[ERROR] Config not found at ${configPath}`);
    return false;
  }

  let needsInit = false;
  if (!existsSync(vaultPath)) {
    if (!quiet) console.log('[WARN] Vault root not found - creating...');
    needsInit = true;
  } else if (force) {
    if (!quiet) console.log('[INFO] Force init requested');
    needsInit = true;
  }

  if (needsInit) {
    mkdirSync(vaultPath, { recursive: true });

    for (const folder of Object.values(config.folders)) {
      const fp = join(vaultPath, folder);
      if (!existsSync(fp)) {
        mkdirSync(fp, { recursive: true });
        if (!quiet) console.log(`[OK] Created folder: ${folder}`);
      }
    }

    const templatesFolder = join(vaultPath, '06-templates');
    if (!existsSync(templatesFolder)) mkdirSync(templatesFolder, { recursive: true });

    const templateFiles: Record<string, string> = {
      'project.md': `---\ncreated: {{date}}\ntags: [project, #{{project-name}}]\nstatus: active\n---\n\n# {{project-name}}\n\n## Overview\n**Description:** \n**Owner:** \n**Started:** {{date}}\n**Priority:** \n\n## Goals\n\n- [ ] \n\n## Tasks\n\n- [ ] \n\n## Notes\n\n## Links\n\n- [[]] - \n\n## Metadata\n\n\`\`\`json\n{\n  "project": "{{project-name}}",\n  "created": "{{date}}",\n  "status": "active"\n}\n\`\`\`\n`,
      'session.md': `---\ncreated: {{date}}\ntags: [session, #{{session-id}}]\n---\n\n# Session: {{session-id}}\n\n**Date:** {{date}}\n**Duration:** \n**Focus:** \n\n## Summary\n\n## Accomplished\n\n- \n\n## Next Steps\n\n- \n\n## Decisions Made\n\n- \n\n## Notes\n\n## Related\n\n- [[]] - \n\n## Metadata\n\n\`\`\`json\n{\n  "session_id": "{{session-id}}",\n  "created": "{{date}}",\n  "type": "session-summary"\n}\n\`\`\`\n`,
      'skill.md': `---\ncreated: {{date}}\ntags: [skill, #{{skill-name}}]\nskill_type: \ntriggers: \n---\n\n# Skill: {{skill-name}}\n\n## Overview\n**Type:** \n**Triggers:** \n**Agent:** \n\n## Description\n\n## Implementation\n\n### Files\n\n- \n\n### Dependencies\n\n- \n\n## Usage\n\n## Related Skills\n\n- [[]] - \n\n## Metadata\n\n\`\`\`json\n{\n  "skill_name": "{{skill-name}}",\n  "created": "{{date}}",\n  "type": "skill"\n}\n\`\`\`\n`,
      'decision.md': `---\ncreated: {{date}}\ntags: [decision, #{{decision-id}}]\nstatus: accepted|proposed|rejected|deprecated\n---\n\n# ADR: {{decision-title}}\n\n**Status:** {{status}}\n**Date:** {{date}}\n**Owner:** \n\n## Summary\n\n## Context\n\n## Decision\n\n## Consequences\n\n### Positive\n\n- \n\n### Negative\n\n- \n\n## Alternatives Considered\n\n- \n\n## Related Decisions\n\n- [[]] - \n\n## Notes\n\n## Metadata\n\n\`\`\`json\n{\n  "adr_id": "{{decision-id}}",\n  "title": "{{decision-title}}",\n  "status": "{{status}}",\n  "created": "{{date}}"\n}\n\`\`\`\n`,
    };

    for (const [name, content] of Object.entries(templateFiles)) {
      const tp = join(templatesFolder, name);
      if (!existsSync(tp)) {
        writeFileSync(tp, content, 'utf-8');
        if (!quiet) console.log(`[OK] Created template: ${name}`);
      }
    }

    const readmePath = join(vaultPath, 'README.md');
    if (!existsSync(readmePath)) {
      const readme = `# Knowledge Base - Gentle-Vanguard\n\nThis is the **Gentle-Vanguard Knowledge Base** vault managed via Obsidian.\n\n## Structure\n\n- \`00-inbox/\` - Unsorted notes\n- \`01-projects/\` - Active projects\n- \`02-architecture/\` - Architecture decisions\n- \`03-skills/\` - Skill documentation\n- \`04-sessions/\` - Session summaries\n- \`05-research/\` - Research notes\n- \`06-templates/\` - Note templates\n- \`07-archive/\` - Archived content\n\n## Usage\n\nSee docs for usage.\n`;
      writeFileSync(readmePath, readme, 'utf-8');
      if (!quiet) console.log('[OK] Created README.md');
    }

    if (!quiet) console.log('[OK] Vault initialized successfully');
    return true;
  }

  let allFoldersExist = true;
  for (const folder of Object.values(config.folders)) {
    const fp = join(vaultPath, folder);
    if (!existsSync(fp)) {
      mkdirSync(fp, { recursive: true });
      if (!quiet) console.log(`[WARN] Created missing folder: ${folder}`);
      allFoldersExist = false;
    }
  }

  if (allFoldersExist && !quiet) console.log('[OK] Vault structure validated');
  return true;
}

function getVaultStats(): { notes: number; sizeKB: number } {
  let notes = 0,
    size = 0;
  function walk(d: string): void {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) {
        notes++;
        size += statSync(full).size;
      }
    }
  }
  if (existsSync(vaultPath)) walk(vaultPath);
  return { notes, sizeKB: Math.round((size / 1024) * 100) / 100 };
}

function runFullSync(quiet: boolean): boolean {
  const syncScriptTs = join(projectRoot, 'src', 'knowledge', 'knowledge-base-sync.ts');
  if (existsSync(syncScriptTs)) {
    try {
      runNpxTsxSync(syncScriptTs, ['--mode', 'full', '--quiet'], {
        cwd: projectRoot,
        timeout: 60000,
      });
      if (!quiet) console.log('[OK] Full sync completed');
      return true;
    } catch (e: unknown) {
      if (!quiet) console.log(`[ERROR] Sync failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
  if (!quiet) console.log(`[ERROR] Sync script not found: ${syncScriptTs}`);
  return false;
}

function main(): void {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const force = args.includes('--force');

  if (!quiet) console.log('=== Knowledge Base Auto-Init ===');

  const initResult = initializeVault(force, quiet);

  if (initResult) {
    const stats = getVaultStats();
    if (!quiet) console.log(`[OK] Vault ready: ${stats.notes} notes, ${stats.sizeKB} KB`);

    const config = getConfig();
    if (config && config.sync && config.sync.enabled) {
      if (!quiet) console.log('[INFO] Running auto-sync...');
      runFullSync(quiet);
    }
  } else {
    console.log('[ERROR] Vault initialization failed');
    process.exit(1);
  }

  if (!quiet) console.log('=== Knowledge Base Ready ===');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
