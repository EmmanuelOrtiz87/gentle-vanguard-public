/**
 * @gentle-vanguard/shared — single source of truth for primitives that were
 * duplicated across the stack (BM25 x2 with drift, parseArgs x29, fs/json
 * helpers x84). See docs/plans/STACK-EVOLUTION-PLAN-2026.md (F2.1).
 */

export { tokenize, bm25Score, type Bm25Options, BM25_DEFAULTS } from './bm25.js';
export { parseArgs, hasFlag, flagValue, type ParsedArgs } from './parse-args.js';
export { ensureDir, readJson, writeJson, fileExists } from './fs-json.js';
export { ok, err, isOk, isErr, type Result } from './result.js';
