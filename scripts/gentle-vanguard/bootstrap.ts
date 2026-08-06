#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync, runSyncShell } from './core/run-command.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

interface BootstrapArgs {
  gitUser?: string;
  gitEmail?: string;
  installGitHubRunner?: boolean;
  gitHubRunnerConfigPath?: string;
}

interface HealthReport {
  [key: string]: string;
}

function parseArgs(argv: string[]): BootstrapArgs {
  const args: BootstrapArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--git-user' || arg === '-GitUser') && argv[i + 1]) args.gitUser = argv[++i];
    else if ((arg === '--git-email' || arg === '-GitEmail') && argv[i + 1]) args.gitEmail = argv[++i];
    else if (arg === '--install-github-runner' || arg === '-InstallGitHubRunner') args.installGitHubRunner = true;
    else if ((arg === '--github-runner-config-path' || arg === '-GitHubRunnerConfigPath') && argv[i + 1]) args.gitHubRunnerConfigPath = argv[++i];
  }
  return args;
}

function resolveRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) {
    const base = process.env.GENTLE_VANGUARD_BASE_DIR;
    if (existsSync(join(base, 'config', 'orchestrator.json'))) return base;
  }
  const scriptDir = resolve(__dirname);
  const candidates = [scriptDir, resolve(scriptDir, '..'), resolve(scriptDir, '..', '..')];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'config', 'orchestrator.json'))) return dir;
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'config', 'orchestrator.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  console.error('[bootstrap] ERROR: Could not locate repository root.');
  process.exit(1);
}

function writeStep(msg: string): void {
  console.log(`\n>> ${msg}`);
}

function writeSuccess(msg: string): void {
  console.log(`   OK: ${msg}`);
}

function writeError(msg: string): void {
  console.log(`   ERROR: ${msg}`);
}

function writeInfo(msg: string): void {
  console.log(`   INFO: ${msg}`);
}

function cmdExists(cmd: string): boolean {
  const result = runSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'pipe' });
  return result.status === 0;
}

function runCmd(cmd: string, args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
  const result = runSync(cmd, args, { stdio: 'pipe', cwd });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), status: result.status };
}

function runCmdString(fullCmd: string): { stdout: string; stderr: string; status: number | null } {
  const r = runSyncShell(fullCmd, { stdio: 'pipe' });
  if (r.error && r.status === null) {
    return { stdout: '', stderr: r.error.message, status: 1 };
  }
  return { stdout: r.stdout.trim(), stderr: r.stderr, status: r.status ?? 1 };
}

