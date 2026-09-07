/**
 * CSRF-aware API client for dashboard mutations.
 *
 * The login flow issues a `gv_dashboard_csrf` cookie (readable by JS by
 * design). Mutating requests must echo it in the `X-GV-CSRF` header so the
 * server can verify the double-submit pair against its stored hash.
 */
export const CSRF_COOKIE = 'gv_dashboard_csrf';

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  for (const part of document.cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === CSRF_COOKIE) return value.join('=') || '';
  }
  return '';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!SAFE_METHODS.has(method)) {
    const token = getCsrfToken();
    if (token) headers.set('X-GV-CSRF', token);
  }
  return fetch(input, { ...init, headers });
}
