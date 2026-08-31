import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import { extname, join } from 'node:path';
import { loadConfig } from './config.js';
import { shannonEntropy } from './entropy.js';
import { isFalsePositive, parseGitignore, isIgnored, type IgnoreRule } from './ignore.js';
import { getPatterns, type SecretPattern } from './patterns.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecretCategory =
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'github'
  | 'gitlab'
  | 'llm'
  | 'slack'
  | 'payment'
  | 'cloud'
  | 'generic'
  | 'private-key';

export type RiskLevel = 'high' | 'medium' | 'low';

export type PatternMode = 'builtin' | 'all';

export interface SecretMatch {
  pattern: SecretPattern;
  /** The secret value (capture group if defined, else full regex match). */
  match: string;
  /** Surrounding text (contextRadius chars each side) for human review. */
  context: string;
  /** 1-based line number in the scanned text. */
  line: number;
  /** Origin: file path or URL. */
  source: string;
  /** Shannon entropy (bits/char) of the match when entropy filtering ran. */
  entropyScore?: number;
}

export interface ScanOptions {
  /** Enable Shannon entropy filtering of matches (default from config). */
  entropy?: boolean;
  /** Minimum entropy threshold in bits/char (default from config, 3.5). */
  entropyThreshold?: number;
  /** Drop matches longer than this (0 = no limit). */
  maxMatchLength?: number;
  /** Characters of context to capture around each match. */
  contextRadius?: number;
  /** Which pattern set to use: 'builtin' | 'all' (default from config). */
  patterns?: PatternMode;
}

export interface FileScanOptions extends ScanOptions {
  /** Skip files larger than this many bytes. */
  maxFileSizeBytes?: number;
  /** Extra extensions to skip (merged with config ignoreExtensions). */
  ignoreExtensions?: string[];
  /** Extra directory names to skip (merged with config skipDirs). */
  skipDirs?: string[];
}

// ─── Core scanning ────────────────────────────────────────────────────────────

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineFor(index: number, starts: number[]): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= index) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1;
}

