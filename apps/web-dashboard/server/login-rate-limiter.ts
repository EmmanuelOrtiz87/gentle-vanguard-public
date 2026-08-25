/**
 * In-memory sliding-window rate limiter for dashboard login attempts.
 * Tracks failures per client address; once the failure budget is exhausted
 * within the window, logins from that address are rejected with 429 until
 * the window slides past the oldest failures.
 *
 * Knobs (env):
 * - GV_DASHBOARD_LOGIN_MAX_FAILURES (default 5)
 * - GV_DASHBOARD_LOGIN_WINDOW_MS    (default 60000)
 */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitDecision {
    const now = this.now();
    this.prune(key, now);
    const attempts = this.failures.get(key);
    if (!attempts || attempts.length < this.maxFailures) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const oldest = attempts[0];
    const retryAfterMs = oldest + this.windowMs - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  recordFailure(key: string): void {
    const now = this.now();
    this.prune(key, now);
    const attempts = this.failures.get(key) ?? [];
    attempts.push(now);
    this.failures.set(key, attempts);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private prune(key: string, now: number): void {
    const attempts = this.failures.get(key);
    if (!attempts) return;
    const cutoff = now - this.windowMs;
    const fresh = attempts.filter((t) => t > cutoff);
    if (fresh.length === 0) this.failures.delete(key);
    else this.failures.set(key, fresh);
  }
}

export function createLoginRateLimiter(env: NodeJS.ProcessEnv = process.env): LoginRateLimiter {
  const maxFailures = Number(env.GV_DASHBOARD_LOGIN_MAX_FAILURES) || 5;
  const windowMs = Number(env.GV_DASHBOARD_LOGIN_WINDOW_MS) || 60_000;
  return new LoginRateLimiter(maxFailures, Math.max(1000, windowMs));
}
