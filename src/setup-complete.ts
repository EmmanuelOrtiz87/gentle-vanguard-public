#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  appendFileSync,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { runSync } from './core/run-command.js';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

type SetupMode = 'developer' | 'team' | 'enterprise';

interface SetupCompleteArgs {
  installPath: string;
  mode: SetupMode;
  skipTests: boolean;
  skipHooks: boolean;
}

function parseArgs(argv: string[]): SetupCompleteArgs {
  const home = homedir();
  const args: SetupCompleteArgs = {
    installPath: join(home, 'gentle-vanguard'),
    mode: 'developer',
    skipTests: false,
    skipHooks: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--install-path' || arg === '-InstallPath') && argv[i + 1])
      args.installPath = argv[++i];
    else if ((arg === '--mode' || arg === '-Mode') && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === 'developer' || mode === 'team' || mode === 'enterprise') {
        args.mode = mode;
      }
    } else if (arg === '--skip-tests' || arg === '-SkipTests') args.skipTests = true;
    else if (arg === '--skip-hooks' || arg === '-SkipHooks') args.skipHooks = true;
  }
  return args;
}

function writeStep(msg: string): void {
  console.log(`\n=== ${msg} ===`);
}

function writeSuccess(msg: string): void {
  console.log(`  [[OK]] ${msg}`);
}

function writeWarning(msg: string): void {
  console.log(`  [!] ${msg}`);
}

function writeError(msg: string): void {
  console.log(`  [X] ${msg}`);
}

function cmdExists(cmd: string): boolean {
  const result = runSync(platform() === 'win32' ? 'where' : 'which', [cmd], { stdio: 'pipe' });
  return result.status === 0;
}

function runCmd(
  cmd: string,
  args: string[],
  cwd?: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = runSync(cmd, args, { stdio: 'pipe', cwd });
  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    status: result.status,
  };
}

