import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminPanel from './AdminPanel';
import { getCsrfToken } from '../lib/api';

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'gv_dashboard_csrf=; path=/; max-age=0';
});

describe('getCsrfToken', () => {
  it('reads the CSRF cookie value', () => {
    setCookie('gv_dashboard_csrf', 'token-123');
    expect(getCsrfToken()).toBe('token-123');
  });

  it('returns empty string when the cookie is absent', () => {
    document.cookie = 'gv_dashboard_csrf=; path=/; max-age=0';
    expect(getCsrfToken()).toBe('');
  });
});

describe('AdminPanel', () => {
  it('shows an admin-required message on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Admin role required' }), { status: 403 })),
    );
    render(<AdminPanel />);
    await waitFor(() =>
      expect(screen.getByText(/Admin role required/)).toBeInTheDocument(),
    );
  });

  it('renders principals with memberships and roles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            principals: [
              {
                id: 'p1',
                subject: 'dashboard-operator',
                displayName: 'Dashboard Operator',
                createdAt: '2026-08-25T00:00:00Z',
                memberships: [
                  { tenantId: 'gentle-vanguard', principalId: 'p1', role: 'admin', createdAt: '2026-08-25T00:00:00Z' },
                ],
              },
              {
                id: 'p2',
                subject: 'viewer-user',
                createdAt: '2026-08-25T00:00:00Z',
                memberships: [
                  { tenantId: 'gentle-vanguard', principalId: 'p2', role: 'viewer', createdAt: '2026-08-25T00:00:00Z' },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<AdminPanel />);
    await waitFor(() => expect(screen.getByText('dashboard-operator')).toBeInTheDocument());
    expect(screen.getByText('viewer-user')).toBeInTheDocument();
    expect(screen.getAllByText('gentle-vanguard').length).toBe(2);
  });

  it('shows an empty state when no principals exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ principals: [] }), { status: 200 })),
    );
    render(<AdminPanel />);
    await waitFor(() => expect(screen.getByText('No principals found.')).toBeInTheDocument());
  });
});
