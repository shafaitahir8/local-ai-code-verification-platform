import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cx } from './cx.js';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly compact?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, compact = false, type = 'button', variant = 'secondary', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'verify-button',
        `verify-button--${variant}`,
        compact && 'verify-button--compact',
        className,
      )}
      {...props}
    />
  );
});