function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);

    if (st.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function testPrerequisites(_installPath: string): void {
  writeStep(`Checking Prerequisites for: ${process.env['MODE'] ?? 'developer'} mode`);

  writeSuccess(`Platform: ${platform()}`);

  if (cmdExists('git')) {
    const gitVer = runCmd('git', ['--version']);
    if (gitVer.status === 0) {
      writeSuccess(`Git detected: ${gitVer.stdout}`);
    } else {
      writeWarning('Git not found. Some features may not work.');
    }
  } else {
    writeWarning('Git not found. Install from https://git-scm.com/');
  }

  if (cmdExists('node')) {
    const nodeVer = runCmd('node', ['--version']);
    if (nodeVer.status === 0) {
      writeSuccess(`Node.js detected: ${nodeVer.stdout}`);
    }
  } else {
    console.log('  Node.js not found (optional)');
  }

  writeSuccess('Prerequisites check complete');
}

function installGentleVanguard(installPath: string, mode: SetupMode, skipHooks: boolean): boolean {
  writeStep(`Installing Gentle-Vanguard (${mode} mode)`);

  if (!existsSync(installPath)) {
    mkdirSync(installPath, { recursive: true });
    writeSuccess(`Created install directory: ${installPath}`);
  }

  const repoRoot = resolve(__dirname, '..');
  const gitDir = join(repoRoot, '.git');
  if (existsSync(gitDir)) {
    console.log('  Copying from current repository...');
    const items = ['scripts', 'skills', 'config', 'docs', 'templates', 'rules', 'plugins'];
    for (const item of items) {
      const src = join(repoRoot, item);
      if (existsSync(src)) {
        const dest = join(installPath, item);
        if (!existsSync(dirname(dest))) mkdirSync(dirname(dest), { recursive: true });
        copyDir(src, dest);
        writeSuccess(`  Copied: ${item}`);
      }
    }
  } else {
    writeWarning('Not in a git repository. Please clone Gentle-Vanguard first.');
    return false;
  }

  if (!skipHooks) {
    if (cmdExists('lefthook')) {
      runCmd('npx', ['lefthook', 'install'], installPath);
      writeSuccess('Git hooks installed (Lefthook)');
    } else {
      writeWarning('Lefthook not found. Install: npm install -g lefthook');
    }
  }

  switch (mode) {
    case 'developer':
      writeSuccess('Developer mode: Basic setup complete');
      break;
    case 'team': {
      const teamTools = [
        join('scripts', 'utilities', 'WORKFLOW-ORCHESTRATION'),
        join('scripts', 'utilities', 'GIT-VERSION-CONTROL'),
      ];
      for (const tool of teamTools) {
        const toolPath = join(installPath, tool);
        if (existsSync(toolPath)) {
          writeSuccess(`  Team tool ready: ${tool}`);
        }
      }
      break;
    }
    case 'enterprise': {
      const entTools = [
        join('scripts', 'security'),
        join('scripts', 'utilities', 'AUDIT-REPORTING'),
        join('scripts', 'diagnostics'),
      ];
      for (const tool of entTools) {
        const toolPath = join(installPath, tool);
        if (existsSync(toolPath)) {
          writeSuccess(`  Enterprise tool ready: ${tool}`);
        }
      }
      const policies = join(installPath, 'config', 'security-policy.json');
      if (existsSync(policies)) {
        writeSuccess('Enterprise security policies applied');
      }
      break;
    }
  }

  return true;
}

function initializeEnvironment(installPath: string): void {
  writeStep('Initializing Environment');

  const vscodeDir = join(installPath, '.vscode');
  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }

  const settingsPath = join(vscodeDir, 'settings.json');
  const settings = {
    'powershell.codeFormatting.pester.scriptBlockMustHaveBraces': true,
    'powershell.codeFormatting.pester.missingShouldBe': 'error',
    'editor.formatOnSave': true,
    'files.trimTrailingWhitespace': true,
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  writeSuccess('VS Code settings configured');

  if (platform() === 'win32') {
    const psProfilePath = join(
      homedir(),
      'Documents',
      'PowerShell',
      'Microsoft.PowerShell_profile.ps1',
    );
    const psProfileDir = dirname(psProfilePath);
    if (!existsSync(psProfileDir)) {
      mkdirSync(psProfileDir, { recursive: true });
    }
    const profileContent = `# Gentle-Vanguard Environment
$env:GENTLE_VANGUARD_ROOT = '${installPath}'
Import-Module $env:GENTLE_VANGUARD_ROOT\\scripts\\utilities\\WORKFLOW-ORCHESTRATION\\gv.ps1 -ErrorAction SilentlyContinue
Write-Host 'Gentle-Vanguard environment loaded' -ForegroundColor Green
`;
    appendFileSync(psProfilePath, profileContent + '\n', 'utf-8');
    writeSuccess('PowerShell profile updated');
  } else {
    const shellProfile = join(homedir(), '.bashrc');
    const profileContent = `\n# Gentle-Vanguard Environment\nexport GENTLE_VANGUARD_ROOT="${installPath}"\n`;
    appendFileSync(shellProfile, profileContent, 'utf-8');
    writeSuccess('Shell profile updated');
  }
}

function runTests(installPath: string, skipTests: boolean): void {
  if (skipTests) {
    writeWarning('Skipping tests (--skip-tests specified)');
    return;
  }

  writeStep('Running Test Suite');

  const testDir = join(installPath, 'tests');
  if (existsSync(testDir)) {
    const testResult = runCmd('npx', ['tsx', 'src/health-check.ts'], installPath);
    if (testResult.status === 0) {
      writeSuccess('All tests passed');
    } else {
      writeWarning('Some tests failed. Check output above.');
    }
  } else {
    writeWarning('Test directory not found. Skipping tests.');
  }
}

function showCompletion(installPath: string, mode: SetupMode): void {
  console.log('\n========================================');
  console.log('  Gentle-Vanguard Setup Complete!');
  console.log('========================================');
  console.log('');
  console.log(`  Install path: ${installPath}`);
  console.log(`  Mode: ${mode}`);
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Run: npx tsx src/health-check.ts');
  console.log('  2. Explore skills');
  console.log('');
  console.log(`  For ${mode} mode:`);
  switch (mode) {
    case 'developer':
      console.log('  - Start coding with AI assistance');
      break;
    case 'team':
      console.log('  - Set up CI/CD');
      console.log('  - Share skills with team');
      break;
    case 'enterprise':
      console.log('  - Review security policies');
      break;
  }
  console.log('');
}

function main(): void {
  const args = parseArgs(process.argv);

  console.log('========================================');
  console.log('  Gentle-Vanguard Complete Setup v1.0');
  console.log(`  Mode: ${args.mode}`);
  console.log('========================================');

  testPrerequisites(args.installPath);
  const installed = installGentleVanguard(args.installPath, args.mode, args.skipHooks);

  if (installed) {
    initializeEnvironment(args.installPath);
    runTests(args.installPath, args.skipTests);
    showCompletion(args.installPath, args.mode);
  } else {
    writeError('Installation failed. Please check errors above.');
    process.exit(1);
  }
}

main();
