import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Button, Card, CardTitle, StatusBadge } from '../src/index.js';

describe('UI primitives', () => {
  it('keeps buttons native, labelled, and ref-addressable', () => {
    const ref = createRef<HTMLButtonElement>();

    render(
      <Button ref={ref} variant="primary">
        Run verification
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Run verification' })).toBeEnabled();
    expect(ref.current?.type).toBe('button');
  });

  it('renders status with a readable label and a non-color symbol', () => {
    render(<StatusBadge status="BLOCK" label="Quality gate: BLOCK" />);

    const badge = screen.getByText('Quality gate: BLOCK').closest('[data-status]');
    expect(badge).toHaveAttribute('data-status', 'BLOCK');
    expect(badge).toHaveTextContent('×');
  });

  it('allows cards to retain section heading semantics', () => {
    render(
      <Card aria-labelledby="checks-title">
        <CardTitle id="checks-title">Configured checks</CardTitle>
      </Card>,
    );

    expect(screen.getByRole('region', { name: 'Configured checks' })).toBeInTheDocument();
  });
});
