import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SecretCategory, RiskLevel, PatternMode } from './scanner.js';

export interface SecretScannerConfig {
  version: string;
  name: string;
  description: string;
  enabled: boolean;
  patterns: PatternMode;
  maxFileSizeMB: number;
  entropyThreshold: number;
  entropyEnabled: boolean;
  redactByDefault: boolean;
  maxMatchLength: number;
  contextRadius: number;
  ignoreExtensions: string[];
  skipDirs: string[];
  ignoreFiles: string[];
  riskLevels: Partial<Record<SecretCategory, RiskLevel>>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'secret-scanner.json');

const DEFAULT_CONFIG: SecretScannerConfig = {
  version: '1.0.0',
  name: 'secret-scanner-config',
  description: 'Native secrets / API keys detector (cariddi patterns re-implemented in TS)',
  enabled: true,
  patterns: 'all',
  maxFileSizeMB: 1,
  entropyThreshold: 3.5,
  entropyEnabled: false,
  redactByDefault: true,
  maxMatchLength: 500,
  contextRadius: 80,
  ignoreExtensions: [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.ico',
    '.bmp',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.pdf',
    '.zip',
    '.gz',
    '.tar',
    '.7z',
    '.rar',
    '.bz2',
    '.xz',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.bin',
    '.wasm',
    '.min.js',
    '.map',
    '.lock',
  ],
  skipDirs: [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.runtime',
    '.session',
    '.codegraph',
    '.telemetry',
    '.opencode',
    'logs',
    'tmp',
    '.venv',
    'venv',
    '.next',
    '.turbo',
    '.storybook',
    'graphify-out',
    '.cursor',
    '.claude',
    '.local',
  ],
  ignoreFiles: [],
  riskLevels: {
    aws: 'high',
    gcp: 'high',
    azure: 'high',
    github: 'high',
    gitlab: 'high',
    llm: 'high',
    slack: 'high',
    payment: 'high',
    'private-key': 'high',
    cloud: 'medium',
    generic: 'medium',
  },
};

export function loadConfig(): SecretScannerConfig {
  const raw: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      Object.assign(raw, JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>);
    } catch {
      /* fall back to defaults */
    }
  }
  return {
    version: typeof raw.version === 'string' ? raw.version : DEFAULT_CONFIG.version,
    name: typeof raw.name === 'string' ? raw.name : DEFAULT_CONFIG.name,
    description: typeof raw.description === 'string' ? raw.description : DEFAULT_CONFIG.description,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
    patterns: raw.patterns === 'builtin' ? 'builtin' : 'all',
    maxFileSizeMB:
      typeof raw.maxFileSizeMB === 'number' && raw.maxFileSizeMB > 0
        ? raw.maxFileSizeMB
        : DEFAULT_CONFIG.maxFileSizeMB,
    entropyThreshold:
      typeof raw.entropyThreshold === 'number'
        ? raw.entropyThreshold
        : DEFAULT_CONFIG.entropyThreshold,
    entropyEnabled:
      typeof raw.entropyEnabled === 'boolean' ? raw.entropyEnabled : DEFAULT_CONFIG.entropyEnabled,
    redactByDefault:
      typeof raw.redactByDefault === 'boolean'
        ? raw.redactByDefault
        : DEFAULT_CONFIG.redactByDefault,
    maxMatchLength:
      typeof raw.maxMatchLength === 'number' ? raw.maxMatchLength : DEFAULT_CONFIG.maxMatchLength,
    contextRadius:
      typeof raw.contextRadius === 'number' ? raw.contextRadius : DEFAULT_CONFIG.contextRadius,
    ignoreExtensions: Array.isArray(raw.ignoreExtensions)
      ? (raw.ignoreExtensions as unknown[]).filter((e): e is string => typeof e === 'string')
      : DEFAULT_CONFIG.ignoreExtensions,
    skipDirs: Array.isArray(raw.skipDirs)
      ? (raw.skipDirs as unknown[]).filter((e): e is string => typeof e === 'string')
      : DEFAULT_CONFIG.skipDirs,
    ignoreFiles: Array.isArray(raw.ignoreFiles)
      ? (raw.ignoreFiles as unknown[]).filter((e): e is string => typeof e === 'string')
      : DEFAULT_CONFIG.ignoreFiles,
    riskLevels: {
      ...DEFAULT_CONFIG.riskLevels,
      ...(typeof raw.riskLevels === 'object' && raw.riskLevels !== null
        ? (raw.riskLevels as Partial<Record<SecretCategory, RiskLevel>>)
        : {}),
    },
  };
}
