import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { MetricsCard } from './MetricsCard';
import { LocaleContext } from '../hooks/useLocale';

function renderWithLocale(ui: React.ReactElement) {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      {ui}
    </LocaleContext.Provider>,
  );
}

describe('MetricsCard', () => {
  const baseProps = {
    title: 'Active Sessions',
    value: 42,
    icon: Activity,
  };

  it('renders title and value', () => {
    renderWithLocale(<MetricsCard {...baseProps} />);
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    renderWithLocale(<MetricsCard {...baseProps} subtitle="3 active now" />);
    expect(screen.getByText('3 active now')).toBeInTheDocument();
  });

  it('does not render subtitle when omitted', () => {
    renderWithLocale(<MetricsCard {...baseProps} />);
    expect(screen.queryByText('3 active now')).not.toBeInTheDocument();
  });

  it('does not render info button when infoKey is omitted', () => {
    renderWithLocale(<MetricsCard {...baseProps} />);
    expect(screen.queryByTitle('More info')).not.toBeInTheDocument();
  });

  it('renders info button when infoKey is provided', () => {
    renderWithLocale(<MetricsCard {...baseProps} infoKey="tokens_used" />);
    expect(screen.getByTitle('More info')).toBeInTheDocument();
  });

  it('renders the icon with correct color class', () => {
    const { container } = renderWithLocale(<MetricsCard {...baseProps} color="green" />);
    const iconContainer = container.querySelector('.bg-green-50');
    expect(iconContainer).toBeTruthy();
  });

  it('uses default blue color when not specified', () => {
    const { container } = renderWithLocale(<MetricsCard {...baseProps} />);
    const iconContainer = container.querySelector('.bg-blue-50');
    expect(iconContainer).toBeTruthy();
  });

  it('renders string values', () => {
    renderWithLocale(<MetricsCard {...baseProps} value="99.9%" />);
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });
});
