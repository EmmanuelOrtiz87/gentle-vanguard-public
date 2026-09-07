import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionTable } from './SessionTable';
import { LocaleContext } from '../hooks/useLocale';
import type { Session } from '../types/dashboard';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

const sessions: Session[] = [
  {
    id: 'sess-1',
    agent: 'architect',
    status: 'active',
    startTime: '2026-08-31T10:00:00Z',
    tokensUsed: 999,
    model: 'gpt-test',
    cost: 0.5,
  },
  {
    id: 'sess-2',
    agent: 'reviewer',
    status: 'completed',
    startTime: '2026-08-31T11:00:00Z',
    tokensUsed: 100,
  },
];

describe('SessionTable', () => {
  it('renders the empty state when there are no sessions', () => {
    renderWithLocale(<SessionTable sessions={[]} />);
    expect(screen.getByText(/no sessions found/i)).toBeInTheDocument();
  });

  it('renders session rows with id, agent, model and totals', () => {
    renderWithLocale(<SessionTable sessions={sessions} />);
    expect(screen.getByRole('heading', { name: /Sessions \(2\)/ })).toBeInTheDocument();
    expect(screen.getByText('sess-1')).toBeInTheDocument();
    expect(screen.getByText('sess-2')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('gpt-test')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('$0.5000')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument(); // no model on sess-2
  });

  it('sorts active sessions first', () => {
    renderWithLocale(<SessionTable sessions={sessions} />);
    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1]; // rows[0] is the header
    expect(firstDataRow.textContent).toContain('sess-1');
  });

  it('paginates when more than PAGE_SIZE sessions and navigates pages', () => {
    const many: Session[] = Array.from({ length: 20 }, (_, i) => ({
      id: `sess-${i}`,
      agent: 'a',
      status: 'completed' as const,
      startTime: `2026-08-31T0${i % 10}:00:00Z`,
      tokensUsed: 1,
    }));
    renderWithLocale(<SessionTable sessions={many} />);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('1–15', { exact: false }).textContent).toContain('20');
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    // sorted by startTime desc: hour(i%10) — page 2 holds sess-12/1/11/0/10
    expect(screen.getByText('sess-12')).toBeInTheDocument();
    expect(screen.queryByText('sess-9')).not.toBeInTheDocument();
  });
});
