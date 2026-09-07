import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationToast } from './NotificationToast';
import type { Notification } from '../hooks/useMetrics';

const notifications: Notification[] = [
  { type: 'budget', message: 'Token budget at 90%', severity: 'warning', timestamp: '2026-08-31T10:00:00Z' },
  { type: 'error', message: 'Agent failed', severity: 'error', timestamp: '2026-08-31T10:01:00Z' },
];

describe('NotificationToast', () => {
  it('renders nothing when there are no notifications', () => {
    const { container } = render(
      <NotificationToast notifications={[]} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one toast per notification with the message', () => {
    render(<NotificationToast notifications={notifications} onClose={() => {}} />);
    expect(screen.getByText('Token budget at 90%')).toBeInTheDocument();
    expect(screen.getByText('Agent failed')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('calls onClose with the index when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<NotificationToast notifications={notifications} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(onClose).toHaveBeenCalledWith(1);
  });

  it('falls back to the info icon for unknown severity', () => {
    render(
      <NotificationToast
        notifications={[{ type: 'x', message: 'mystery', severity: 'weird', timestamp: 't' }]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });
});
