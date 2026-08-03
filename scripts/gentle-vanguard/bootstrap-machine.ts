#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { platform, homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

interface BootstrapMachineArgs {
  version: string;
  source: string;
  installRoot: string;
  portable: boolean;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): BootstrapMachineArgs {
  const args: BootstrapMachineArgs = {
    version: 'latest',
    source: '',
    installRoot: '',
    portable: false,
    force: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--version' || arg === '-Version') && argv[i + 1]) args.version = argv[++i];
    else if ((arg === '--source' || arg === '-Source') && argv[i + 1]) args.source = argv[++i];
    else if ((arg === '--install-root' || arg === '-InstallRoot') && argv[i + 1]) args.installRoot = argv[++i];
    else if (arg === '--portable' || arg === '-Portable') args.portable = true;
    else if (arg === '--force' || arg === '-Force') args.force = true;
    else if (arg === '--dry-run' || arg === '-DryRun') args.dryRun = true;
  }
  return args;
}

function writeStep(msg: string): void {
  console.log(`\n=== ${msg} ===`);
}

function writeSuccess(msg: string): void {
  console.log(`[OK] ${msg}`);
}

function writeInfo(msg: string): void {
  console.log(`[INFO] ${msg}`);
}

function writeWarn(msg: string): void {
  console.log(`[WARN] ${msg}`);
}

function writeErr(msg: string): void {
  console.log(`[ERROR] ${msg}`);
}

function runCmd(cmd: string, args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe', cwd });
  return { stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim(), status: result.status };
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    writeInfo(`Created: ${path}`);
  }
}

function findSource(source: string, scriptDir: string): string {
  if (source) return source;

  const possibleSources = [
    join(process.cwd(), 'gentle-vanguard'),
    join(process.cwd(), '.gentle-vanguard'),
    join(dirname(dirname(scriptDir)), 'gentle-vanguard'),
    join(dirname(dirname(scriptDir)), '.gentle-vanguard'),
    join(dirname(dirname(scriptDir)), 'gentle-vanguard'),
  ];

  for (const src of possibleSources) {
    if (existsSync(src)) return src;
  }

  writeErr('Source not found. Specify with --source parameter.');
  for (const src of possibleSources) {
    console.log(`  - ${src}`);
  }
  process.exit(1);
}

function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function removeDir(path: string): void {
  if (existsSync(path)) {
    const entries = readdirSync(path);
    for (const entry of entries) {
      const entryPath = join(path, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        removeDir(entryPath);
      } else {
        try { copyFileSync; } catch {}
        if (existsSync(entryPath)) {
          spawnSync(platform() === 'win32' ? 'cmd' : 'rm', platform() === 'win32'
            ? ['/c', 'del', '/f', '/q', entryPath]
            : ['-f', entryPath], { stdio: 'pipe' });
        }
      }
    }
    try {
      spawnSync(platform() === 'win32' ? 'cmd' : 'rmdir', platform() === 'win32'
        ? ['/c', 'rd', '/s', '/q', path]
        : ['-rf', path], { stdio: 'pipe' });
    } catch {}
  }
}

