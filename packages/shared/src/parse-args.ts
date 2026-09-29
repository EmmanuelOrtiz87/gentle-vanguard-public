/**
 * CLI argument parsing — replaces the 29 ad-hoc `parseArgs` implementations
 * scattered across src/. Migration is incremental (STACK-EVOLUTION-PLAN F2.1);
 * new code MUST use this module instead of `process.argv.slice(2)` idioms.
 *
 * Supported shapes (superset of the copies found in the wild):
 *   --flag            → flags.has('flag')
 *   --key value       → named.get('key') === 'value'
 *   --key=value       → named.get('key') === 'value'
 *   positional        → positionals array
 */

export interface ParsedArgs {
  /** True if --flag present */
  flags: Set<string>;
  /** --key value / --key=value mappings */
  named: Map<string, string>;
  /** Positional (non-flag) arguments in order */
  positionals: string[];
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): ParsedArgs {
  const flags = new Set<string>();
  const named = new Map<string, string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const body = arg.replace(/^-+/, '');
    if (body === '') continue;
    const eq = body.indexOf('=');
    if (eq !== -1) {
      named.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      named.set(body, next);
      i++;
    } else {
      flags.add(body);
    }
  }
  return { flags, named, positionals };
}

export function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

export function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.named.get(name);
}
