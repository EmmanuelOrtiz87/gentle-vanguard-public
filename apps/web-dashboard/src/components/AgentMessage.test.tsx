import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentMessage } from './AgentMessage';
import type { AgentMessage as AgentMessageType } from '../types/agent';

function makeMessage(overrides: Partial<AgentMessageType> = {}): AgentMessageType {
  return {
    id: 'msg-1',
    agent: 'DEV',
    role: 'assistant',
    content: 'Hello',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('AgentMessage', () => {
  it('renders the streaming cursor while the message is streaming', () => {
    render(<AgentMessage message={makeMessage({ streaming: true })} />);
    expect(document.querySelector('.streaming-cursor')).toBeInTheDocument();
  });

  it('does not render the streaming cursor when not streaming', () => {
    render(<AgentMessage message={makeMessage({ streaming: false })} />);
    expect(document.querySelector('.streaming-cursor')).not.toBeInTheDocument();
  });

  it('renders clickable list items and invokes onListItemClick', () => {
    const onListItemClick = vi.fn();
    render(
      <AgentMessage
        message={makeMessage({
          uiHints: [{ type: 'list', label: 'Skills', items: ['web-research'] }],
        })}
        onListItemClick={onListItemClick}
      />,
    );
    fireEvent.click(screen.getByText('web-research'));
    expect(onListItemClick).toHaveBeenCalledWith('web-research');
  });

  it('renders a cancelled tool call status', () => {
    render(
      <AgentMessage
        message={makeMessage({
          toolCalls: [{ id: 'tc-1', tool: 'execute_skill', status: 'cancelled' }],
        })}
      />,
    );
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });
});
