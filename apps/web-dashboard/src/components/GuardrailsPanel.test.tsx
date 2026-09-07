import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuardrailsPanel } from './GuardrailsPanel';
import { LocaleContext } from '../hooks/useLocale';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

const okStatus = {
  timestamp: '2026-08-31T10:00:00Z',
  inputModeration: true,
  outputModeration: true,
  config: true,
  adr: true,
  selfTest: true,
  selfTestDetail: '5/5 passed',
  watchtowerStatus: 'PASS',
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('GuardrailsPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing before data loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = renderWithLocale(<GuardrailsPanel />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('fetches /api/guardrails and renders status chips', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: okStatus }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLocale(<GuardrailsPanel />);
    expect(await screen.findByText('input moderation')).toBeInTheDocument();
    expect(screen.getByText('output moderation')).toBeInTheDocument();
    expect(screen.getByText('config')).toBeInTheDocument();
    expect(screen.getByText('ADR-0023')).toBeInTheDocument();
    expect(screen.getByText('self-test: 5/5 passed')).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/guardrails',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('renders degraded chips when flags are false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ data: { ...okStatus, inputModeration: false, selfTest: false } }),
      ),
    );
    renderWithLocale(<GuardrailsPanel />);
    const bad = await screen.findByText('input moderation');
    expect(bad.className).toContain('text-red-');
    const warn = screen.getByText(/self-test/);
    expect(warn.className).toContain('text-amber-');
  });

  it('renders nothing when the API responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const { container } = renderWithLocale(<GuardrailsPanel />);
    // give microtasks a chance to settle
    await Promise.resolve();
    expect(container.querySelector('section')).toBeNull();
  });
});
