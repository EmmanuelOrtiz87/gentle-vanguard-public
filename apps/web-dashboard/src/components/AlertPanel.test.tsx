import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertPanel } from './AlertPanel';

describe('AlertPanel', () => {
  const errorAlert = {
    name: 'high-latency',
    rule: 'Latency exceeds 5000ms',
    actual: 6200,
    threshold: 5000,
    severity: 'error',
    triggered: true,
    unit: 'ms',
  };

  const warningAlert = {
    name: 'high-tokens',
    rule: 'Token usage exceeds 8000',
    actual: 9200,
    threshold: 8000,
    severity: 'warning',
    triggered: true,
    unit: '',
  };

  const infoAlert = {
    name: 'new-skill',
    rule: 'New skill registered',
    actual: 1,
    threshold: 0,
    severity: 'info',
    triggered: true,
    unit: '',
  };

  const inactiveAlert = {
    name: 'inactive',
    rule: 'Inactive alert',
    actual: 0,
    threshold: 1,
    severity: 'warning',
    triggered: false,
    unit: '',
  };

  it('returns null when no alerts are triggered', () => {
    const { container } = render(<AlertPanel alerts={[inactiveAlert]} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when alerts array is empty', () => {
    const { container } = render(<AlertPanel alerts={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders active alerts count', () => {
    render(<AlertPanel alerts={[errorAlert]} />);
    expect(screen.getByText('Active Alerts (1)')).toBeInTheDocument();
  });

  it('renders multiple triggered alerts', () => {
    render(<AlertPanel alerts={[errorAlert, warningAlert, infoAlert]} />);
    expect(screen.getByText('Active Alerts (3)')).toBeInTheDocument();
  });

  it('renders alert rule text', () => {
    render(<AlertPanel alerts={[errorAlert]} />);
    expect(screen.getByText('Latency exceeds 5000ms')).toBeInTheDocument();
  });

  it('renders error severity badge', () => {
    render(<AlertPanel alerts={[errorAlert]} />);
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('renders warning severity badge', () => {
    render(<AlertPanel alerts={[warningAlert]} />);
    expect(screen.getByText('warning')).toBeInTheDocument();
  });

  it('renders info severity badge', () => {
    render(<AlertPanel alerts={[infoAlert]} />);
    expect(screen.getByText('info')).toBeInTheDocument();
  });

  it('renders actual and threshold details for error alert', () => {
    render(<AlertPanel alerts={[errorAlert]} />);
    expect(screen.getByText(/6200ms exceeds threshold of 5000ms/)).toBeInTheDocument();
  });

  it('renders actual and threshold details for warning alert', () => {
    render(<AlertPanel alerts={[warningAlert]} />);
    expect(screen.getByText(/9200 exceeds threshold of 8000/)).toBeInTheDocument();
  });

  it('applies error border style for error severity', () => {
    const { container } = render(<AlertPanel alerts={[errorAlert]} />);
    const alertCard = container.querySelector('.border-red-500');
    expect(alertCard).toBeTruthy();
  });

  it('applies warning border style for warning severity', () => {
    const { container } = render(<AlertPanel alerts={[warningAlert]} />);
    const alertCard = container.querySelector('.border-yellow-500');
    expect(alertCard).toBeTruthy();
  });

  it('applies info border style for info severity', () => {
    const { container } = render(<AlertPanel alerts={[infoAlert]} />);
    const alertCard = container.querySelector('.border-blue-500');
    expect(alertCard).toBeTruthy();
  });
});
