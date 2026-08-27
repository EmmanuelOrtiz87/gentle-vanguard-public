#!/usr/bin/env node
/**
 * Secret Scanner — native secrets / API keys detection engine (TypeScript).
 *
 * Absorbs the DETECTION KNOWLEDGE of cariddi (Go, GPL-3.0) as an original
 * TypeScript implementation. The credential formats below are public technical
 * facts (provider-documented token layouts); the code, structure, types and
 * scanning pipeline are our own. No GPL code is copied or derived.
 *
 * Features:
 *   - 80+ detection patterns across AWS / GCP / Azure / GitHub / GitLab / LLM /
 *     Slack / payments / cloud / generic / private-key categories.
 *   - Optional Shannon entropy filter (>= threshold) to drop low-entropy
 *     false positives.
 *   - File scanning with basic .gitignore support, extension-based binary
 *     exclusion, configurable skip dirs and max file size (default 1 MB).
 *   - URL scanning via node:http/https (zero external dependencies).
 *   - Redaction helper (first 4 + last 4 chars) and risk report builder.
 *
 * Usage:
 *   npx tsx src/secret-scanner-cli.ts --scan <file|url>
 *   npx tsx src/secret-scanner-cli.ts --dir <dir>
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export interface SecretPattern {
  /** Stable, human-readable identifier. */
  name: string;
  description: string;
  category: SecretCategory;
  /** Default risk for this pattern (overridable per-category via config). */
  risk: RiskLevel;
  /** The detection regex. Literal regex facts for public token formats. */
  regex: RegExp;
  /** Known false-positive substrings (case-insensitive containment check). */
  falsePositives: string[];
  /**
   * When set, the secret value is extracted from this capture group instead
   * of the full regex match (used by keyword-context patterns).
   */
  captureGroup?: number;
  /** High-confidence prefix-based patterns keep true; contextual ones false. */
  builtin?: boolean;
}

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

export interface SecretReport {
  scannedAt: string;
  total: number;
  byCategory: Record<string, number>;
  byRisk: Record<RiskLevel, number>;
  matches: SecretMatch[];
  redacted: boolean;
}

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

// ─── Pattern catalog ──────────────────────────────────────────────────────────
// Credential token formats are public, provider-documented technical facts.

