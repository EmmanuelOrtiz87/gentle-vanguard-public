import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptStudio } from './PromptStudio';

describe('PromptStudio', () => {
  it('renders the studio header and form controls', () => {
    render(<PromptStudio />);
    expect(screen.getByText('Prompt Studio')).toBeDefined();
    expect(screen.getByLabelText('Task type')).toBeDefined();
    expect(screen.getByLabelText('Assistant role')).toBeDefined();
    expect(screen.getByLabelText('Goal / task')).toBeDefined();
    expect(screen.getByLabelText('Your prompt')).toBeDefined();
  });

  it('builds a structured prompt with sections from the inputs', () => {
    render(<PromptStudio />);
    fireEvent.change(screen.getByLabelText('Assistant role'), {
      target: { value: 'Senior QA engineer' },
    });
    fireEvent.change(screen.getByLabelText('Goal / task'), {
      target: { value: 'Review the auth module' },
    });
    const out = screen.getByLabelText('Your prompt') as HTMLTextAreaElement;
    expect(out.value).toContain('# Role');
    expect(out.value).toContain('Senior QA engineer');
    expect(out.value).toContain('Review the auth module');
    expect(out.value).toContain('# Task');
    expect(out.value).toContain('# Output format');
    expect(out.value).toContain('# Verification');
  });

  it('loads the example into every field', () => {
    render(<PromptStudio />);
    fireEvent.click(screen.getByRole('button', { name: /Load example/i }));
    expect((screen.getByLabelText('Goal / task') as HTMLInputElement).value).toContain(
      'checkout module',
    );
    const out = screen.getByLabelText('Your prompt') as HTMLTextAreaElement;
    expect(out.value).toContain('# Acceptance criteria');
    expect(out.value).toContain('No high/medium vulnerabilities');
  });

  it('includes acceptance criteria as a list', () => {
    render(<PromptStudio />);
    fireEvent.change(screen.getByLabelText('Acceptance criteria (one per line)'), {
      target: { value: 'covers edge cases\nno regressions' },
    });
    const out = screen.getByLabelText('Your prompt') as HTMLTextAreaElement;
    expect(out.value).toContain('- covers edge cases');
    expect(out.value).toContain('- no regressions');
  });
});