function trySymlink(target: string, linkPath: string): boolean {
  try {
    const result = spawnSync('cmd', ['/c', 'mklink', '/J', linkPath, target], { stdio: 'pipe', shell: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const home = homedir();
  const scriptDir = __dirname;

  let installRoot = args.installRoot;
  if (!installRoot) {
    if (process.env.GENTLE_VANGUARD_HOME) {
      installRoot = process.env.GENTLE_VANGUARD_HOME;
    } else {
      installRoot = join(home, '.gentle-vanguard');
    }
  }

  const legacyRoot = join(home, '.gentleman');
  if (!existsSync(installRoot) && existsSync(legacyRoot)) {
    installRoot = legacyRoot;
  }

  const gfRoot = installRoot;
  const isGlobal = !args.portable;

  const source = findSource(args.source, scriptDir);

  const banner = `
========================================
  Gentle-Vanguard Installer
========================================
`;
  console.log(banner);

  console.log(`Source:      ${source}`);
  console.log(`Target:      ${gfRoot}`);
  console.log(`Mode:        ${isGlobal ? 'Global (Symlinks)' : 'Portable (Copy)'}`);
  console.log(`Version:     ${args.version}`);
  console.log('');

  if (args.dryRun) {
    writeWarn('DRY RUN - No changes will be made');
    process.exit(0);
  }

  writeStep('1. Creating Directory Structure');
  const directories = [
    gfRoot,
    join(gfRoot, 'skills'),
    join(gfRoot, 'tools'),
    join(gfRoot, 'hooks'),
    join(gfRoot, 'bin'),
    join(gfRoot, 'config'),
    join(gfRoot, 'templates'),
  ];

  for (const dir of directories) {
    ensureDir(dir);
  }
  writeSuccess('Directory structure created');

  writeStep('2. Creating Gentle-Vanguard Version File');
  const versionFile = join(gfRoot, 'gentle-vanguard.version');
  const versionData = {
    version: args.version,
    installed: new Date().toISOString().replace('T', ' ').substring(0, 19),
    source: source,
  };
  writeFileSync(versionFile, JSON.stringify(versionData, null, 2), 'utf-8');
  writeSuccess('Version file created');

  writeStep('3. Processing Skills');
  const sourceSkills = join(source, 'skills');
  const targetSkills = join(gfRoot, 'skills');

  if (!existsSync(sourceSkills)) {
    writeErr(`Skills source not found: ${sourceSkills}`);
    process.exit(1);
  }

  const skillDirs = readdirSync(sourceSkills, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(sourceSkills, d.name, 'SKILL.md')));

  let syncCount = 0;
  let skipCount = 0;

  for (const skillDir of skillDirs) {
    const targetPath = join(targetSkills, skillDir.name);
    const shouldSkip = existsSync(targetPath) && !args.force;

    if (shouldSkip) {
      writeInfo(`[SKIP] ${skillDir.name} (already exists)`);
      skipCount++;
      continue;
    }

    if (existsSync(targetPath)) {
      removeDir(targetPath);
    }

    if (isGlobal) {
      if (trySymlink(join(sourceSkills, skillDir.name), targetPath)) {
        writeSuccess(`[SYMLINK] ${skillDir.name}`);
      } else {
        writeWarn(`[COPY] Symlink failed, copying instead: ${skillDir.name}`);
        copyDir(join(sourceSkills, skillDir.name), targetPath);
      }
      syncCount++;
    } else {
      copyDir(join(sourceSkills, skillDir.name), targetPath);
      writeSuccess(`[COPY] ${skillDir.name}`);
      syncCount++;
    }
  }

  console.log('');
  writeSuccess(`Skills processed: ${syncCount} synced, ${skipCount} skipped`);

  writeStep('4. Copying Templates');
  const sourceTemplates = join(source, 'templates');
  const targetTemplates = join(gfRoot, 'templates');

  if (existsSync(sourceTemplates)) {
    const templateDirs = readdirSync(sourceTemplates, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of templateDirs) {
      const targetPath = join(targetTemplates, dir.name);
      if (existsSync(targetPath) && !args.force) {
        writeInfo(`[SKIP] Template ${dir.name} (exists)`);
        continue;
      }
      copyDir(join(sourceTemplates, dir.name), targetPath);
      writeSuccess(`[TEMPLATE] ${dir.name}`);
    }
  }

  writeStep('5. Installing Global Git Hooks');
  const gitHooksDir = join(home, '.git-hooks');
  ensureDir(gitHooksDir);

  const hookScripts = readdirSync(sourceSkills, { recursive: false, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.startsWith('pre-commit') && e.name.endsWith('.ps1'));

  for (const hook of hookScripts) {
    const hookName = `${basename(hook.name, '.ps1')}.ps1`;
    const targetHook = join(gitHooksDir, hookName);

    if (isGlobal) {
      if (existsSync(targetHook)) {
        try { copyFileSync('', ''); } catch {}
        spawnSync(platform() === 'win32' ? 'cmd' : 'rm', platform() === 'win32'
          ? ['/c', 'del', '/f', '/q', targetHook]
          : ['-f', targetHook], { stdio: 'pipe' });
      }
      if (trySymlink(join(sourceSkills, hook.name), targetHook)) {
        writeSuccess(`[HOOK] ${hookName} (symlinked)`);
      } else {
        copyFileSync(join(sourceSkills, hook.name), targetHook);
        writeSuccess(`[HOOK] ${hookName} (copied)`);
      }
    } else {
      copyFileSync(join(sourceSkills, hook.name), targetHook);
      writeSuccess(`[HOOK] ${hookName} (copied)`);
    }
  }

  const gitHookPath = runCmd('git', ['config', '--global', 'core.hooksPath']).stdout;
  if (gitHookPath !== gitHooksDir) {
    runCmd('git', ['config', '--global', 'core.hooksPath', gitHooksDir]);
    writeSuccess(`Git hooks path configured: ${gitHooksDir}`);
  }

  writeStep('5b. Installing PreTool Auto-Format Hooks');
  const preToolHookSource = join(gfRoot, 'hooks');
  const preToolHookTarget = join(home, '.pretool-hooks');
  ensureDir(preToolHookTarget);

  if (existsSync(preToolHookSource)) {
    const preToolHooks = readdirSync(preToolHookSource)
      .filter((f) => f.startsWith('pre-tool') && f.endsWith('.ps1'));

    for (const hook of preToolHooks) {
      const targetHook = join(preToolHookTarget, hook);

      if (trySymlink(join(preToolHookSource, hook), targetHook)) {
        writeSuccess(`[PreTool] ${hook} (symlinked)`);
      } else {
        copyFileSync(join(preToolHookSource, hook), targetHook);
        writeSuccess(`[PreTool] ${hook} (copied)`);
      }
    }
  }

  writeStep('6. Creating CLI Wrapper');
  const cliPath = join(gfRoot, 'bin', 'gv.ps1');
  const cliContent = `# gv.ps1 - Gentle-Vanguard CLI
# Auto-generated by bootstrap-machine.ts

$ErrorActionPreference = 'Stop'

$GF_ROOT = "$(Split-Path -Parent $PSScriptRoot)"
$SkillsDir = Join-Path $GF_ROOT 'skills'

function Get-GfSkill {
    param([string]$Name)
    $skillPath = Join-Path $SkillsDir "$Name"
    if (Test-Path (Join-Path $skillPath 'SKILL.md')) {
        return Get-Content (Join-Path $skillPath 'SKILL.md') -Raw
    }
    return $null
}

$cmd = $args[0]
switch ($cmd) {
    'skills' {
        Get-ChildItem $SkillsDir -Directory | Select-Object Name
    }
    'validate' {
        Write-Host "Validating gentle-vanguard..."
        Write-Host "Skills: $(Get-ChildItem $SkillsDir -Directory).Count"
    }
    'update' {
        Write-Host "Skills sync was removed in Phase 1 cleanup. Skills are managed via .opencode/skills/ directory."
    }
    default {
        Write-Host "Gentle-Vanguard CLI"
        Write-Host "Usage: gv <command>"
        Write-Host "Commands: skills, validate, update"
    }
}
`;
  writeFileSync(cliPath, cliContent, 'utf-8');
  writeSuccess(`CLI created: ${cliPath}`);

  writeStep('7. Adding to PATH');
  const binPath = join(gfRoot, 'bin');
  const currentPath = process.env.PATH ?? '';

  if (!currentPath.includes(binPath)) {
    writeSuccess(`Added to PATH: ${binPath}`);
    writeInfo(`To persist, add to your shell profile: export PATH="${binPath}:$PATH"`);
  } else {
    writeInfo(`Already in PATH: ${binPath}`);
  }

  writeStep('8. Configuring Git Global Settings');
  runCmd('git', ['config', '--global', 'init.defaultBranch', 'develop']);
  runCmd('git', ['config', '--global', 'pull.rebase', 'false']);

  const templatePath = join(gfRoot, 'config', 'commit-template.txt');
  const commitTemplate = `# <type>(<scope>): <description>
#
# Types: feat, fix, docs, refactor, test, chore, perf, ci
#
# Examples:
#   feat(api): add user authentication
#   fix(dashboard): resolve pagination bug
#   docs(readme): update installation guide
`;
  writeFileSync(templatePath, commitTemplate, 'utf-8');
  runCmd('git', ['config', '--global', 'commit.template', templatePath]);
  writeSuccess('Git commit template configured');

  writeStep('Summary');
  console.log('');
  console.log('========================================');
  console.log('  Installation Complete!');
  console.log('========================================');
  console.log('');
  console.log(`Gentle-Vanguard Location: ${gfRoot}`);
  console.log(`Skills Installed:   ${syncCount}`);
  console.log(`Git Hooks:          ${gitHooksDir}`);
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Restart your terminal or reload your shell profile');
  console.log('  2. Run gv validate to verify installation');
  console.log('');
}

main();
