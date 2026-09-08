import type { HTMLAttributes } from 'react';

import { cx } from './cx.js';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cx('verify-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('verify-card__header', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cx('verify-card__title', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('verify-card__description', className)} {...props} />;
}
