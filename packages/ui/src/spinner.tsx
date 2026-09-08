import type { HTMLAttributes } from 'react';

import { cx } from './cx.js';

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" className={cx('verify-spinner', className)} {...props} />;
}
