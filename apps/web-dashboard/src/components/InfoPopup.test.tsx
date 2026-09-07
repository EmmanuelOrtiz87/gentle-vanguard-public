import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoPopup } from './InfoPopup';

describe('InfoPopup', () => {
  const mockInfo = {
    label: 'Tokens Used',
    description: 'Total LLM tokens consumed',
    what: 'Tokens are the basic units of text that LLMs process.',
    how: 'Aggregated from .session/context-log/*/.state.json files.',
  };

  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('renders label and description', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    expect(screen.getByText('Tokens Used')).toBeInTheDocument();
    expect(screen.getByText('Total LLM tokens consumed')).toBeInTheDocument();
  });

  it('renders "What it measures" section', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    expect(screen.getByText('What it measures')).toBeInTheDocument();
    expect(
      screen.getByText('Tokens are the basic units of text that LLMs process.'),
    ).toBeInTheDocument();
  });

  it('renders "How it\'s calculated" section', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    expect(screen.getByText("How it's calculated")).toBeInTheDocument();
    expect(
      screen.getByText('Aggregated from .session/context-log/*/.state.json files.'),
    ).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside the popup', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    // Click on the overlay backdrop (outside the popup card)
    const backdrop = document.querySelector('.fixed.inset-0.z-40');
    expect(backdrop).toBeTruthy();
    if (backdrop) {
      fireEvent.mouseDown(backdrop);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    }
  });

  it('does not call onClose when clicking inside the popup', () => {
    render(<InfoPopup info={mockInfo} onClose={mockOnClose} />);
    const heading = screen.getByText('Tokens Used');
    fireEvent.mouseDown(heading);
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
