#!/usr/bin/env node
/**
 * witr-cli.ts — Command-line interface for the witr wrapper.
 *
 * Usage:
 *   npx tsx src/web/witr-cli.ts process <pid>
 *   npx tsx src/web/witr-cli.ts pid <pid>
 *   npx tsx src/web/witr-cli.ts port <port>
 *   npx tsx src/web/witr-cli.ts file <path>
 *   npx tsx src/web/witr-cli.ts container <name>
 *   npx tsx src/web/witr-cli.ts install
 *   npx tsx src/web/witr-cli.ts status
 *   npx tsx src/web/witr-cli.ts --help
 *
 * Flags:
 *   --short   print only the causal chain (name -> name -> name)
 *   --chain   print only the causal chain links (same as --short)
 *   --json    print full JSON (default)
 */

import {
  witr,
  isWitrInstalled,
  ensureWitrInstalled,
  WITR_VERSION,
  WITR_BIN_PATH,
} from './witr-wrapper.js';
import type { ProcessChain, FileChain, ContainerChain } from './witr-wrapper.js';

function printCausalChain(chain: ProcessChain | FileChain | ContainerChain): void {
  const names = chain.causalChain.map((link) => `${link.name} (pid ${link.pid})`);
  console.log(names.join(' \u2192 '));
}

function printSummary(chain: ProcessChain | FileChain | ContainerChain): void {
  console.log(`Process   : ${chain.name} (pid ${chain.pid})`);
  console.log(`Command   : ${chain.command}`);
  if (chain.source)
    console.log(`Source    : ${chain.source}${chain.sourceName ? ` (${chain.sourceName})` : ''}`);
  if (chain.health) console.log(`Health    : ${chain.health}`);
  if ('path' in chain) console.log(`File      : ${(chain as FileChain).path}`);
  if ('containerName' in chain) {
    const c = chain as ContainerChain;
    console.log(`Container : ${c.containerName}${c.image ? ` (${c.image})` : ''}`);
  }
  if (chain.warnings.length > 0) {
    console.log(`Warnings  : ${chain.warnings.join('; ')}`);
  }
  console.log('\nCausal chain:');
  printCausalChain(chain);
}

function usage(): void {
  console.log(`witr v${WITR_VERSION} — why is this running?
  npx tsx src/web/witr-cli.ts process <pid>
  npx tsx src/web/witr-cli.ts port <port>
  npx tsx src/web/witr-cli.ts file <path>
  npx tsx src/web/witr-cli.ts container <name>
  npx tsx src/web/witr-cli.ts install
  npx tsx src/web/witr-cli.ts status`);
}

async function main() {
  const args = process.argv.slice(2);
  const short = args.includes('--short') || args.includes('--chain');
  const command = args.find((a) => !a.startsWith('--')) ?? '';

  switch (command) {
    case 'process':
    case 'pid': {
      const pid = parseInt(args[1] ?? '0', 10);
      const chain = await witr.traceProcess(pid);
      if (short) {
        printCausalChain(chain);
      } else {
        printSummary(chain);
        console.log(JSON.stringify(chain, null, 2));
      }
      break;
    }
    case 'port': {
      const port = parseInt(args[1] ?? '0', 10);
      const chain = await witr.tracePort(port);
      if (short) {
        printCausalChain(chain);
      } else {
        printSummary(chain);
        console.log(JSON.stringify(chain, null, 2));
      }
      break;
    }
    case 'file': {
      const chain = await witr.traceFile(args[1] ?? '');
      if (short) {
        printCausalChain(chain);
      } else {
        printSummary(chain);
        console.log(JSON.stringify(chain, null, 2));
      }
      break;
    }
    case 'container': {
      const chain = await witr.traceContainer(args[1] ?? '');
      if (short) {
        printCausalChain(chain);
      } else {
        printSummary(chain);
        console.log(JSON.stringify(chain, null, 2));
      }
      break;
    }
    case 'install':
      console.log(ensureWitrInstalled() ? `installed: ${WITR_BIN_PATH}` : 'install failed');
      break;
    case 'status':
      console.log(isWitrInstalled() ? `installed: ${WITR_BIN_PATH}` : 'not installed');
      break;
    default:
      usage();
      if (command) {
        console.error(`Unknown command: ${command}`);
        process.exit(1);
      }
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
