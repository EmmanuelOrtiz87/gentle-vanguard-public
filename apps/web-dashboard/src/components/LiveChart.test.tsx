import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveChart } from './LiveChart';

describe('LiveChart', () => {
  const mockData = [
    {
      timestamp: '2024-01-01T00:00:00Z',
      tokens: 100,
      sessions: 5,
      cost: 0.5,
      latency: 200,
      mcpSkills: 32,
      commits: 10,
    },
    {
      timestamp: '2024-01-01T00:05:00Z',
      tokens: 150,
      sessions: 3,
      cost: 0.7,
      latency: 180,
      mcpSkills: 32,
      commits: 8,
    },
  ];

  it('renders section heading', () => {
    render(<LiveChart data={mockData} />);
    expect(screen.getByText('Metrics History')).toBeInTheDocument();
  });

  it('renders chart responsive container', () => {
    const { container } = render(<LiveChart data={mockData} />);
    const responsiveContainer = container.querySelector('.recharts-responsive-container');
    expect(responsiveContainer).toBeTruthy();
  });

  it('renders section heading with empty data', () => {
    render(<LiveChart data={[]} />);
    expect(screen.getByText('Metrics History')).toBeInTheDocument();
  });

  it('renders chart container even with empty data', () => {
    const { container } = render(<LiveChart data={[]} />);
    const responsiveContainer = container.querySelector('.recharts-responsive-container');
    expect(responsiveContainer).toBeTruthy();
  });
});
