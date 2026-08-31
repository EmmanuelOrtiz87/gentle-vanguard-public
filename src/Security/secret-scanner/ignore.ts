import { relative } from 'node:path';

export interface IgnoreRule {
  base: string;
  re: RegExp;
  negated: boolean;
}

export const RE_SPECIALS = new Set(['\\', '^', '$', '|', '+', '(', ')', '{', '}']);

export function globToRegex(glob: string, anchored: boolean, dirOnly: boolean): RegExp {
  let out = anchored ? '^' : '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        out += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i++;
    } else if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
        i++;
      } else {
        out += glob.slice(i, close + 1);
        i = close + 1;
      }
    } else {
      out += RE_SPECIALS.has(ch) ? `\\${ch}` : ch;
      i++;
    }
  }
  if (!anchored) out = `(^|/)${out}`;
  if (dirOnly) out += '(/|$)';
  return new RegExp(out);
}

export function parseGitignore(content: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let negated = false;
    let pattern = line;
    if (pattern.startsWith('!')) {
      negated = true;
      pattern = pattern.slice(1);
    }
    let anchored = false;
    if (pattern.startsWith('/')) {
      anchored = true;
      pattern = pattern.slice(1);
    }
    let dirOnly = false;
    if (pattern.endsWith('/')) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    if (!pattern) continue;
    rules.push({ base, re: globToRegex(pattern, anchored, dirOnly), negated });
  }
  return rules;
}

export function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export function isIgnored(absPath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const rel = toPosix(relative(rule.base, absPath));
    if (rule.re.test(rel)) ignored = !rule.negated;
  }
  return ignored;
}

export function isFalsePositive(value: string, falsePositives: string[]): boolean {
  if (falsePositives.length === 0) return false;
  const lower = value.toLowerCase();
  return falsePositives.some((fp) => lower.includes(fp.toLowerCase()));
}