export const PATTERNS: SecretPattern[] = [
  // ── AWS ───────────────────────────────────────────────────────────────────
  {
    name: 'AWS Access Key ID',
    description: 'AWS IAM access key ID (AKIA/ASIA/A3T… prefixes, 20 chars).',
    category: 'aws',
    risk: 'high',
    regex: /\b((A3T[A-Z0-9]|AKIA|ACCA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA|ASCA|APKA)[A-Z0-9]{16})\b/,
    falsePositives: [],
  },
  {
    name: 'AWS Secret Access Key',
    description: 'AWS secret access key (40-char base62 value near an "aws" keyword).',
    category: 'aws',
    risk: 'high',
    regex: /aws[\s\S]{0,20}["']([0-9A-Za-z/+]{40})["']/i,
    falsePositives: [],
    captureGroup: 1,
  },
  {
    name: 'AWS MWS Key',
    description: 'Amazon Marketplace Web Service key (amzn.mws. UUID).',
    category: 'aws',
    risk: 'high',
    regex: /amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    falsePositives: [],
  },
  {
    name: 'AWS S3 Bucket URL',
    description: 'AWS S3 / Alibaba OSS bucket reference (s3:// or oss:// URI).',
    category: 'aws',
    risk: 'low',
    regex: /\b(?:s3|oss):\/\/[a-zA-Z0-9._-]+/,
    falsePositives: [],
  },

  // ── Azure ─────────────────────────────────────────────────────────────────
  {
    name: 'Azure AD Client Secret',
    description: 'Azure AD / Entra client secret value near an azure/client-secret keyword.',
    category: 'azure',
    risk: 'high',
    regex: /(?:azure|client[_-]?secret)[\s\S]{0,30}["']?([A-Za-z0-9_~-]{34,44})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },

  // ── GCP / Google ──────────────────────────────────────────────────────────
  {
    name: 'GCP API Key',
    description: 'Google Cloud Platform API key (AIza + 35 chars).',
    category: 'gcp',
    risk: 'high',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    falsePositives: [],
  },
  {
    name: 'Google Maps API Key',
    description: 'Google Maps API key (AIza + 35 chars; deduplicated with GCP API Key).',
    category: 'gcp',
    risk: 'high',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    falsePositives: [],
    builtin: false,
  },
  {
    name: 'GCP OAuth Token',
    description: 'Google OAuth access token (ya29. + 30+ chars).',
    category: 'gcp',
    risk: 'high',
    regex: /\bya29\.[0-9A-Za-z_-]{30,}\b/,
    falsePositives: [],
  },
  {
    name: 'GCP Service Account',
    description: 'Google service-account JSON marker ("type": "service_account").',
    category: 'gcp',
    risk: 'medium',
    regex: /["']type["']\s*:\s*["']service_account["']/,
    falsePositives: [],
  },
  {
    name: 'Firebase Database URL',
    description: 'Firebase Realtime Database / hosting endpoint (configuration leak).',
    category: 'gcp',
    risk: 'low',
    regex: /\b[a-z0-9.-]+\.(?:firebaseio|firebaseapp)\.com\b/i,
    falsePositives: [],
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    name: 'GitHub Personal Access Token',
    description: 'GitHub classic PAT (ghp_ + 36 chars).',
    category: 'github',
    risk: 'high',
    regex: /\bghp_[0-9A-Za-z]{36}\b/,
    falsePositives: [],
  },
  {
    name: 'GitHub OAuth Access Token',
    description: 'GitHub OAuth access token (gho_ + 36 chars).',
    category: 'github',
    risk: 'high',
    regex: /\bgho_[0-9A-Za-z]{36}\b/,
    falsePositives: [],
  },
  {
    name: 'GitHub App Token',
    description: 'GitHub App user/server installation token (ghu_/ghs_ + 36 chars).',
    category: 'github',
    risk: 'high',
    regex: /\b(?:ghu|ghs)_[0-9A-Za-z]{36}\b/,
    falsePositives: [],
  },
  {
    name: 'GitHub Refresh Token',
    description: 'GitHub refresh token (ghr_ + 76 chars).',
    category: 'github',
    risk: 'high',
    regex: /\bghr_[0-9A-Za-z]{76}\b/,
    falsePositives: [],
  },

  // ── GitLab ────────────────────────────────────────────────────────────────
  {
    name: 'GitLab Personal Access Token',
    description: 'GitLab personal access token (glpat- + 20 chars).',
    category: 'gitlab',
    risk: 'high',
    regex: /\bglpat-[0-9A-Za-z_-]{20}\b/,
    falsePositives: [],
  },
  {
    name: 'GitLab CI/CD Job Token',
    description: 'GitLab CI/CD job token (glcbt- + short id + 20 chars).',
    category: 'gitlab',
    risk: 'medium',
    regex: /\bglcbt-[0-9A-Za-z]{1,5}_[0-9A-Za-z_-]{20}\b/,
    falsePositives: [],
  },
  {
    name: 'GitLab Runner Token',
    description: 'GitLab Runner authentication token (glrt- + 20 chars).',
    category: 'gitlab',
    risk: 'medium',
    regex: /\bglrt-[0-9A-Za-z_-]{20}\b/,
    falsePositives: [],
  },
  {
    name: 'GitLab Deploy Token',
    description: 'GitLab deploy token (gldt- + 20 chars).',
    category: 'gitlab',
    risk: 'medium',
    regex: /\bgldt-[0-9A-Za-z_-]{20}\b/,
    falsePositives: [],
  },

  // ── LLM providers ─────────────────────────────────────────────────────────
  {
    name: 'OpenAI API Key',
    description: 'OpenAI API key (sk- + 20 chars + T3BlbkFJ marker + 20 chars).',
    category: 'llm',
    risk: 'high',
    regex: /\bsk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}\b/,
    falsePositives: [],
  },
  {
    name: 'OpenAI Project/Service Key',
    description: 'OpenAI project/service/admin key (sk-proj|svcacct|admin-…T3BlbkFJ…).',
    category: 'llm',
    risk: 'high',
    regex: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,120}T3BlbkFJ[A-Za-z0-9_-]{40,120}\b/,
    falsePositives: [],
  },
  {
    name: 'Anthropic API Key',
    description: 'Anthropic API key (sk-ant-…-… 90-110 chars).',
    category: 'llm',
    risk: 'high',
    regex: /\bsk-ant-(?:admin|api|at)[0-9]{2}-[a-zA-Z0-9_-]{90,110}\b/,
    falsePositives: [],
  },
  {
    name: 'Perplexity API Key',
    description: 'Perplexity API key (pplx- + 48 chars).',
    category: 'llm',
    risk: 'high',
    regex: /\bpplx-[a-zA-Z0-9]{48}\b/,
    falsePositives: [],
  },

  // ── Slack / messaging ─────────────────────────────────────────────────────
  {
    name: 'Slack Token',
    description: 'Slack legacy/bot/app token (xox[baprs]-…).',
    category: 'slack',
    risk: 'high',
    regex: /\bxox[baprs]-[0-9A-Za-z]{10,48}\b/,
    falsePositives: [],
  },
  {
    name: 'Slack Webhook',
    description: 'Slack incoming webhook URL (hooks.slack.com/services/T…/B…/…).',
    category: 'slack',
    risk: 'high',
    regex:
      /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Za-z_-]{8}\/B[0-9A-Za-z_-]{8}\/[0-9A-Za-z_-]{24}/,
    falsePositives: [],
  },
  {
    name: 'Discord Bot Token',
    description: 'Discord bot token (M/T- prefix + base64 3-part payload).',
    category: 'generic',
    risk: 'high',
    regex: /\b[mMtT][0-9A-Za-z_-]{23}\.[0-9A-Za-z_-]{6}\.[0-9A-Za-z_-]{27}\b/,
    falsePositives: [],
  },
  {
    name: 'Discord Webhook',
    description: 'Discord webhook URL (discord.com/api/webhooks/{id}/{token}).',
    category: 'generic',
    risk: 'high',
    regex:
      /https:\/\/(?:discord(?:app)?|ptb\.discord|canary\.discord)\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/,
    falsePositives: [],
  },
  {
    name: 'Telegram Bot Token',
    description: 'Telegram bot token ({bot_id}:{35 alnum}).',
    category: 'generic',
    risk: 'high',
    regex: /\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\b/,
    falsePositives: [],
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    name: 'Stripe Live Secret Key',
    description: 'Stripe live secret/restricted key (sk_live_/rk_live_ + 24 chars).',
    category: 'payment',
    risk: 'high',
    regex: /\b(?:sk|rk)_live_[0-9A-Za-z]{24}\b/,
    falsePositives: [],
  },
  {
    name: 'Square Access Token',
    description: 'Square personal access token (sq0atp- + 22 chars).',
    category: 'payment',
    risk: 'high',
    regex: /\bsq0atp-[0-9A-Za-z_-]{22}\b/,
    falsePositives: [],
  },
  {
    name: 'Square OAuth Secret',
    description: 'Square OAuth secret (sq0csp- + 43 chars).',
    category: 'payment',
    risk: 'high',
    regex: /\bsq0csp-[0-9A-Za-z_-]{43}\b/,
    falsePositives: [],
  },
  {
    name: 'PayPal Braintree Access Token',
    description: 'Braintree access token (access_token$production$…).',
    category: 'payment',
    risk: 'high',
    regex: /access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}/,
    falsePositives: [],
  },
  {
    name: 'Coinbase Access Token',
    description: 'Coinbase access token (64 alnum near a coinbase keyword).',
    category: 'payment',
    risk: 'medium',
    regex: /(?:coinbase)[\s\S]{0,40}["']?([a-z0-9_-]{64})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Shopify Access Token',
    description: 'Shopify access/secret/app token (shpat_/shpss_/shppa_/shpca_ + 32 hex).',
    category: 'payment',
    risk: 'high',
    regex: /\bshp(?:at|ss|pa|ca)_[a-fA-F0-9]{32}\b/,
    falsePositives: [],
  },

  // ── Cloud / SaaS providers ────────────────────────────────────────────────
  {
    name: 'Twilio API Key',
    description: 'Twilio API key (SK + 32 hex near a twilio keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:twilio)[\s\S]{0,20}?(?:SK[0-9a-f]{32})/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'SendGrid API Key',
    description: 'SendGrid API key (SG. + 22 + 43 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bSG\.[0-9A-Za-z]{22}\.[0-9A-Za-z]{43}\b/,
    falsePositives: [],
  },
  {
    name: 'Mailgun API Key',
    description: 'Mailgun API key (key- + 32 alnum).',
    category: 'cloud',
    risk: 'high',
    regex: /\bkey-[0-9A-Za-z]{32}\b/,
    falsePositives: [],
  },
  {
    name: 'Mailchimp API Key',
    description: 'Mailchimp API key ({32 hex}-us{1-2}).',
    category: 'cloud',
    risk: 'high',
    regex: /\b[0-9a-f]{32}-us[0-9]{1,2}\b/,
    falsePositives: [],
  },
  {
    name: 'Heroku API Key',
    description: 'Heroku API key (UUID near a heroku keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:heroku)[\s\S]{0,20}?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    falsePositives: [],
    builtin: false,
  },
  {
    name: 'Databricks API Token',
    description: 'Databricks API token (dapi + 32 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bdapi[a-h0-9]{32}\b/,
    falsePositives: [],
  },
  {
    name: 'Postman API Key',
    description: 'Postman API key (PMAK- + 24-34 hex).',
    category: 'cloud',
    risk: 'high',
    regex: /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/,
    falsePositives: [],
  },
  {
    name: 'Pulumi Access Token',
    description: 'Pulumi access token (pul- + 40 hex).',
    category: 'cloud',
    risk: 'high',
    regex: /\bpul-[a-f0-9]{40}\b/,
    falsePositives: [],
  },
  {
    name: 'DigitalOcean Access Token',
    description: 'DigitalOcean personal access token (dop_v1_ + 64 hex).',
    category: 'cloud',
    risk: 'high',
    regex: /\bdop_v1_[a-f0-9]{64}\b/,
    falsePositives: [],
  },
  {
    name: 'Dynatrace Token',
    description: 'Dynatrace API token (dt0*.*.*).',
    category: 'cloud',
    risk: 'high',
    regex: /\bdt0[a-zA-Z]{1}[0-9]{2}\.[A-Z0-9]{24}\.[A-Z0-9]{64}\b/,
    falsePositives: [],
  },
  {
    name: 'Cloudinary URL',
    description: 'Cloudinary connection URL (cloudinary://{id}:{key}@{cloud}).',
    category: 'cloud',
    risk: 'high',
    regex: /cloudinary:\/\/[0-9]{15}:[0-9A-Za-z_-]+@[0-9A-Za-z_-]+/,
    falsePositives: [],
  },
  {
    name: 'Algolia Admin Key',
    description: 'Algolia admin key (32 alnum near an algolia keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:algolia)[\s\S]{0,40}["']?([a-z0-9]{32})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Fastly API Key',
    description: 'Fastly API key (32 chars near a fastly keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:fastly)[\s\S]{0,40}["']?([a-z0-9=_\-]{32})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Cloudflare API Token',
    description: 'Cloudflare API token (40 chars near a cloudflare keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:cloudflare|CF_API_TOKEN)[\s\S]{0,40}["']?([a-z0-9_-]{40})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Cloudflare Global API Key',
    description: 'Cloudflare global API key (37 hex near a cloudflare keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:cloudflare|CF_API_KEY)[\s\S]{0,40}["']?([a-f0-9]{37})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Cloudflare Origin CA Key',
    description: 'Cloudflare Origin CA private key (v1.0-{24}-{146}).',
    category: 'cloud',
    risk: 'high',
    regex: /\bv1\.0-[a-f0-9]{24}-[a-f0-9]{146}\b/,
    falsePositives: [],
  },
  {
    name: 'Confluent API Key',
    description: 'Confluent Cloud API key (16 alnum near a confluent keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:confluent)[\s\S]{0,40}["']?([a-z0-9]{16})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Airtable API Key',
    description: 'Airtable personal access token (pat….{64 hex}).',
    category: 'cloud',
    risk: 'high',
    regex: /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}\b/,
    falsePositives: [],
  },
  {
    name: 'Datadog API Key',
    description: 'Datadog API key (40 alnum near a datadog keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:datadog)[\s\S]{0,40}["']?([a-z0-9]{40})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'New Relic API Key',
    description: 'New Relic user key (NRAK- + 27 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bNRAK-[0-9A-Z]{27}\b/,
    falsePositives: [],
  },
  {
    name: 'Dropbox Token',
    description: 'Dropbox long-lived access token (sl. + 15+ chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bsl\.[A-Za-z0-9_-]{15,}\b/,
    falsePositives: [],
  },
  {
    name: 'Bitbucket App Password',
    description: 'Bitbucket app password (32-64 chars near a bitbucket keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:bitbucket)[\s\S]{0,40}["']?([a-zA-Z0-9=_\-]{32,64})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Zendesk Secret Key',
    description: 'Zendesk API token (40 alnum near a zendesk keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:zendesk)[\s\S]{0,40}["']?([a-z0-9]{40})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Alibaba Access Key ID',
    description: 'Alibaba Cloud access key ID (LTAI + 17-21 alnum).',
    category: 'cloud',
    risk: 'high',
    regex: /\bLTAI[a-z0-9]{17,21}\b/i,
    falsePositives: [],
  },
  {
    name: 'Beamer API Token',
    description: 'Beamer API token (b_ + 44 chars).',
    category: 'cloud',
    risk: 'medium',
    regex: /\bb_[a-z0-9=_\-]{44}\b/i,
    falsePositives: [],
  },
  {
    name: 'CircleCI Personal Access Token',
    description: 'CircleCI PAT (CCIPAT_ + 65 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bCCIPAT_[_a-z0-9]{65}\b/,
    falsePositives: [],
  },
  {
    name: 'Codecov Token',
    description:
      'Codecov upload token (32 alnum near a codecov keyword). Excludes action SHA pins (@<40-hex>).',
    category: 'cloud',
    risk: 'medium',
    // Boundary assertions (?<![@\w]) / (?![\w]) prevent matching substrings of
    // GitHub Actions commit-SHA pins like codecov/codecov-action@<40-hex>.
    regex: /(?:codecov)[\s\S]{0,40}["']?(?<![@\w])([a-z0-9]{32})(?![\w])["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Grafana Service Account Token',
    description: 'Grafana service account token (glsa_{32}_{8}).',
    category: 'cloud',
    risk: 'high',
    regex: /\bglsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}\b/,
    falsePositives: [],
  },
  {
    name: 'Kong API Key',
    description: 'Kong Konnect API key (32 chars near a kong keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:kong)[\s\S]{0,40}["']?([a-zA-Z0-9_-]{32})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Intercom Token',
    description: 'Intercom access token (60 chars near an intercom keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:intercom)[\s\S]{0,40}["']?([a-zA-Z0-9_-]{60})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Sumo Logic Access Key',
    description: 'Sumo Logic access key (64 alnum near a sumo logic keyword).',
    category: 'cloud',
    risk: 'high',
    regex: /(?:sumo[ _-]?logic)[\s\S]{0,40}["']?([a-zA-Z0-9]{64})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'AppCenter API Token',
    description: 'Microsoft App Center API token (40 hex near an appcenter keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:appcenter|app center)[\s\S]{0,40}["']?([a-f0-9]{40})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Vercel Token',
    description: 'Vercel access token (24 chars near a vercel keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:vercel)[\s\S]{0,40}["']?([a-zA-Z0-9]{24})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Netlify Token',
    description: 'Netlify access token (40-46 chars near a netlify keyword).',
    category: 'cloud',
    risk: 'medium',
    regex: /(?:netlify)[\s\S]{0,40}["']?([a-zA-Z0-9_-]{40,46})["']?/i,
    falsePositives: [],
    captureGroup: 1,
    builtin: false,
  },
  {
    name: 'Contentful PAT',
    description: 'Contentful personal access token (CFPAT- + 43 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bCFPAT-[A-Za-z0-9_-]{43}\b/,
    falsePositives: [],
  },
  {
    name: 'Linear API Key',
    description: 'Linear API key (lin_api_ + 40 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\blin_api_[a-zA-Z0-9]{40}\b/,
    falsePositives: [],
  },
  {
    name: 'Notion Integration Token',
    description: 'Notion integration token (secret_ + 43 chars).',
    category: 'cloud',
    risk: 'high',
    regex: /\bsecret_[a-zA-Z0-9]{43}\b/,
    falsePositives: [],
  },

  // ── Package registries / generic ──────────────────────────────────────────
  {
    name: 'npm Access Token',
    description: 'npm publish token (npm_ + 36 alnum).',
    category: 'generic',
    risk: 'high',
    regex: /\bnpm_[a-z0-9]{36}\b/,
    falsePositives: [],
  },
  {
    name: 'PyPI Upload Token',
    description: 'PyPI upload token (pypi-AgEIcHlwaS5vcmc + 50+ chars).',
    category: 'generic',
    risk: 'high',
    regex: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,1000}\b/,
    falsePositives: [],
  },
  {
    name: 'Rubygems API Key',
    description: 'Rubygems API key (rubygems_ + 48 hex).',
    category: 'generic',
    risk: 'high',
    regex: /\brubygems_[a-f0-9]{48}\b/,
    falsePositives: [],
  },
  {
    name: 'JWT Bearer Token',
    description: 'JSON Web Token (eyJ… header.payload.signature).',
    category: 'generic',
    risk: 'high',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    falsePositives: [],
  },
  {
    name: 'Basic Auth Header',
    description: 'HTTP Basic authorization header (base64 credentials).',
    category: 'generic',
    risk: 'high',
    regex: /\bbasic [A-Za-z0-9+/]{16,}={0,2}\b/i,
    falsePositives: [],
  },
  {
    name: 'Facebook Access Token',
    description: 'Facebook long-lived access token (EAACEdEose0cBA…).',
    category: 'generic',
    risk: 'high',
    regex: /\bEAACEdEose0cBA[0-9A-Za-z]+\b/,
    falsePositives: [],
  },
  {
    name: 'Facebook Client ID',
    description: 'Facebook app/client ID (13-17 digits near a facebook keyword).',
    category: 'generic',
    risk: 'medium',
    regex: /(?:facebook|fb)[\s\S]{0,20}["']?([0-9]{13,17})["']?/i,
    falsePositives: ['facebook.com', 'facebook.svg'],
    captureGroup: 1,
    builtin: false,
  },

  // ── Private keys ──────────────────────────────────────────────────────────
  {
    name: 'RSA Private Key',
    description: 'RSA private key header (-----BEGIN RSA PRIVATE KEY-----).',
    category: 'private-key',
    risk: 'high',
    regex: /-----BEGIN RSA PRIVATE KEY-----/,
    falsePositives: [],
  },
  {
    name: 'OpenSSH Private Key',
    description: 'OpenSSH private key header (-----BEGIN OPENSSH PRIVATE KEY-----).',
    category: 'private-key',
    risk: 'high',
    regex: /-----BEGIN OPENSSH PRIVATE KEY-----/,
    falsePositives: [],
  },
  {
    name: 'Generic Private Key',
    description: 'PKCS#8 / EC / DSA / PGP private key header.',
    category: 'private-key',
    risk: 'high',
    regex: /-----BEGIN (?:EC |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
    falsePositives: [],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getPatterns(mode: PatternMode = 'all'): SecretPattern[] {
  return mode === 'all' ? PATTERNS : PATTERNS.filter((p) => p.builtin !== false);
}

export function getPatternCount(mode: PatternMode = 'all'): number {
  return getPatterns(mode).length;
}

/** Shannon entropy in bits/char over character frequencies. */
export function shannonEntropy(input: string): number {
  if (input.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of input) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let h = 0;
  for (const count of freq.values()) {
    const p = count / input.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Redact a secret value: first 4 + last 4 chars (full mask when <= 8 chars). */
export function redactSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isFalsePositive(value: string, falsePositives: string[]): boolean {
  if (falsePositives.length === 0) return false;
  const lower = value.toLowerCase();
  return falsePositives.some((fp) => lower.includes(fp.toLowerCase()));
}

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

// ─── Core scanning ────────────────────────────────────────────────────────────

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

interface IgnoreRule {
  base: string;
  re: RegExp;
  negated: boolean;
}

const RE_SPECIALS = new Set(['\\', '^', '$', '|', '+', '(', ')', '{', '}']);

function globToRegex(glob: string, anchored: boolean, dirOnly: boolean): RegExp {
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

function parseGitignore(content: string, base: string): IgnoreRule[] {
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

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function isIgnored(absPath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const rel = toPosix(relative(rule.base, absPath));
    if (rule.re.test(rel)) ignored = !rule.negated;
  }
  return ignored;
}

async function walkDir(
  dir: string,
  rules: IgnoreRule[],
  skipDirs: ReadonlySet<string>,
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
      if (isIgnored(full, localRules)) continue;
      await walkDir(full, localRules, skipDirs, out);
    } else if (entry.isFile()) {
      if (isIgnored(full, localRules)) continue;
      out.push(full);
    }
  }
}

async function expandPaths(paths: string[], skipDirs: ReadonlySet<string>): Promise<string[]> {
  const files: string[] = [];
  for (const path of paths) {
    let st;
    try {
      st = await stat(path);
    } catch {
      continue; // unreadable / missing path is skipped
    }
    if (st.isDirectory()) {
      await walkDir(path, [], skipDirs, files);
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
  const extraSkip = new Set((options.skipDirs ?? []).map((d) => d.toLowerCase()));
  const skipDirs = new Set([...cfg.skipDirs.map((d) => d.toLowerCase()), ...extraSkip]);
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

  const files = await expandPaths(paths, skipDirs);
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

// ─── Report ───────────────────────────────────────────────────────────────────

export interface ReportOptions {
  redact?: boolean;
  riskLevels?: Partial<Record<SecretCategory, RiskLevel>>;
}

export function buildReport(matches: SecretMatch[], options: ReportOptions = {}): SecretReport {
  const cfg = loadConfig();
  const redact = options.redact ?? cfg.redactByDefault;
  const riskLevels = options.riskLevels ?? cfg.riskLevels;

  const byCategory: Record<string, number> = {};
  const byRisk: Record<RiskLevel, number> = { high: 0, medium: 0, low: 0 };

  const normalized: SecretMatch[] = matches.map((m) => {
    const category = m.pattern.category;
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    const risk = riskLevels[category] ?? m.pattern.risk;
    byRisk[risk] = byRisk[risk] + 1;
    return { ...m, pattern: { ...m.pattern, risk } };
  });

  return {
    scannedAt: new Date().toISOString(),
    total: normalized.length,
    byCategory,
    byRisk,
    matches: normalized,
    redacted: redact,
  };
}

// ─── CLI entry guard ──────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Re-exported via secret-scanner-cli.ts; direct execution prints usage.
  console.error('Use: npx tsx src/secret-scanner-cli.ts --scan <file|url> [options]');
  process.exit(2);
}
