import type { HTMLAttributes } from 'react';

import { cx } from './cx.js';

export function VisuallyHidden({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('verify-sr-only', className)} {...props} />;
}