function main(): void {
  const args = parseArgs(process.argv);
  const root = resolveRoot();
  const configPath = join(root, 'config', 'workspace.config.json');

  writeStep('Step 1: Creating Agnostic Directory Structure...');
  const dirs = ['projects', 'tools', 'config', '.engram-data', 'docs/code-reviews'];
  for (const dir of dirs) {
    const path = join(root, dir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      writeSuccess(`Created: ${dir}/`);
    } else {
      writeInfo(`Existing: ${dir}/`);
    }
  }

  writeStep('Step 2: Verifying Core Dependencies...');

  if (cmdExists('git')) {
    const gitVer = runCmdString('git --version');
    writeSuccess(`Git detected: ${gitVer.stdout}`);
  } else {
    writeError('Git not found. Install it at: https://git-scm.com/');
    process.exit(1);
  }

  if (args.gitUser) {
    runCmd('git', ['config', '--global', 'user.name', args.gitUser]);
  }
  if (args.gitEmail) {
    runCmd('git', ['config', '--global', 'user.email', args.gitEmail]);
  }

  const gitUserCheck = runCmd('git', ['config', '--get', 'user.name']).stdout;
  const gitEmailCheck = runCmd('git', ['config', '--get', 'user.email']).stdout;

  if (!gitUserCheck || !gitEmailCheck) {
    writeStep('Git Identity Configuration...');
    if (!gitUserCheck) {
      console.log('   (Prompt) Enter your name for Git (user.name):');
    }
    if (!gitEmailCheck) {
      console.log('   (Prompt) Enter your email for Git (user.email):');
    }
  }

  const goAvailable = cmdExists('go');
  const engramAvailable = cmdExists('engram');

  if (goAvailable) {
    const goVer = runCmdString('go version');
    writeSuccess(`Go detected: ${goVer.stdout}`);
  } else if (engramAvailable) {
    writeInfo('Go not found. Engram already available - skipping Go requirement.');
    writeInfo('Install Go later for full functionality: winget install GoLang.Go');
  } else {
    writeError('Go (Golang) not found and Engram not available. Install Go: winget install GoLang.Go');
    process.exit(1);
  }

  if (engramAvailable) {
    writeSuccess('Engram CLI detected.');
  } else if (!goAvailable) {
    writeError('Cannot install Engram: Go not found. Install Go first.');
    process.exit(1);
  } else {
    writeStep('Installing Engram CLI from repository...');
    const engramToolDir = join(root, 'scripts', 'utilities', 'engram');
    if (!existsSync(engramToolDir)) {
      runCmd('git', ['clone', 'https://github.com/gentle-vanguard/engram.git', engramToolDir]);
    }
    runCmd('go', ['install', './cmd/engram'], engramToolDir);
    if (cmdExists('engram')) {
      writeSuccess('Engram CLI installed successfully.');
    } else {
      writeError('Could not install Engram. Ensure GOPATH/bin is in your PATH.');
    }
  }

  writeStep('Verifying GitHub CLI (gh)...');
  if (!cmdExists('gh')) {
    console.log('[!] GitHub CLI not detected. To install, visit: https://cli.github.com/');
  } else {
    writeSuccess('GitHub CLI detected.');
  }

  writeStep('Step 3: Deploying Default Configuration...');
  if (!existsSync(configPath)) {
    const defaultConfig = {
      workspaceRoot: '{workspaceRoot}',
      dataRoot: '{dataRoot}',
      aiModelSettings: {
        provider: 'generic',
        model: 'default',
        protocol: 'mcp',
      },
    };
    const dir = join(root, 'config');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    writeSuccess('Configuration generated: config/workspace.config.json');
  } else {
    writeInfo('Existing configuration respected: config/workspace.config.json');
  }

  writeStep('Step 4: Installing Lefthook + Git Hooks...');
  if (existsSync(join(root, '.git'))) {
    const oldHooksPath = runCmd('git', ['config', '--local', 'core.hooksPath']).stdout;
    if (oldHooksPath) {
      runCmd('git', ['config', '--local', '--unset', 'core.hooksPath']);
      writeInfo(`Removed legacy core.hooksPath (${oldHooksPath}). Lefthook manages hooks now.`);
    }

    if (!cmdExists('lefthook')) {
      writeInfo('Lefthook not found. Installing via npm...');
      const npmResult = runCmd('npm', ['install', '-g', 'lefthook']);
      if (npmResult.status === 0) {
        writeSuccess('Lefthook installed globally via npm.');
      } else {
        writeInfo('Global install failed, trying npx...');
      }
    } else {
      const lfVer = runCmdString('lefthook version');
      writeSuccess(`Lefthook already installed: ${lfVer.stdout}`);
    }

    const lefthookInstall = runCmd('npx', ['lefthook', 'install'], root);
    if (lefthookInstall.status === 0) {
      writeSuccess('Lefthook hooks installed via npx.');
    } else {
      writeError('Could not install lefthook hooks. Run npx lefthook install manually.');
    }
  } else {
    writeInfo('Not a Git repository. Skipping hook configuration.');
  }

  writeStep('Step 4b: Scheduled Task - CodeGraph Auto-Sync...');
  if (process.platform === 'win32') {
    const taskName = 'Gentle-Vanguard-CodeGraph-Sync';
    const existingTask = runCmd('powershell', ['-Command', `Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue`]);
    if (!existingTask.stdout) {
      const taskScript = join(root, 'src', 'codegraph-sync-autostart.ts');
      if (existsSync(taskScript)) {
        const psCmd = [
          '-NoProfile', '-NoLogo', '-NonInteractive', '-Command', `npx tsx "${taskScript}"`,
        ];
        const registerCmd = [
          '-Command',
          `$action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument '${psCmd.join(' ')}'; ` +
          `$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date "08:00") -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::FromDays(30)); ` +
          `$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5); ` +
          `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Settings $settings -Force`,
        ];
        const regResult = runCmd('powershell', registerCmd);
        if (regResult.status === 0) {
          writeSuccess(`Scheduled task '${taskName}' created (syncs CodeGraph every hour).`);
        } else {
          writeInfo('Could not create scheduled task (requires admin). Optional - hooks handle sync on every commit/merge.');
        }
      } else {
        writeInfo(`Task script not found at ${taskScript}. Skipping.`);
      }
    } else {
      writeSuccess(`Scheduled task '${taskName}' already exists.`);
    }
  } else {
    writeInfo('Scheduled tasks not supported on this platform. Hooks handle sync.');
  }

  if (args.installGitHubRunner) {
    writeStep('Step 4c: Installing optional GitHub self-hosted runner...');
    writeError('GitHub runner installer was removed in Phase 1 cleanup.');
    writeInfo('Use GitHub Actions or follow: https://docs.github.com/en/actions/hosting-runners');
    process.exit(1);
  }

  writeStep('Step 5: System Health Report (Health Check)...');
  const gitHooksPath = join(root, '.git', 'hooks', 'post-commit');
  const report: HealthReport = {
    Git: cmdExists('git') ? 'PASS' : 'FAIL',
    GitHubCLI: cmdExists('gh') ? 'PASS' : 'INFO: Not installed',
    Go: goAvailable ? 'PASS' : engramAvailable ? 'WARN: Not installed (Engram available)' : 'FAIL',
    Engram: engramAvailable ? 'PASS' : 'FAIL',
    Lefthook: cmdExists('lefthook') ? 'PASS' : 'FAIL',
    'CodeGraph Hooks': existsSync(gitHooksPath) ? 'PASS' : 'FAIL',
    'CodeGraph Task': process.platform === 'win32' ? 'INFO: Not installed (optional)' : 'INFO: N/A (non-Windows)',
    Config: existsSync(configPath) ? 'PASS' : 'FAIL',
  };

  for (const key of Object.keys(report)) {
    const value = report[key];
    const color = value === 'PASS' ? '\x1b[32m' : '\x1b[31m';
    console.log(`   [Checking] ${key} : ${color}${value}\x1b[0m`);
  }

  console.log(`\n\x1b[32m[SUCCESS] Gentle-Vanguard Initialized and Verified!\x1b[0m`);
  console.log(`\x1b[32mYou can now run 'npx tsx src/session-autostart.ts' to start your session.\x1b[0m`);
}

main();
