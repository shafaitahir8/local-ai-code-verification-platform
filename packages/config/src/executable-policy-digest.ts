import { createHash } from 'node:crypto';

import { EXECUTABLE_POLICY_DIGEST_VERSION, type ExecutablePolicyReview } from '@verify/domain';

import type { ProjectConfigV2 } from './types.js';
import { validateProjectConfigV2 } from './validation.js';

/**
 * Hash only validated executable semantics, not source YAML bytes or presentation metadata.
 * The explicit projection version must advance when future supported execution fields are added.
 */
export function reviewExecutablePolicy(policy: ProjectConfigV2): ExecutablePolicyReview {
  const valid = validateProjectConfigV2(policy);
  return {
    digestVersion: EXECUTABLE_POLICY_DIGEST_VERSION,
    policySchemaVersion: valid.version,
    suites: Object.entries(valid.suites)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([id, suite]) => ({
        id,
        type: suite.type,
        command: suite.command,
        failurePolicy: suite.failure_policy,
        timeoutMs: suite.timeout_ms ?? null,
      })),
    plans: {
      quick: [...valid.plans.quick.suites],
      full: [...valid.plans.full.suites],
    },
    // These fields are empty-only in the present schema. Future executable extensions must
    // expand this projection and increment its version before they can be approved.
    launchTargets: valid.launch_targets,
    overrides: valid.overrides,
  };
}

export function digestExecutablePolicy(policy: ProjectConfigV2): string {
  return createHash('sha256')
    .update(JSON.stringify(reviewExecutablePolicy(policy)), 'utf8')
    .digest('hex');
}
