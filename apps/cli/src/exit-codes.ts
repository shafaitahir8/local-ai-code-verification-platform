import type { VerificationRun } from '@verify/domain';

export const EXIT_CODES = {
  success: 0,
  blocked: 1,
  error: 2,
  interrupted: 3,
} as const;

export function exitCodeForRun(run: VerificationRun): 0 | 1 | 2 | 3 {
  if (run.status === 'cancelled' || run.checks.some((check) => check.status === 'cancelled')) {
    return EXIT_CODES.interrupted;
  }
  if (run.status === 'error' || run.checks.some((check) => check.status === 'error')) {
    return EXIT_CODES.error;
  }
  return run.gate?.status === 'BLOCK' ? EXIT_CODES.blocked : EXIT_CODES.success;
}
