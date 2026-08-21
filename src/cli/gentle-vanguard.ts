#!/usr/bin/env node

/**
 * gentle-vanguard.ts — Main entry point (TS replacement for gentle-vanguard.ps1)
 *
 * Launches the dashboard, shows version info, checks updates.
 *
 * Usage:
 *   npx tsx src/cli/gentle-vanguard.ts --dashboard   Start web dashboard
 *   npx tsx src/cli/gentle-vanguard.ts --version     Show version
 *   npx tsx src/cli/gentle-vanguard.ts --help        Show help
 */

import { run, runSync, runSyncShell } from '../../adapters/command-runner.js';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const VERSION = '3.8.1';

const args = process.argv.slice(2);
const flags = {
  dashboard: args.includes('--dashboard') || args.includes('-Dashboard'),
  version: args.includes('--version') || args.includes('-Version'),
  help: args.includes('--help') || args.includes('-Help') || args.length === 0,
};

function showBanner(): void {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log(`║   Gentle-Vanguard v${VERSION}                              ║`);
  console.log('║   AI-Powered Development Orchestrator                     ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
}

function showHelp(): void {
  showBanner();
  console.log('Usage:');
  console.log('  npx tsx src/cli/gentle-vanguard.ts --dashboard    Start the web dashboard');
  console.log('  npx tsx src/cli/gentle-vanguard.ts --version     Show version');
  console.log('  npx tsx src/cli/gentle-vanguard.ts --help        Show this help');
  console.log('');
  console.log('For more information: https://github.com/EmmanuelOrtiz87/gentle-vanguard');
  console.log('');
}

async function main(): Promise<void> {
  if (flags.help) {
    showHelp();
    process.exit(0);
  }

  if (flags.version) {
    console.log(`Gentle-Vanguard v${VERSION}`);
    process.exit(0);
  }

  if (flags.dashboard) {
    showBanner();
    console.log(`Starting Gentle-Vanguard Dashboard v${VERSION}...`);

    const dashboardPath = join(ROOT, 'apps', 'web-dashboard');
    if (!existsSync(dashboardPath)) {
      console.error(`Dashboard not found at ${dashboardPath}`);
      process.exit(1);
    }

    // Start the WebSocket server
    const wsServer = run('npx', ['tsx', 'apps/web-dashboard/server/websocket-server.ts'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    wsServer.stdout?.on('data', (d: Buffer) => process.stdout.write(`[WS] ${d}`));
    wsServer.stderr?.on('data', (d: Buffer) => process.stderr.write(`[WS] ${d}`));

    // Start the Vite dev server
    console.log('Opening browser at http://localhost:5173');
    if (process.platform === 'win32') {
      runSyncShell('start http://localhost:5173', { timeout: 5000 });
    } else if (process.platform === 'darwin') {
      runSync('open', ['http://localhost:5173'], { timeout: 5000 });
    } else {
      runSync('xdg-open', ['http://localhost:5173'], { timeout: 5000 });
    }

    const vite = run('pnpm', ['dev'], {
      cwd: dashboardPath,
      stdio: 'inherit',
    });

    vite.on('close', (code: number | null) => {
      wsServer.kill();
      process.exit(code ?? 0);
    });

    wsServer.on('close', () => {
      vite.kill();
    });

    return;
  }

  // Default: show banner and usage
  showBanner();
  console.log('Usage:');
  console.log('  npx tsx src/cli/gentle-vanguard.ts --dashboard    Start the web dashboard');
  console.log('  npx tsx src/cli/gentle-vanguard.ts --version     Show version');
  console.log('  npx tsx src/cli/gentle-vanguard.ts --help        Show this help');
  console.log('');
  console.log('Quick commands:');
  console.log('  npm run gv info          Stack information');
  console.log('  npm run gv health        Nexus DB health');
  console.log('  npm run gv check         Watchtower health check');
  console.log('  npm run gv list          List all skills');
  console.log('');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
