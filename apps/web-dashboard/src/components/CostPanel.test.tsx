import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostPanel } from './CostPanel';
import { LocaleContext } from '../hooks/useLocale';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

const report = {
  generatedAt: '2026-08-31T10:00:00Z',
  currency: 'USD',
  totals: {
    costUsd: 12.5,
    inputTokens: 90_000_000,
    outputTokens: 10_000_000,
    totalTokens: 100_000_000,
    monthToDateCostUsd: 34.56,
  },
  perDay: [
    { date: '2026-08-30', costUsd: 5.25, totalTokens: 40_000_000 },
    { date: '2026-08-31', costUsd: 7.25, totalTokens: 60_000_000 },
  ],
  perAgent: [
    { key: 'orchestrator', costUsd: 10.0, inputTokens: 80, outputTokens: 20, totalTokens: 100, sharePct: 80 },
    { key: 'subagent', costUsd: 2.5, inputTokens: 10, outputTokens: 5, totalTokens: 15, sharePct: 20 },
  ],
  perModel: [
    { key: 'kimi-2-5', costUsd: 9.0, inputTokens: 70, outputTokens: 15, totalTokens: 85, sharePct: 72 },
    { key: 'glm-5.3', costUsd: 3.5, inputTokens: 20, outputTokens: 10, totalTokens: 30, sharePct: 28 },
  ],
  topSessions: [
    {
      sessionId: 'ses_alpha_0000000000000000000001',
      costUsd: 8.4,
      totalTokens: 50_000_000,
      transactions: 120,
      lastActivity: '2026-08-31 09:41:03',
    },
  ],
  monthlyProjection: { from7d: 320.1, from30d: 375.0 },
  budget: {
    dailyTokens: 5_000_000,
    perSessionTokens: 3_000_000,
    usedTodayTokens: 6_000_000,
    usedTodayPct: 120,
    softThresholdPct: 70,
    hardThresholdPct: 90,
    status: 'hard' as const,
  },
  insight: 'Routing all billable volume through the cheapest priced model (glm-5.3) would cut spend ~60%.',
  unpricedModels: ['big-pickle'],
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('CostPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing before data loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = renderWithLocale(<CostPanel />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('fetches /api/costs and renders summary cards, breakdowns and top sessions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ type: 'costs', cached: false, data: report }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLocale(<CostPanel />);

    // Summary cards
    expect(await screen.findByTestId('cost-card-month')).toHaveTextContent('$34.56');
    expect(screen.getByTestId('cost-card-projection')).toHaveTextContent('$375.00');
    expect(screen.getByTestId('cost-card-budget')).toHaveTextContent('120.0%');

    // Insight line + unpriced flag
    expect(screen.getByTestId('cost-insight')).toHaveTextContent(/cheapest priced model/);
    expect(screen.getByTestId('cost-unpriced')).toHaveTextContent('big-pickle');

    // Breakdowns
    expect(screen.getByText('kimi-2-5')).toBeInTheDocument();
    expect(screen.getByText('orchestrator')).toBeInTheDocument();

    // Top sessions
    expect(screen.getByText('ses_alpha_0000000000000000000001')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/costs',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('shows an error message when the API is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response),
    );
    renderWithLocale(<CostPanel />);
    expect(await screen.findByText(/Cost data unavailable/)).toBeInTheDocument();
  });

  it('hides the unpriced note when all models are priced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ type: 'costs', cached: true, data: { ...report, unpricedModels: [] } }),
      ),
    );
    renderWithLocale(<CostPanel />);
    await screen.findByTestId('cost-card-month');
    expect(screen.queryByTestId('cost-unpriced')).not.toBeInTheDocument();
  });
});
