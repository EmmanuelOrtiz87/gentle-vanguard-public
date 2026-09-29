/**
 * fs/json helpers — consolidates the ~84 ensureDir/readJson/writeJson copies.
 * JSON parse failures throw with the file path in the message (the #1 blind
 * spot of the scattered copies: `JSON.parse(readFileSync(...))` with no
 * filename in the stack trace).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function readJson<T = unknown>(path: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`[fs-json] cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`[fs-json] invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

export function writeJson(path: string, data: unknown, pretty = true): void {
  ensureDir(dirname(path));
  writeFileSync(path, pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data));
}
