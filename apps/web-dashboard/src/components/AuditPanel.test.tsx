import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditPanel from './AuditPanel';
import { LocaleContext } from '../hooks/useLocale';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

const payload = {
  success: true,
  data: {
    entries: [
      {
        timestamp: '2026-08-31T10:00:00Z',
        event: 'session.start',
        actor: 'orchestrator',
        status: 'recorded',
        resource: 'session-1',
      },
      {
        timestamp: '2026-08-31T11:00:00Z',
        action: 'tool.invoke',
        actor: 'agent-7',
      },
    ],
    query: '',
    limit: 200,
  },
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('AuditPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches /api/audit and renders entries in the table', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLocale(<AuditPanel />);
    expect(await screen.findByText('session.start')).toBeInTheDocument();
    expect(screen.getByText('tool.invoke')).toBeInTheDocument(); // falls back to action
    expect(screen.getByText('orchestrator')).toBeInTheDocument();
    expect(screen.getByText('agent-7')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/audit?limit=200&q=');
  });

  it('shows the empty state when no entries match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ success: true, data: { entries: [], query: '', limit: 200 } })),
    );
    renderWithLocale(<AuditPanel />);
    expect(await screen.findByText(/no audit entries match/i)).toBeInTheDocument();
  });

  it('shows an error when the API reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ success: false, error: 'audit offline' })),
    );
    renderWithLocale(<AuditPanel />);
    expect(await screen.findByText('audit offline')).toBeInTheDocument();
  });

  it('re-queries with the search term when searching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLocale(<AuditPanel />);
    await screen.findByText('session.start');
    fireEvent.change(screen.getByLabelText(/search evidence/i), { target: { value: 'agent-7' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/audit?limit=200&q=agent-7');
  });
});
