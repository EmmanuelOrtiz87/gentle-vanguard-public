import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenUsagePanel } from './TokenUsagePanel';
import { LocaleContext } from '../hooks/useLocale';
import type { TokenUsageRow } from '../types/dashboard';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

const usage: TokenUsageRow[] = [
  { session_id: 'sess-abc', prompt: 999, completion: 400, cost: 0.0123, last_used: '2026-08-30T10:00:00Z' },
  { session_id: 'sess-def', prompt: 200, completion: 50, cost: 0.004, last_used: '2026-08-29T09:00:00Z' },
];

describe('TokenUsagePanel', () => {
  it('renders the empty state when total is 0', () => {
    renderWithLocale(<TokenUsagePanel usage={[]} total={0} />);
    expect(screen.getByText(/no token usage data yet/i)).toBeInTheDocument();
  });

  it('renders rows with session id, token counts and cost', () => {
    renderWithLocale(<TokenUsagePanel usage={usage} total={2} />);
    expect(screen.getByText('sess-abc')).toBeInTheDocument();
    expect(screen.getByText('sess-def')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('$0.0123')).toBeInTheDocument();
    expect(screen.getByText('$0.0040')).toBeInTheDocument();
    expect(screen.getByText(/2 sessions/i)).toBeInTheDocument();
  });

  it('renders fallbacks for missing values', () => {
    const partial = [{ session_id: 'sess-x' } as TokenUsageRow];
    renderWithLocale(<TokenUsagePanel usage={partial} total={1} />);
    expect(screen.getByText('sess-x')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(2); // prompt + completion fallbacks
    expect(screen.getByText('$0.0000')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument(); // no last_used
  });
});
