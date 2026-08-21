#!/usr/bin/env node
/**
 * Stack CLI - Unified command interface for Gentle-Vanguard
 *
 * Operates with all available tools in the stack:
 *   gv stack health
 *   gv stack watchtower [health|rebuild|autoheal|report]
 *   gv stack dashboard [start|stop|status]
 *   gv stack session [start|close|status]
 *   gv stack codegraph [sync|query|status]
 *   gv stack engram [sync|compact|integrity]
 *   gv stack validate
 *   gv stack tools [list|run <tool>]
 *   gv stack learning [status|suggest]
 *   gv stack knowledge acquire <url>
 *
 * Extensible: Add new commands to COMMANDS registry
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../../adapters/command-runner.js';

const ROOT = resolve(process.cwd());

// ─── Banner & UI ─────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     🛡️  Gentle-Vanguard Stack CLI v1.0                    ║');
  console.log('║     Unified interface for all stack tools                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
}

function printDivider(): void {
  console.log('────────────────────────────────────────────────────────────────');
}

function printError(msg: string): void {
  console.error(`❌ ${msg}`);
}

function printSuccess(msg: string): void {
  console.log(`✅ ${msg}`);
}

function printInfo(msg: string): void {
  console.log(`ℹ️  ${msg}`);
}

// ─── Command Runner ──────────────────────────────────────────────────────────────

interface Command {
  name: string;
  description: string;
  aliases?: string[];
  usage: string;
  handler: (args: string[]) => void | Promise<void>;
}

function runNpxTsx(script: string, args: string[] = []): void {
  const result = runSync('npx', ['tsx', script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpmScript(script: string): void {
  const result = runSync('npm', ['run', script], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────────

const COMMANDS: Command[] = [
  {
    name: 'health',
    description: 'Run complete health check on stack',
    aliases: ['h', 'check'],
    usage: 'stack health [--detailed]',
    handler: (args) => {
      const detailed = args.includes('--detailed') || args.includes('-d');
      printInfo(`Running health check${detailed ? ' (detailed mode)' : ''}...`);
      runNpxTsx('src/core/health-check.ts', detailed ? ['--detailed'] : []);
    },
  },
  {
    name: 'watchtower',
    description: 'Monitor and auto-heal stack components',
    aliases: ['wt', 'monitor'],
    usage: 'stack watchtower [health|rebuild|autoheal|report|continuous]',
    handler: (args) => {
      const action = args[0] || 'health';
      const validActions = ['health', 'rebuild', 'autoheal', 'report', 'continuous'];

      if (!validActions.includes(action)) {
        printError(`Invalid action: ${action}`);
        printInfo(`Valid actions: ${validActions.join(', ')}`);
        process.exit(1);
      }

      printInfo(`Running watchtower: ${action}...`);
      runNpxTsx('src/core/maintenance-watchtower.ts', [`--action=${action}`]);
    },
  },
  {
    name: 'dashboard',
    description: 'Control LLM observability dashboard',
    aliases: ['db', 'dash'],
    usage: 'stack dashboard [start|stop|status]',
    handler: (args) => {
      const action = args[0] || 'status';

      switch (action) {
        case 'start':
          printInfo('Starting dashboard...');
          runNpxTsx('src/dashboard-start.ts');
          break;
        case 'stop':
          printInfo('Stopping dashboard...');
          runNpxTsx('src/dashboard-stop.ts');
          break;
        case 'status':
          printInfo('Checking dashboard status...');
          checkDashboardStatus();
          break;
        default:
          printError(`Unknown action: ${action}`);
          printInfo('Use: start, stop, or status');
          process.exit(1);
      }
    },
  },
  {
    name: 'session',
    description: 'Manage Gentle-Vanguard sessions',
    aliases: ['s', 'ses'],
    usage: 'stack session [start|close|status]',
    handler: (args) => {
      const action = args[0] || 'status';

      switch (action) {
        case 'start':
          printInfo('Starting session autostart pipeline...');
          runNpxTsx('src/core/session-autostart.ts');
          break;
        case 'close':
          printInfo('Closing session...');
          runNpxTsx('src/session-close-orchestrator.ts');
          break;
        case 'status':
          printInfo('Checking session status...');
          checkSessionStatus();
          break;
        default:
          printError(`Unknown action: ${action}`);
          printInfo('Use: start, close, or status');
          process.exit(1);
      }
    },
  },
  {
    name: 'codegraph',
    description: 'Sync and query code knowledge graph',
    aliases: ['cg', 'graph'],
    usage: 'stack codegraph [sync|query|status|update]',
    handler: (args) => {
      const action = args[0] || 'status';

      switch (action) {
        case 'sync':
          printInfo('Syncing codegraph...');
          runNpxTsx('src/codegraph-sync-autostart.ts');
          break;
        case 'update':
          printInfo('Updating codegraph with current changes...');
          runNpmScript('graphify:update');
          break;
        case 'query':
          const query = args[1] || '.';
          printInfo(`Querying codegraph: ${query}...`);
          runNpxTsx('src/cli/graphify.ts', [query]);
          break;
        case 'status':
          checkCodegraphStatus();
          break;
        default:
          printError(`Unknown action: ${action}`);
          process.exit(1);
      }
    },
  },
  {
    name: 'engram',
    description: 'Manage Engram persistent memory',
    aliases: ['mem', 'memory'],
    usage: 'stack engram [sync|compact|integrity|status]',
    handler: (args) => {
      const action = args[0] || 'status';

      switch (action) {
        case 'sync':
          printInfo('Syncing Engram...');
          runNpxTsx('src/engram-auto-sync.ts');
          break;
        case 'compact':
          printInfo('Compacting Engram...');
          runNpxTsx('src/engram-auto-compact.ts');
          break;
        case 'integrity':
          printInfo('Checking Engram integrity...');
          runNpxTsx('src/engram-integrity-check.ts');
          break;
        case 'status':
          checkEngramStatus();
          break;
        default:
          printError(`Unknown action: ${action}`);
          process.exit(1);
      }
    },
  },
  {
    name: 'validate',
    description: 'Run complete stack validation',
    aliases: ['v', 'verify'],
    usage: 'stack validate [--full]',
    handler: (args) => {
      const full = args.includes('--full') || args.includes('-f');
      printInfo(`Running stack validation${full ? ' (full mode)' : ''}...`);
      runNpxTsx('src/stack-verify.ts', full ? ['--full'] : []);
    },
  },
  {
    name: 'tools',
    description: 'List and execute available tools',
    aliases: ['t', 'tool'],
    usage: 'stack tools [list|<tool-name>]',
    handler: (args) => {
      const action = args[0] || 'list';

      if (action === 'list') {
        listAvailableTools();
      } else {
        executeTool(action, args.slice(1));
      }
    },
  },
  {
    name: 'learning',
    description: 'Access learning engine and suggestions',
    aliases: ['learn', 'ai'],
    usage: 'stack learning [status|suggest|patterns]',
    handler: (args) => {
      const action = args[0] || 'status';

      switch (action) {
        case 'status':
          printInfo('Checking learning engine status...');
          runNpxTsx('src/learning-engine.ts', ['--status']);
          break;
        case 'suggest':
          const domain = args[1];
          printInfo(
            domain ? `Getting suggestions for: ${domain}...` : 'Getting improvement suggestions...',
          );
          runNpxTsx('src/learning-engine.ts', domain ? ['--suggest', domain] : ['--suggest']);
          break;
        case 'patterns':
          printInfo('Viewing learned patterns...');
          runNpxTsx('src/learning-engine.ts', ['--patterns']);
          break;
        default:
          printError(`Unknown action: ${action}`);
          process.exit(1);
      }
    },
  },
  {
    name: 'knowledge',
    description: 'Acquire and integrate external knowledge',
    aliases: ['know', 'acquire'],
    usage: 'stack knowledge acquire <url> [--source <name>]',
    handler: (args) => {
      if (args[0] === 'acquire' && args[1]) {
        const url = args[1];
        const sourceIndex = args.indexOf('--source');
        const source = sourceIndex > -1 ? args[sourceIndex + 1] : 'web';

        printInfo(`Acquiring knowledge from: ${url}...`);
        runNpxTsx('src/knowledge-acquisition.ts', ['--fetch', url, '--source', source]);
      } else {
        printError('Usage: stack knowledge acquire <url> [--source <name>]');
        process.exit(1);
      }
    },
  },
  {
    name: 'help',
    description: 'Show this help message',
    aliases: ['?', 'h'],
    usage: 'stack help [command]',
    handler: (args) => {
      if (args[0]) {
        showCommandHelp(args[0]);
      } else {
        showHelp();
      }
    },
  },
];

// ─── Helper Functions ──────────────────────────────────────────────────────────────

function checkDashboardStatus(): void {
  const portsFile = join(ROOT, '.runtime', 'dashboard-ports.json');

  if (!existsSync(portsFile)) {
    printInfo('Dashboard not running (no ports file)');
    return;
  }

  try {
    const ports = JSON.parse(readFileSync(portsFile, 'utf-8'));
    printSuccess('Dashboard configured:');
    printInfo(`  WebSocket Port: ${ports.ws_port || 'N/A'}`);
    printInfo(`  Vite Port: ${ports.vite_port || 'N/A'}`);
  } catch {
    printError('Failed to read dashboard ports');
  }
}

function checkSessionStatus(): void {
  const sessionFile = join(ROOT, '.session', 'session-current.json');

  if (!existsSync(sessionFile)) {
    printInfo('No active session found');
    return;
  }

  try {
    const session = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    printSuccess(`Session found: ${session.id || 'unknown'}`);
    printInfo(`  Status: ${session.status || 'unknown'}`);
    printInfo(`  Started: ${session.startedAt || 'unknown'}`);
  } catch {
    printError('Failed to read session file');
  }
}

function checkCodegraphStatus(): void {
  const graphFile = join(ROOT, 'graphify-out', 'graph.json');

  if (!existsSync(graphFile)) {
    printInfo('Codegraph not built (run: stack codegraph sync)');
    return;
  }

  try {
    const graph = JSON.parse(readFileSync(graphFile, 'utf-8'));
    const nodeCount = graph.nodes?.length || 0;
    const edgeCount = graph.edges?.length || 0;
    printSuccess(`Codegraph ready: ${nodeCount} nodes, ${edgeCount} edges`);
  } catch {
    printError('Failed to read codegraph');
  }
}

function checkEngramStatus(): void {
  const dbFile = join(ROOT, '.runtime', 'engram.db');

  if (!existsSync(dbFile)) {
    printInfo('Engram database not found');
    return;
  }

  printSuccess('Engram database exists');
}

function listAvailableTools(): void {
  printDivider();
  console.log('Available Stack Tools:');
  printDivider();

  const tools = [
    { name: 'health-check', desc: 'Comprehensive health check' },
    { name: 'maintenance-watchtower', desc: 'Auto-healing monitoring' },
    { name: 'dashboard', desc: 'LLM observability dashboard' },
    { name: 'codegraph-sync', desc: 'Code knowledge graph sync' },
    { name: 'engram-sync', desc: 'Memory persistence sync' },
    { name: 'session-autostart', desc: 'Session initialization' },
    { name: 'error-memory', desc: 'Error tracking and learning' },
    { name: 'learning-engine', desc: 'AI learning and suggestions' },
    { name: 'knowledge-acquisition', desc: 'External knowledge fetch' },
    { name: 'stack-verify', desc: 'Full stack validation' },
    { name: 'security-scan', desc: 'Security analysis' },
    { name: 'test-runner', desc: 'Test execution' },
  ];

  tools.forEach((tool) => {
    console.log(`  ${tool.name.padEnd(25)} ${tool.desc}`);
  });

  printDivider();
  printInfo('Run: stack tools <tool-name> to execute');
}

function executeTool(toolName: string, args: string[]): void {
  const toolMap: Record<string, string> = {
    'health-check': 'src/core/health-check.ts',
    'maintenance-watchtower': 'src/core/maintenance-watchtower.ts',
    dashboard: 'src/dashboard-start.ts',
    'codegraph-sync': 'src/codegraph-sync-autostart.ts',
    'engram-sync': 'src/engram-auto-sync.ts',
    'session-autostart': 'src/core/session-autostart.ts',
    'error-memory': 'src/error-memory.ts',
    'learning-engine': 'src/learning-engine.ts',
    'knowledge-acquisition': 'src/knowledge-acquisition.ts',
    'stack-verify': 'src/stack-verify.ts',
    'security-scan': 'src/security-scan.ts',
  };

  const script = toolMap[toolName];

  if (!script) {
    printError(`Unknown tool: ${toolName}`);
    printInfo('Run "stack tools list" to see available tools');
    process.exit(1);
  }

  printInfo(`Executing tool: ${toolName}...`);
  runNpxTsx(script, args);
}

function showCommandHelp(commandName: string): void {
  const cmd = COMMANDS.find((c) => c.name === commandName || c.aliases?.includes(commandName));

  if (!cmd) {
    printError(`Unknown command: ${commandName}`);
    process.exit(1);
  }

  printDivider();
  console.log(`Command: ${cmd.name}`);
  console.log(`Description: ${cmd.description}`);
  if (cmd.aliases?.length) {
    console.log(`Aliases: ${cmd.aliases.join(', ')}`);
  }
  console.log(`Usage: ${cmd.usage}`);
  printDivider();
}

function showHelp(): void {
  printBanner();

  printDivider();
  console.log('USAGE: stack <command> [options]');
  printDivider();
  console.log();

  console.log('COMMANDS:');
  COMMANDS.forEach((cmd) => {
    const aliases = cmd.aliases?.length ? ` [${cmd.aliases.join(', ')}]` : '';
    console.log(`  ${cmd.name.padEnd(12)}${aliases.padEnd(15)} ${cmd.description}`);
  });

  console.log();
  printDivider();
  console.log('EXAMPLES:');
  console.log('  stack health --detailed');
  console.log('  stack watchtower autoheal');
  console.log('  stack dashboard start');
  console.log('  stack session close');
  console.log('  stack codegraph sync');
  console.log('  stack validate --full');
  console.log('  stack learning suggest');
  console.log('  stack knowledge acquire https://docs.example.com --source docs');
  printDivider();
  console.log();
  printInfo('Run "stack help <command>" for detailed help on a specific command');
}

// ─── Completions ───────────────────────────────────────────────────────────────────

function printCompletions(shell: 'bash' | 'zsh' | 'pwsh'): void {
  switch (shell) {
    case 'bash':
      console.log(`_stack_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${COMMANDS.map((c) => c.name).join(' ')}"
  COMPREPLY=($(compgen -W "\$commands" -- "\$cur"))
}
complete -F _stack_completions stack`);
      break;
    case 'zsh':
      console.log(`#compdef stack
_stack() {
  local commands=(${COMMANDS.map((c) => `"${c.name}:${c.description}"`).join(' ')})
  _describe 'command' commands
}
compdef _stack stack`);
      break;
    case 'pwsh':
      console.log(`Register-ArgumentCompleter -CommandName stack -ScriptBlock {
  param(\$wordToComplete)
  \$commands = @('${COMMANDS.map((c) => c.name).join("', '")}')
  \$commands | Where-Object { \$_ -like "\$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new(\$_, \$_)
  }
}`);
      break;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle completions flag
  if (args[0] === '--completions') {
    const shell = (args[1] as 'bash' | 'zsh' | 'pwsh') || 'bash';
    printCompletions(shell);
    return;
  }

  const commandName = args[0] || 'help';
  const commandArgs = args.slice(1);

  const command = COMMANDS.find(
    (cmd) => cmd.name === commandName || cmd.aliases?.includes(commandName),
  );

  if (!command) {
    printError(`Unknown command: ${commandName}`);
    console.log();
    showHelp();
    process.exit(1);
  }

  await command.handler(commandArgs);
}

main().catch((err) => {
  printError(err.message);
  process.exit(1);
});
