import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface DashboardAuthSessionStore {
  create(sessionId: string, expiresAt: number): void;
  hasValid(sessionId: string, now: number): boolean;
  revoke(sessionId: string): void;
  removeExpired(now: number): void;
}

export const SESSION_COOKIE = 'gv_dashboard_session';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

interface Session {
  expiresAt: number;
}

export interface DashboardAuthOptions {
  token?: string;
  devAuth?: string;
  production?: string;
  ttlMs?: number;
  now?: () => number;
  sessionStore?: DashboardAuthSessionStore;
}

export class DashboardAuth {
  private readonly token: string;
  private readonly devAuth: boolean;
  private readonly production: boolean;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionStore?: DashboardAuthSessionStore;

  constructor(options: DashboardAuthOptions = {}) {
    this.token = options.token?.trim() || '';
    this.devAuth = options.devAuth === '1';
    this.production = options.production === 'production';
    this.ttlMs = options.ttlMs && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
    this.now = options.now || Date.now;
    this.sessionStore = options.sessionStore;
  }

  get enabled(): boolean {
    return Boolean(this.token);
  }

  /** True when running with NODE_ENV=production (adds Secure cookie flags). */
  get productionMode(): boolean {
    return this.production;
  }

  get devMode(): boolean {
    return this.devAuth && !this.production;
  }

  get warning(): string | undefined {
    return this.devMode
      ? 'Dashboard authentication bypass is enabled for localhost only'
      : undefined;
  }

  isLocalhost(req: IncomingMessage): boolean {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    const remote = req.socket.remoteAddress || '';
    return (
      ['localhost', '127.0.0.1', '::1'].includes(host) &&
      (remote === '' || remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1')
    );
  }

  isProtectedRequest(req: IncomingMessage): boolean {
    if (this.devMode && this.isLocalhost(req)) return false;
    return true;
  }

  private cleanup(): void {
    const now = this.now();
    if (this.sessionStore) {
      this.sessionStore.removeExpired(now);
      return;
    }
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  private compareToken(supplied: string): boolean {
    if (!this.token || !supplied) return false;
    const expectedHash = createHash('sha256').update(this.token).digest();
    const suppliedHash = createHash('sha256').update(supplied).digest();
    return timingSafeEqual(expectedHash, suppliedHash);
  }

  login(supplied: string): string | undefined {
    if (!this.compareToken(supplied)) return undefined;
    const id = randomBytes(32).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    try {
      if (this.sessionStore) this.sessionStore.create(id, expiresAt);
      else this.sessions.set(id, { expiresAt });
    } catch {
      return undefined;
    }
    return id;
  }

  authenticate(req: IncomingMessage): boolean {
    if (this.devMode && this.isLocalhost(req)) return true;
    if (!this.token) return false;
    try {
      this.cleanup();
    } catch {
      return false;
    }
    const sessionId = this.cookie(req);
    if (!sessionId) return false;
    try {
      return this.sessionStore
        ? this.sessionStore.hasValid(sessionId, this.now())
        : this.sessions.has(sessionId);
    } catch {
      return false;
    }
  }

  logout(req: IncomingMessage): void {
    const sessionId = this.cookie(req);
    if (!sessionId) return;
    try {
      if (this.sessionStore) this.sessionStore.revoke(sessionId);
      else this.sessions.delete(sessionId);
    } catch {
      return;
    }
  }

  cookie(req: IncomingMessage): string | undefined {
    const cookieHeader = req.headers.cookie || '';
    for (const part of cookieHeader.split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === SESSION_COOKIE) return value.join('=') || undefined;
    }
    return undefined;
  }

  cookieHeader(sessionId: string): string {
    return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Path=/; SameSite=Strict${this.production ? '; Secure' : ''}; Max-Age=${Math.floor(this.ttlMs / 1000)}`;
  }

  clearCookieHeader(): string {
    return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict${this.production ? '; Secure' : ''}; Max-Age=0`;
  }
}

export function createDashboardAuth(
  env: NodeJS.ProcessEnv = process.env,
  sessionStore?: DashboardAuthSessionStore,
): DashboardAuth {
  return new DashboardAuth({
    token: env.GV_DASHBOARD_TOKEN,
    devAuth: env.GV_DASHBOARD_DEV_AUTH,
    production: env.NODE_ENV,
    ttlMs: Number(env.GV_DASHBOARD_SESSION_TTL_MS) || undefined,
    sessionStore,
  });
}
