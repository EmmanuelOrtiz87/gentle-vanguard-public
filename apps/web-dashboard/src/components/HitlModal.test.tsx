import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HitlModal from './HitlModal';
import type { HitlRequest } from '../types/agent';

function makeRequest(overrides: Partial<HitlRequest> = {}): HitlRequest {
  return {
    id: 'hitl-test',
    kind: 'confirmation',
    title: 'Test Request',
    ...overrides,
  };
}

describe('HitlModal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when request is null', () => {
    const { container } = render(
      <HitlModal request={null} onResolve={() => {}} onDismiss={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders confirmation with message and Approve/Reject', () => {
    render(
      <HitlModal
        request={makeRequest({ message: 'Approve this?' })}
        onResolve={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Approve this?')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('emits approved response on Approve click', () => {
    const onResolve = vi.fn();
    render(<HitlModal request={makeRequest()} onResolve={onResolve} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Approve'));
    expect(onResolve).toHaveBeenCalledWith({
      requestId: 'hitl-test',
      kind: 'confirmation',
      approved: true,
    });
  });

  it('emits rejected response on Reject click', () => {
    const onResolve = vi.fn();
    render(<HitlModal request={makeRequest()} onResolve={onResolve} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Reject'));
    expect(onResolve).toHaveBeenCalledWith({
      requestId: 'hitl-test',
      kind: 'confirmation',
      approved: false,
    });
  });

  it('renders selection options and emits selection', () => {
    const onResolve = vi.fn();
    render(
      <HitlModal
        request={makeRequest({ kind: 'selection', options: ['A', 'B'] })}
        onResolve={onResolve}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(onResolve).toHaveBeenCalledWith({
      requestId: 'hitl-test',
      kind: 'selection',
      selection: 'A',
    });
  });

  it('renders form fields and emits values', () => {
    const onResolve = vi.fn();
    render(
      <HitlModal
        request={makeRequest({
          kind: 'form',
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'dryRun', label: 'Dry run', type: 'boolean' },
          ],
        })}
        onResolve={onResolve}
        onDismiss={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalledWith({
      requestId: 'hitl-test',
      kind: 'form',
      values: { name: 'Alice', dryRun: false },
    });
  });

  it('blocks submit when required field is empty', () => {
    const onResolve = vi.fn();
    render(
      <HitlModal
        request={makeRequest({
          kind: 'form',
          fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
        })}
        onResolve={onResolve}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText(/Required fields missing/)).toBeInTheDocument();
  });

  it('renders review items with severity and emits reviewed response', () => {
    const onResolve = vi.fn();
    render(
      <HitlModal
        request={makeRequest({
          kind: 'review',
          review: [
            { label: 'File', value: 'src/a.ts', severity: 'info' },
            { label: 'Security', value: 'High', severity: 'error' },
          ],
        })}
        onResolve={onResolve}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve'));
    expect(onResolve).toHaveBeenCalledWith({
      requestId: 'hitl-test',
      kind: 'review',
      approved: true,
      reviewed: true,
    });
  });

  it('auto-resolves with timedOut when timeout expires', () => {
    vi.useFakeTimers();
    const onResolve = vi.fn();
    render(
      <HitlModal
        request={makeRequest({ timeoutMs: 1000 })}
        onResolve={onResolve}
        onDismiss={() => {}}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onResolve).toHaveBeenCalledWith({
      requestId: 'hitl-test',
      kind: 'confirmation',
      approved: false,
      reviewed: false,
      timedOut: true,
    });
  });
});
