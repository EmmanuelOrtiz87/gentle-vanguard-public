import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoopGuardPanel } from './LoopGuardPanel';
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
  guardModule: true,
  guardTests: true,
  liveMetrics: true,
  selfTest: true,
  selfTestDetail: 'ok (5 checks)',
  resumeLog: [
    { taskId: 'task-alpha-0000000000000000000000000001', count: 3, isLoop: false },
    { taskId: 'task-beta-00000000000000000000000000002', count: 9, isLoop: true },
  ],
  watchtowerStatus: 'PASS',
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('LoopGuardPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing before data loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = renderWithLocale(<LoopGuardPanel />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('fetches /api/loop-guard and renders health chips and resume log table', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: okStatus }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLocale(<LoopGuardPanel />);
    expect(await screen.findByText('guard module')).toBeInTheDocument();
    expect(screen.getByText('guard tests (5/5)')).toBeInTheDocument();
    expect(screen.getByText('live metrics')).toBeInTheDocument();
    expect(screen.getByText('self-test: ok (5 checks)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/loop-guard',
      expect.objectContaining({ signal: expect.anything() }),
    );
    // resume log table
    expect(screen.getByText('task_id')).toBeInTheDocument();
    expect(screen.getByText('task-alpha-0000000000000000000000000001')).toBeInTheDocument();
    expect(screen.getByText('LOOP')).toBeInTheDocument();
    expect(screen.getByText('ok', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('loop detected')).toBeInTheDocument();
  });

  it('hides the resume table when the log is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ data: { ...okStatus, resumeLog: [] } })),
    );
    renderWithLocale(<LoopGuardPanel />);
    await screen.findByText('guard module');
    expect(screen.queryByText('task_id')).not.toBeInTheDocument();
    expect(screen.queryByText('loop detected')).not.toBeInTheDocument();
  });
});
