import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx.js';

export type SemanticStatus =
  | 'PASS'
  | 'WARN'
  | 'BLOCK'
  | 'passed'
  | 'warning'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'skipped'
  | 'running'
  | 'ready'
  | 'unknown';

const statusSymbol: Readonly<Record<SemanticStatus, ReactNode>> = {
  PASS: '✓',
  WARN: '!',
  BLOCK: '×',
  passed: '✓',
  warning: '!',
  failed: '×',
  error: '×',
  cancelled: '—',
  skipped: '–',
  running: '•',
  ready: '✓',
  unknown: '?',
};

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly status: SemanticStatus;
  readonly label?: string;
}

export function StatusBadge({ className, label, status, ...props }: StatusBadgeProps) {
  const visibleLabel = label ?? status;

  return (
    <span
      className={cx('verify-status', `verify-status--${status.toLowerCase()}`, className)}
      data-status={status}
      {...props}
    >
      <span className="verify-status__icon" aria-hidden="true">
        {statusSymbol[status]}
      </span>
      <span>{visibleLabel}</span>
    </span>
  );
}
