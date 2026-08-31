#!/usr/bin/env node
/**
 * Auth session stub — disabled by design in session-autostart.config.json.
 * Auth is demand-driven, not session-start. Exists so config path resolves.
 * TS migration of scripts/utilities/auth-session.ps1
 */
const args = process.argv.slice(2);
const quiet = args.includes('--quiet') || args.includes('-Quiet');

if (!quiet) {
  console.log('[auth-session] Stub: auth-session is disabled in pipeline config. Skipping.');
}
process.exit(0);
