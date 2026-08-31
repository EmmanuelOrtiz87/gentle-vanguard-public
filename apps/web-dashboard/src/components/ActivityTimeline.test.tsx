import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityTimeline } from './ActivityTimeline';
import { LocaleContext } from '../hooks/useLocale';
import type { MetricHistory } from '../types/dashboard';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

const history: MetricHistory[] = [
  { timestamp: '2026-08-31T10:00:00Z', tokens: 1000, sessions: 2, mcpSkills: 1, commits: 1 },
  { timestamp: '2026-08-31T10:30:00Z', tokens: 500, sessions: 1, mcpSkills: 0, commits: 0 },
];

describe('ActivityTimeline', () => {
  it('renders the empty state when history is empty', () => {
    renderWithLocale(<ActivityTimeline history={[]} />);
    expect(screen.getByText(/no temporal data/i)).toBeInTheDocument();
  });

  it('renders the chart header and data-point footer with data', () => {
    renderWithLocale(<ActivityTimeline history={history} />);
    expect(screen.getByText('24h Activity Timeline')).toBeInTheDocument();
    expect(screen.getByText(/2 data points\)/)).toBeInTheDocument(); // history.length in footer
  });

  it('renders the recharts bar chart when data exists', () => {
    const { container } = renderWithLocale(<ActivityTimeline history={history} />);
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });
});