export function scanText(input: string, options: ScanOptions = {}): SecretMatch[] {
  const cfg = loadConfig();
  const mode = options.patterns ?? cfg.patterns;
  const patterns = getPatterns(mode);
  const useEntropy = options.entropy ?? cfg.entropyEnabled;
  const threshold = options.entropyThreshold ?? cfg.entropyThreshold;
  const maxLen = options.maxMatchLength ?? cfg.maxMatchLength;
  const radius = options.contextRadius ?? cfg.contextRadius;
  const lineStarts = buildLineStarts(input);

  const results: SecretMatch[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const flags = pattern.regex.flags.includes('g')
      ? pattern.regex.flags
      : `${pattern.regex.flags}g`;
    const re = new RegExp(pattern.regex.source, flags);
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(input)) !== null) {
      guard++;
      if (guard > 100_000) break;
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const value =
        pattern.captureGroup !== undefined && m[pattern.captureGroup] !== undefined
          ? m[pattern.captureGroup]
          : m[0];
      if (maxLen > 0 && value.length > maxLen) continue;
      if (isFalsePositive(value, pattern.falsePositives)) continue;

      const line = lineFor(m.index, lineStarts);
      const key = `${line}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const start = m.index;
      const end = m.index + m[0].length;
      const ctxStart = Math.max(0, start - radius);
      const ctxEnd = Math.min(input.length, end + radius);

      if (useEntropy) {
        const entropyScore = shannonEntropy(value);
        if (entropyScore < threshold) continue;
        results.push({
          pattern,
          match: value,
          context: input.slice(ctxStart, ctxEnd),
          line,
          source: '',
          entropyScore,
        });
      } else {
        results.push({
          pattern,
          match: value,
          context: input.slice(ctxStart, ctxEnd),
          line,
          source: '',
        });
      }
    }
  }

  return results;
}

// ─── File scanning ────────────────────────────────────────────────────────────

async function walkDir(
  dir: string,
  rules: IgnoreRule[],
  skipDirs: ReadonlySet<string>,
  skipDirPaths: readonly string[],
  out: string[],
): Promise<void> {
  const localRules = [...rules];
  const gitignorePath = join(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      localRules.push(...parseGitignore(readFileSync(gitignorePath, 'utf-8'), dir));
    } catch {
      /* unreadable gitignore is non-fatal */
    }
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      const fullLower = full.replace(/\\/g, '/').toLowerCase();
      if (skipDirPaths.some((p) => fullLower.endsWith(`/${p}`))) continue;
      if (isIgnored(full, localRules)) continue;
      await walkDir(full, localRules, skipDirs, skipDirPaths, out);
    } else if (entry.isFile()) {
      if (isIgnored(full, localRules)) continue;
      out.push(full);
    }
  }
}

async function expandPaths(
  paths: string[],
  skipDirs: ReadonlySet<string>,
  skipDirPaths: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const path of paths) {
    let st;
    try {
      st = await stat(path);
    } catch {
      continue; // unreadable / missing path is skipped
    }
    if (st.isDirectory()) {
      await walkDir(path, [], skipDirs, skipDirPaths, files);
    } else if (st.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export async function scanFiles(
  paths: string[],
  options: FileScanOptions = {},
): Promise<SecretMatch[]> {
  const cfg = loadConfig();
  const maxSizeBytes = options.maxFileSizeBytes ?? Math.max(1, cfg.maxFileSizeMB) * 1024 * 1024;
  const rawSkip = [
    ...cfg.skipDirs.map((d) => d.toLowerCase()),
    ...(options.skipDirs ?? []).map((d) => d.toLowerCase()),
  ];
  // Directory-name matching (e.g. "node_modules") vs path-suffix matching (e.g. "public/skills").
  const skipDirs = new Set(rawSkip.filter((d) => !d.includes('/') && !d.includes('\\')));
  const skipDirPaths = rawSkip
    .filter((d) => d.includes('/') || d.includes('\\'))
    .map((d) => d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter((d) => d.length > 0);
  const ignoreExt = new Set([
    ...cfg.ignoreExtensions,
    ...(options.ignoreExtensions ?? []).map((e) =>
      e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`,
    ),
  ]);
  const scanOpts: ScanOptions = {
    entropy: options.entropy,
    entropyThreshold: options.entropyThreshold,
    maxMatchLength: options.maxMatchLength,
    contextRadius: options.contextRadius,
    patterns: options.patterns,
  };

  const files = await expandPaths(paths, skipDirs, skipDirPaths);
  const results: SecretMatch[] = [];

  const ignoreFileSet = new Set(cfg.ignoreFiles.map((f) => f.replace(/\\/g, '/').toLowerCase()));

  for (const file of files) {
    const rel = file.replace(/\\/g, '/').toLowerCase();
    if (ignoreFileSet.has(rel) || [...ignoreFileSet].some((ig) => rel.endsWith(`/${ig}`))) {
      continue;
    }
    const ext = extname(file).toLowerCase();
    if (ignoreExt.has(ext)) continue;
    let st;
    try {
      st = await stat(file);
    } catch {
      continue;
    }
    if (st.size > maxSizeBytes) continue;
    try {
      const content = await readFile(file, 'utf-8');
      if (content.includes('\u0000')) continue; // binary sniff
      const matches = scanText(content, scanOpts);
      for (const m of matches) {
        results.push({ ...m, source: file });
      }
    } catch {
      /* skip unreadable files */
    }
  }

  return results;
}

// ─── URL scanning ─────────────────────────────────────────────────────────────

const MAX_URL_BYTES = 10 * 1024 * 1024;

function fetchUrl(url: string, timeoutMs: number, redirectsLeft: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      rejectPromise(new Error(`Invalid URL: ${url}`));
      return;
    }
    const lib = u.protocol === 'https:' ? httpsGet : u.protocol === 'http:' ? httpGet : undefined;
    if (!lib) {
      rejectPromise(new Error(`Unsupported URL protocol: ${u.protocol}`));
      return;
    }
    const req = lib(
      u,
      {
        headers: {
          'User-Agent': 'gentle-vanguard-secret-scanner/1.0',
          Accept: 'text/plain,text/html,*/*',
        },
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            rejectPromise(new Error(`Too many redirects while fetching ${url}`));
            return;
          }
          const next = new URL(location, u).href;
          fetchUrl(next, timeoutMs, redirectsLeft - 1).then(resolvePromise, rejectPromise);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          rejectPromise(new Error(`HTTP ${status} while fetching ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_URL_BYTES) {
            res.destroy();
            rejectPromise(new Error(`Response for ${url} exceeds ${MAX_URL_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', rejectPromise);
      },
    );
    req.on('error', rejectPromise);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
  });
}

export async function scanUrl(url: string, options: ScanOptions = {}): Promise<SecretMatch[]> {
  const content = await fetchUrl(url, 30_000, 5);
  const matches = scanText(content, options);
  return matches.map((m) => ({ ...m, source: url }));
}
