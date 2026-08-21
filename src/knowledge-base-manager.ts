#!/usr/bin/env node
/**
 * Knowledge Base Manager — init, create-note, list, search, sync, stats, validate.
 * TS migration of scripts/utilities/knowledge-base/knowledge-base-manager.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

type Action =
  'init' | 'create-note' | 'list' | 'search' | 'sync-engram' | 'archive' | 'stats' | 'validate';

interface CliArgs {
  action: Action;
  noteType: string;
  title: string;
  content: string;
  tags: string;
  folder: string;
  query: string;
  quiet: boolean;
}

interface FolderConfig {
  inbox: string;
  projects: string;
  architecture: string;
  skills: string;
  sessions: string;
  research: string;
  templates: string;
  archive: string;
}

interface VaultConfig {
  vault_path: string;
  folders: FolderConfig;
  sync_enabled: boolean;
  auto_archive_days: number;
}

interface VaultNote {
  name: string;
  path: string;
  folder: string;
  size: number;
  modified: Date;
}

interface VaultStats {
  total_notes: number;
  total_size_bytes: number;
  folders: Record<string, number>;
}

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

const projectRoot = findProjectRoot(process.cwd());
const vaultPath = join(projectRoot, 'knowledge-base');
const configPath = join(projectRoot, 'config', 'knowledge-base-config.json');
let _quiet = false;

function log(msg: string, level: string = 'INFO'): void {
  if (_quiet) return;
  const prefix = `[${level}]`;
  if (level === 'ERROR') console.error(`${prefix} ${msg}`);
  else console.log(`${prefix} ${msg}`);
}

function getVaultConfig(): VaultConfig {
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as VaultConfig;
    } catch {
      // fall through to default
    }
  }
  return {
    vault_path: vaultPath,
    folders: {
      inbox: '00-inbox',
      projects: '01-projects',
      architecture: '02-architecture',
      skills: '03-skills',
      sessions: '04-sessions',
      research: '05-research',
      templates: '06-templates',
      archive: '07-archive',
    },
    sync_enabled: true,
    auto_archive_days: 30,
  };
}

function initializeVault(): void {
  const config = getVaultConfig();

  if (!existsSync(vaultPath)) {
    mkdirSync(vaultPath, { recursive: true });
    log(`Created vault root: ${vaultPath}`);
  }

  for (const folder of Object.values(config.folders)) {
    const folderPath = join(vaultPath, folder);
    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true });
      log(`Created folder: ${folder}`);
    }
  }

  const readmePath = join(vaultPath, 'README.md');
  if (!existsSync(readmePath)) {
    const readme = [
      '# Knowledge Base - Gentle-Vanguard',
      '',
      'This is the **Gentle-Vanguard Knowledge Base** vault managed via Obsidian.',
      '',
      '## Structure',
      '',
      '- `00-inbox/` - Unsorted notes',
      '- `01-projects/` - Active projects',
      '- `02-architecture/` - Architecture decisions',
      '- `03-skills/` - Skill documentation',
      '- `04-sessions/` - Session summaries',
      '- `05-research/` - Research notes',
      '- `06-templates/` - Note templates',
      '- `07-archive/` - Archived content',
      '',
      '## Usage',
      '',
      '```powershell',
      '# Create a new note',
      'pwsh scripts\\utilities\\knowledge-base\\knowledge-base-manager.ps1 -Action create-note -NoteType project -Title "My Project"',
      '',
      '# List all notes',
      'pwsh scripts\\utilities\\knowledge-base\\knowledge-base-manager.ps1 -Action list',
      '',
      '# Search notes',
      'pwsh scripts\\utilities\\knowledge-base\\knowledge-base-manager.ps1 -Action search -Query "keyword"',
      '',
      '# Sync with Engram',
      'pwsh scripts\\utilities\\knowledge-base\\knowledge-base-manager.ps1 -Action sync-engram',
      '',
      '# Get stats',
      'pwsh scripts\\utilities\\knowledge-base\\knowledge-base-manager.ps1 -Action stats',
      '```',
      '',
      '## Related',
      '',
      '- [Architecture](docs\\knowledge-base\\ARCHITECTURE.md)',
      '- [Usage Guide](docs\\knowledge-base\\USAGE.md)',
      '',
    ].join('\n');
    writeFileSync(readmePath, readme, 'utf-8');
    log('Created README.md');
  }

  log('Vault initialized successfully', 'OK');
}

function createNote(
  type: string,
  title: string,
  content: string,
  tags: string,
  folder: string,
): string {
  const config = getVaultConfig();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const folderMap: Record<string, string> = {
    project: config.folders.projects,
    session: config.folders.sessions,
    skill: config.folders.skills,
    decision: config.folders.architecture,
    research: config.folders.research,
    inbox: config.folders.inbox,
  };

  const targetFolder = folder || folderMap[type] || config.folders.inbox;
  const folderPath = join(vaultPath, targetFolder);
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
  }

  const safeTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
  const fileName = `${dateStr}-${safeTitle}.md`;
  const filePath = join(folderPath, fileName);

  const tagList: string[] = tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (type) tagList.push(type);
  const tagsYaml = tagList.map((t) => `#${t}`).join(', ');

  const templatePath = join(vaultPath, '06-templates', `${type}.md`);
  let noteContent: string;

  if (existsSync(templatePath)) {
    const tpl = readFileSync(templatePath, 'utf-8');
    noteContent = tpl
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{title\}\}/g, title)
      .replace(/\{\{project-name\}\}/g, title)
      .replace(/\{\{session-id\}\}/g, title)
      .replace(/\{\{skill-name\}\}/g, title)
      .replace(/\{\{decision-id\}\}/g, title)
      .replace(/\{\{decision-title\}\}/g, title)
      .replace(/\{\{content\}\}/g, content || '');
  } else {
    noteContent = content;
  }

  if (tagsYaml) {
    noteContent = noteContent.replace(/tags: \[.*\]/, `tags: [${tagsYaml}]`);
  }

  if (content && !existsSync(templatePath)) {
    noteContent = content;
  }

  writeFileSync(filePath, noteContent, 'utf-8');
  log(`Created note: ${filePath}`, 'OK');
  return filePath;
}

function getVaultNotes(): VaultNote[] {
  const config = getVaultConfig();
  const notes: VaultNote[] = [];

  for (const folder of Object.values(config.folders)) {
    const folderPath = join(vaultPath, folder);
    if (!existsSync(folderPath)) continue;

    const entries = readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const fullPath = join(folderPath, entry.name);
      const s = statSync(fullPath);
      notes.push({
        name: entry.name,
        path: fullPath,
        folder,
        size: s.size,
        modified: s.mtime,
      });
    }
  }

  return notes;
}

function searchNotes(query: string): VaultNote[] {
  const notes = getVaultNotes();
  const results: VaultNote[] = [];

  for (const note of notes) {
    try {
      const content = readFileSync(note.path, 'utf-8');
      if (content.includes(query)) {
        results.push(note);
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

function syncEngramToVault(): void {
  const engramCheck = runSync('where', ['engram']);

  if (engramCheck.status !== 0) {
    log('Engram not found in PATH', 'WARN');
    return;
  }

  try {
    runSync(
      'engram',
      ['search', 'session_summary', '--project', 'gentle-vanguard', '--limit', '50'],
      {
        timeout: 30000,
        windowsHide: true,
      },
    );
    log('Synced session summaries from Engram', 'OK');
  } catch (e: unknown) {
    log(`Failed to sync from Engram: ${e instanceof Error ? e.message : String(e)}`, 'ERROR');
  }
}

function getVaultStats(): VaultStats {
  const notes = getVaultNotes();
  const config = getVaultConfig();
  const folders: Record<string, number> = {};
  let totalSize = 0;

  for (const folder of Object.values(config.folders)) {
    folders[folder] = 0;
  }

  for (const note of notes) {
    totalSize += note.size;
    if (folders[note.folder] !== undefined) {
      folders[note.folder]++;
    }
  }

  return {
    total_notes: notes.length,
    total_size_bytes: totalSize,
    folders,
  };
}

function validateVault(): boolean {
  const config = getVaultConfig();
  const issues: string[] = [];

  if (!existsSync(vaultPath)) {
    issues.push(`Vault root not found: ${vaultPath}`);
  }

  for (const folder of Object.values(config.folders)) {
    const folderPath = join(vaultPath, folder);
    if (!existsSync(folderPath)) {
      issues.push(`Missing folder: ${folder}`);
    }
  }

  if (issues.length === 0) {
    log('Vault validation: PASS', 'OK');
    return true;
  }

  for (const issue of issues) {
    log(issue, 'ERROR');
  }
  return false;
}

function main(): void {
  const args = process.argv.slice(2);

  const parsed: CliArgs = {
    action: 'stats',
    noteType: '',
    title: '',
    content: '',
    tags: '',
    folder: '',
    query: '',
    quiet: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--action':
      case '-a':
        parsed.action = args[++i] as Action;
        break;
      case '--note-type':
      case '-t':
        parsed.noteType = args[++i];
        break;
      case '--title':
      case '--name':
        if (args[i].startsWith('--title')) parsed.title = args[++i];
        else parsed.title = args[++i];
        break;
      case '--content':
      case '-c':
        parsed.content = args[++i];
        break;
      case '--tags':
      case '--tag':
        if (args[i] === '--tags' || args[i] === '--tag') parsed.tags = args[++i];
        break;
      case '--folder':
      case '-f':
        parsed.folder = args[++i];
        break;
      case '--query':
      case '-q':
        parsed.query = args[++i];
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
    }
  }

  _quiet = parsed.quiet;

  switch (parsed.action) {
    case 'init':
      initializeVault();
      break;

    case 'create-note':
      if (!parsed.title) {
        log('Title is required for create-note', 'ERROR');
        process.exit(1);
      }
      createNote(parsed.noteType, parsed.title, parsed.content, parsed.tags, parsed.folder);
      break;

    case 'list': {
      const notes = getVaultNotes();
      for (const note of notes) {
        console.log(`${note.folder}/${note.name}`);
      }
      log(`Total: ${notes.length} notes`, 'OK');
      break;
    }

    case 'search':
      if (!parsed.query) {
        log('Query is required for search', 'ERROR');
        process.exit(1);
      }
      const results = searchNotes(parsed.query);
      for (const r of results) {
        console.log(`${r.folder}/${r.name}`);
      }
      log(`Found ${results.length} notes`, 'OK');
      break;

    case 'sync-engram':
      syncEngramToVault();
      break;

    case 'stats': {
      const stats = getVaultStats();
      console.log('Knowledge Base Statistics');
      console.log('=========================');
      console.log(`Total Notes: ${stats.total_notes}`);
      console.log(`Total Size: ${(stats.total_size_bytes / 1024).toFixed(2)} KB`);
      console.log('');
      console.log('By Folder:');
      for (const [folder, count] of Object.entries(stats.folders)) {
        console.log(`  ${folder}: ${count} notes`);
      }
      break;
    }

    case 'validate': {
      const ok = validateVault();
      process.exit(ok ? 0 : 1);
      break;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
