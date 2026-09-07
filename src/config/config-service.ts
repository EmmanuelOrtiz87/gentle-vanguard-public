/**
 * ConfigService — typed, zod-validated access to environment configuration.
 * (STACK-EVOLUTION-PLAN F2.6, phase 1)
 *
 * Scope: ONLY the ~25 vars that matter for startup (paths, ports, identity,
 * model selection, quiet flags). The other ~220 `process.env` usages in src/
 * remain as-is; they migrate in later batches.
 *
 * Local-first (ADR-0017): nothing is hard-required for local operation.
 * Cloud vars (webhooks, API keys) are optional and only enforced when the
 * caller opts into strict mode (`validate({ mode: 'strict' })`), reserved for
 * external promotion — never the local startup path.
 */
import { z } from 'zod';

// ─── Schema helpers ────────────────────────────────────────────────────────

/** Treat empty/whitespace-only strings as "unset" (common in .env files). */
const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((raw) => {
    if (typeof raw === 'string' && raw.trim() === '') return undefined;
    return raw;
  }, schema);

const str = (fallback?: string) =>
  fallback === undefined
    ? emptyAsUndefined(z.string().optional())
    : emptyAsUndefined(z.string().default(fallback));

const num = (fallback: number) =>
  emptyAsUndefined(z.coerce.number().int().min(1).max(65535).default(fallback));

const bool = (fallback: boolean) =>
  emptyAsUndefined(
    z
      .enum(['true', 'false', '1', '0', 'yes', 'no'])
      .default(fallback ? 'true' : 'false')
      .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  );

const temperature = emptyAsUndefined(z.coerce.number().min(0).max(2).default(0.7));

// ─── The startup-critical env vars (phase 1) ───────────────────────────────

export const configEnvSchema = z.object({
  // Paths / base dirs
  GENTLE_VANGUARD_BASE_DIR: str(),
  GV_BASE_DIR: str(),
  GENTLE_VANGUARD_HOME: str(),
  GENTLE_VANGUARD_REPO_PATH: str(),
  GENTLE_VANGUARD_PUBLIC_ROOT: str(),

  // Session identity (set by session-autostart; optional before it runs)
  SESSION_ID: str(),
  GENTLE_VANGUARD_SESSION_ID: str(),

  // Tenant (multi-tenant lanes — optional locally)
  GENTLE_TENANT_ID: str(),
  GENTLE_VANGUARD_TENANT_ID: str(),
  GENTLE_TENANT_EVAL_DIR: str(),
  GENTLE_TENANT_AUDIT_DIR: str(),

  // Model selection
  AGENT_MODEL: str(),
  GENTLE_VANGUARD_ACTIVE_MODEL: str(),
  ORCHESTRATOR_MODEL: str(),
  FORCE_MODEL: str(),
  SESSION_MODEL: str(),
  AI_MODEL: str(),
  AGENT_TEMPERATURE: temperature,

  // Ports
  PORT: num(3000),
  WS_PORT: str(), // dynamic by design (Get-FreePort); never a static default
  MCP_PORT: str(),
  VITE_DEV_PORT: str(),

  // Runtime flags
  NODE_ENV: emptyAsUndefined(z.enum(['development', 'test', 'production']).default('development')),
  GV_QUIET: bool(false),
  LITELLM_DROP_PARAMS: bool(false),
  LITELLM_CONFIG_PATH: str(),
  AUTOSTART_LOG_FILE: str(),

  // Cloud / outbound integrations — OPTIONAL (ADR-0017), enforced only in strict mode
  SLACK_WEBHOOK_URL: str(),
  DISCORD_WEBHOOK_URL: str(),
  ALERT_WEBHOOK_URL: str(),
  FIRECRAWL_API_KEY: str(),
  OPENAI_API_KEY: str(),
});

export type ConfigEnv = z.infer<typeof configEnvSchema>;
export type ConfigKey = keyof ConfigEnv;

/** Vars that MUST be present when promoting to a cloud/strict deployment. */
export const STRICT_REQUIRED: readonly ConfigKey[] = [
  'SLACK_WEBHOOK_URL',
  'ALERT_WEBHOOK_URL',
] as const;

export interface ConfigIssue {
  key: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ConfigIssue[];
  /** Human-readable one-line summary for WARN logs. */
  summary: string;
}

// ─── ConfigService ─────────────────────────────────────────────────────────

export class ConfigService {
  private readonly env: NodeJS.ProcessEnv;
  private parsed: ConfigEnv | null = null;
  private lastValidation: ValidationResult | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  /**
   * Validate the environment. `mode: 'local'` (default) never fails on missing
   * optional vars — it only reports type/format errors. `mode: 'strict'`
   * additionally enforces STRICT_REQUIRED (cloud promotion path).
   */
  validate(opts: { mode?: 'local' | 'strict' } = {}): ValidationResult {
    const mode = opts.mode ?? 'local';
    const result = configEnvSchema.safeParse(this.env);

    const issues: ConfigIssue[] = [];
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({ key: issue.path.join('.') || '(root)', message: issue.message });
      }
    }
    if (mode === 'strict') {
      for (const key of STRICT_REQUIRED) {
        const raw = this.env[key];
        if (raw === undefined || raw.trim() === '') {
          issues.push({ key, message: 'required in strict mode (cloud promotion)' });
        }
      }
    }

    if (result.success) this.parsed = result.data;
    this.lastValidation = {
      ok: issues.length === 0,
      issues,
      summary:
        issues.length === 0
          ? `config OK (${mode} mode)`
          : `config issues (${mode} mode): ${issues.map((i) => `${i.key}: ${i.message}`).join('; ')}`,
    };
    return this.lastValidation;
  }

  /**
   * Typed accessor. Returns the schema default when the var is unset.
   * Throws if `validate()` has not been called (or failed on this key's type).
   */
  get<K extends ConfigKey>(key: K): ConfigEnv[K] {
    if (!this.parsed) {
      const v = this.validate();
      if (!v.ok && v.issues.some((i) => i.key === key)) {
        throw new Error(`ConfigService: invalid value for ${key} — ${v.summary}`);
      }
    }
    const value = (this.parsed as ConfigEnv | null)?.[key];
    if (value !== undefined) return value;
    // Key failed type validation in strict parse but is tolerable: fall back to raw.
    const raw = this.env[key];
    return raw as ConfigEnv[K];
  }

  /** True when the var is set to a non-empty value (no default applied). */
  isSet(key: ConfigKey): boolean {
    const raw = this.env[key];
    return raw !== undefined && raw.trim() !== '';
  }

  /** Last validate() result, or null if never validated. */
  get validation(): ValidationResult | null {
    return this.lastValidation;
  }
}

// ─── Singleton + test support ──────────────────────────────────────────────

let instance: ConfigService | null = null;

/** Process-wide ConfigService (lazily created, cached). */
export function getConfigService(): ConfigService {
  if (!instance) instance = new ConfigService();
  return instance;
}

/** Reset the singleton — call in test teardown / between app boots. */
export function resetConfigService(): void {
  instance = null;
}

/**
 * Build an isolated ConfigService for tests: starts from a deterministic base
 * env (plus real HOME/USERPROFILE so path-derived defaults stay sane) and
 * applies overrides. Never touches the singleton or process.env.
 */
export function createTestConfig(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const base: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    GV_QUIET: 'true',
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.USERPROFILE ? { USERPROFILE: process.env.USERPROFILE } : {}),
    ...overrides,
  };
  return new ConfigService(base as NodeJS.ProcessEnv);
}
