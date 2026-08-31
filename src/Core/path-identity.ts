/**
 * path-identity.ts — Path comparison with correct identity semantics per platform
 *
 * Absorbed natively from gentle-ai v2.5.0-rc.3 (#3888: "bootstrap-root comparison
 * made path-identity-correct") and the v2.4.0 Windows lane work ("path
 * canonicalization, byte-range locking and case sensitivity fixes").
 *
 * The defect this module removes: comparing resolved paths with raw
 * `startsWith()` / `===`. On Windows that is wrong three ways:
 *   1. The filesystem is case-insensitive — `C:\Repo` and `c:\repo` are the same
 *      directory but differ as strings.
 *   2. Separators leak through — `C:/repo/a` vs `C:\repo\a`.
 *   3. No boundary check — `C:\repo-evil` startsWith `C:\repo` and passes a
 *      containment guard that should reject it.
 *
 * Rules:
 *   - canonicalPath() normalizes separators AND case when the platform FS is
 *     case-insensitive (win32 always; darwin default APFS; opt-in elsewhere).
 *   - samePath() compares canonical forms only.
 *   - isWithinRoot() accepts exactly `root` itself or `root + separator + ...`.
 *   - No function touches the filesystem — identity is a pure string property,
 *     so it stays fast and side-effect free.
 *
 * Usage:
 *   import { samePath, isWithinRoot } from '../core/path-identity.js';
 *   if (!isWithinRoot(resolved, allowedBase)) return null;   // was: startsWith
 */

import { resolve, sep } from 'path';

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

export interface PathIdentityOptions {
  /** Force case-insensitive comparison on platforms not detected as insensitive. */
  caseInsensitive?: boolean;
}

function fsCaseInsensitive(opts?: PathIdentityOptions): boolean {
  if (opts?.caseInsensitive !== undefined) return opts.caseInsensitive;
  return IS_WINDOWS || IS_MAC;
}

function normalizeSeparators(p: string): string {
  return IS_WINDOWS ? p.split('/').join('\\') : p;
}

function stripTrailingSep(p: string): string {
  // Keep the root of a drive (`C:\`) and POSIX root (`/`) intact; strip a
  // trailing separator everywhere else so `a\b\` and `a\b` are one identity.
  if (IS_WINDOWS && /^[a-zA-Z]:\\?$/.test(p)) return p.endsWith('\\') ? p : `${p}\\`;
  if (p === '/') return p;
  while (p.length > 1 && p.endsWith(sep)) p = p.slice(0, -1);
  return p;
}

/**
 * Canonical form of a path for identity comparison: resolved, separators
 * normalized, trailing separator stripped, case folded when the platform
 * filesystem is case-insensitive. UNC `\\?\` prefixes are preserved.
 */
export function canonicalPath(p: string, opts?: PathIdentityOptions): string {
  const resolved = normalizeSeparators(resolve(p));
  const stripped = stripTrailingSep(resolved);
  return fsCaseInsensitive(opts) ? stripped.toLowerCase() : stripped;
}

/** True when both paths denote the same filesystem location on this platform. */
export function samePath(a: string, b: string, opts?: PathIdentityOptions): boolean {
  return canonicalPath(a, opts) === canonicalPath(b, opts);
}

/**
 * True when `child` is `root` itself or located underneath it. Rejects sibling
 * prefixes (`C:\repo-evil` under `C:\repo`) — the boundary bug startsWith had.
 */
export function isWithinRoot(child: string, root: string, opts?: PathIdentityOptions): boolean {
  const c = canonicalPath(child, opts);
  const r = canonicalPath(root, opts);
  if (c === r) return true;
  return c.startsWith(r + sep);
}

/**
 * Guarded resolution of `userPath` against `allowedBase`: resolves and checks
 * containment with correct identity. Returns null on escape — a typed boundary
 * replacement for the old `startsWith` safePath pattern.
 */
export function safeResolveWithin(
  userPath: string,
  allowedBase: string,
  opts?: PathIdentityOptions,
): string | null {
  const resolved = resolve(allowedBase, userPath);
  return isWithinRoot(resolved, allowedBase, opts) ? resolved : null;
}

// CLI para debugging
const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMainModule) {
  const [a, b] = process.argv.slice(2);
  if (a && b) {
    console.log(`samePath:      ${samePath(a, b)}`);
    console.log(`isWithinRoot:  ${isWithinRoot(a, b)}`);
    console.log(`canonical(a):  ${canonicalPath(a)}`);
    console.log(`canonical(b):  ${canonicalPath(b)}`);
  } else {
    console.log('usage: npx tsx src/core/path-identity.ts <pathA> <pathB>');
  }
}
