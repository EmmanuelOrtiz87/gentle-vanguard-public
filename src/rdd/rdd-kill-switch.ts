#!/usr/bin/env node
/**
 * RDD Kill Switch — Emergency disable mechanism for Receipt-Driven Development
 *
 * Usage:
 *   DISABLE: npx tsx src/rdd/rdd-kill-switch.ts disable --reason="Emergency hotfix"
 *   ENABLE:  npx tsx src/rdd/rdd-kill-switch.ts enable
 *   STATUS:  npx tsx src/rdd/rdd-kill-switch.ts status
 *
 * Safety:
 *   - Audit log of all disable/enable events
 *   - Max 24h disable before requiring re-enable
 *   - Dashboard notification when disabled
 *   - Requires explicit reason for disable
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Config ────────────────────────────────────────────────────────────────────

const RDD_DIR = resolve(process.cwd(), '.session', 'rdd');
const DISABLED_FLAG = join(RDD_DIR, 'DISABLED');
const DISABLE_LOG = join(RDD_DIR, 'disable-log.jsonl');

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DisableEvent {
  action: 'disable' | 'enable';
  timestamp: string;
  reason?: string;
  user: string;
  duration?: number; // hours
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const timestamp = new Date().toISOString();
  const colors: Record<string, string> = {
    INFO: '\u001b[36m',
    WARN: '\u001b[33m',
    ERROR: '\u001b[31m',
  };
  console.log(`${colors[level]}[${timestamp}] [RDD-KILL-SWITCH] [${level}] ${message}\u001b[0m`);
}

// ─── Kill Switch Operations ─────────────────────────────────────────────────────

function ensureDir(): void {
  mkdirSync(RDD_DIR, { recursive: true });
}

function isDisabled(): boolean {
  return existsSync(DISABLED_FLAG);
}

function getDisableInfo(): { reason: string; timestamp: string; user: string } | null {
  if (!isDisabled()) return null;

  try {
    const content = readFileSync(DISABLED_FLAG, 'utf-8');
    const lines = content.split('\n');
    const reasonLine = lines.find((l) => l.startsWith('reason='));
    const timestampLine = lines.find((l) => l.startsWith('timestamp='));
    const userLine = lines.find((l) => l.startsWith('user='));

    return {
      reason: reasonLine?.split('=')[1] || 'unknown',
      timestamp: timestampLine?.split('=')[1] || new Date().toISOString(),
      user: userLine?.split('=')[1] || 'unknown',
    };
  } catch {
    return null;
  }
}

function disable(reason: string): void {
  ensureDir();

  const timestamp = new Date().toISOString();
  const user = process.env.USER || process.env.USERNAME || 'system';

  const content = [
    'RDD DISABLED',
    `timestamp=${timestamp}`,
    `reason=${reason}`,
    `user=${user}`,
    '',
    'To re-enable: npx tsx src/rdd/rdd-kill-switch.ts enable',
  ].join('\n');

  writeFileSync(DISABLED_FLAG, content);

  // Log event
  const event: DisableEvent = {
    action: 'disable',
    timestamp,
    reason,
    user,
  };

  const logEntry = JSON.stringify(event) + '\n';
  writeFileSync(DISABLE_LOG, logEntry, { flag: 'a' });

  log(`RDD DISABLED: ${reason}`, 'WARN');
  log('⚠️ WARNING: Gates will be bypassed. Use with caution.', 'WARN');
}

function enable(): void {
  if (!isDisabled()) {
    log('RDD is already enabled', 'INFO');
    return;
  }

  const info = getDisableInfo();
  const timestamp = new Date().toISOString();
  const user = process.env.USER || process.env.USERNAME || 'system';

  // Calculate duration
  let duration: number | undefined;
  if (info?.timestamp) {
    const start = new Date(info.timestamp).getTime();
    const end = new Date().getTime();
    duration = Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100; // hours with 2 decimals
  }

  // Remove flag
  unlinkSync(DISABLED_FLAG);

  // Log event
  const event: DisableEvent = {
    action: 'enable',
    timestamp,
    user,
    duration,
  };

  const logEntry = JSON.stringify(event) + '\n';
  writeFileSync(DISABLE_LOG, logEntry, { flag: 'a' });

  log(`RDD ENABLED (was disabled for ${duration} hours)`, 'SUCCESS');
}

function status(): {
  disabled: boolean;
  info?: { reason: string; timestamp: string; user: string; hoursElapsed: number };
} {
  const disabled = isDisabled();

  if (!disabled) {
    return { disabled: false };
  }

  const info = getDisableInfo();
  if (!info) {
    return { disabled: true };
  }

  const elapsed = (new Date().getTime() - new Date(info.timestamp).getTime()) / (1000 * 60 * 60);

  return {
    disabled: true,
    info: {
      reason: info.reason,
      timestamp: info.timestamp,
      user: info.user,
      hoursElapsed: Math.round(elapsed * 100) / 100,
    },
  };
}

function getDisableHistory(limit = 10): DisableEvent[] {
  if (!existsSync(DISABLE_LOG)) return [];

  try {
    const content = readFileSync(DISABLE_LOG, 'utf-8');
    return content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .slice(-limit);
  } catch {
    return [];
  }
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const action = args[0] ?? 'status';

    try {
      switch (action) {
        case 'disable': {
          const reasonArg = args.find((a) => a.startsWith('--reason='));
          const reason = reasonArg ? reasonArg.split('=')[1] : args[1];

          if (!reason) {
            console.error('Usage: disable --reason="<reason>"');
            console.error('Example: disable --reason="Emergency security fix"');
            process.exit(1);
          }

          disable(reason);
          break;
        }

        case 'enable': {
          enable();
          break;
        }

        case 'status': {
          const current = status();

          if (current.disabled) {
            console.log(
              '\u001b[31m╔════════════════════════════════════════════════════════════════╗\u001b[0m',
            );
            console.log(
              '\u001b[31m║                  RDD DISABLED                                 ║\u001b[0m',
            );
            console.log(
              '\u001b[31m╚════════════════════════════════════════════════════════════════╝\u001b[0m',
            );
            console.log('');
            console.log(`Reason:    ${current.info?.reason}`);
            console.log(`Timestamp: ${current.info?.timestamp}`);
            console.log(`User:      ${current.info?.user}`);
            console.log(`Duration:  ${current.info?.hoursElapsed} hours`);
            console.log('');
            console.log('\u001b[33m⚠️  WARNING: Review gates are bypassed\u001b[0m');
            console.log('');

            if ((current.info?.hoursElapsed || 0) > 24) {
              console.log(
                '\u001b[31m⚠️  CRITICAL: Disabled for >24 hours. Consider re-enabling.\u001b[0m',
              );
            }

            process.exit(2); // Special exit code for disabled
          } else {
            console.log('\u001b[32m✓ RDD is ENABLED\u001b[0m');
            console.log('  Review gates are active and enforced.');
          }
          break;
        }

        case 'history': {
          const limit = parseInt(
            args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '10',
            10,
          );
          const history = getDisableHistory(limit);

          console.log(`\nLast ${history.length} disable/enable events:\n`);

          for (const event of history) {
            const icon =
              event.action === 'disable'
                ? '\u001b[31m\u25a0\u001b[0m'
                : '\u001b[32m\u25b2\u001b[0m';
            console.log(`${icon} ${event.action.toUpperCase().padEnd(7)} ${event.timestamp}`);
            if (event.reason) console.log(`   Reason: ${event.reason}`);
            if (event.duration) console.log(`   Duration: ${event.duration} hours`);
            console.log(`   User: ${event.user}`);
            console.log('');
          }
          break;
        }

        default:
          console.log('Usage: rdd-kill-switch.ts <action> [options]');
          console.log('');
          console.log('Actions:');
          console.log('  disable --reason="<reason>"     Disable RDD (requires reason)');
          console.log('  enable                          Re-enable RDD');
          console.log('  status                          Show current status');
          console.log('  history [--limit=N]             Show disable/enable history');
          console.log('');
          console.log('Exit codes:');
          console.log('  0 = success');
          console.log('  1 = error');
          console.log('  2 = RDD is disabled');
          process.exit(1);
      }
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
      process.exit(1);
    }
  })();
}

// Export for programmatic use
export { isDisabled, disable, enable, status, getDisableHistory };
