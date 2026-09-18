import { Button, Card, CardDescription, CardHeader, CardTitle, Spinner } from '@verify/ui';

import type { ApprovalPhase, ApprovalStatus, RunPhase } from '../dashboard/types.js';
import { PlayIcon } from './icons.js';

export interface ApprovedVerificationActionsProps {
  readonly approval?: ApprovalStatus;
  readonly approvalPhase: ApprovalPhase;
  readonly runPhase: RunPhase;
  readonly viewingHistory: boolean;
  readonly onRunQuick: () => void;
  readonly onRunFull: () => void;
}

function availabilityMessage(approval?: ApprovalStatus): string {
  switch (approval?.status) {
    case 'approved':
      return 'The current executable policy is approved. The engine will check it again before running.';
    case 'migration-required':
      return 'This version 1 policy must be migrated and then explicitly approved before these actions can run.';
    case 'outdated':
      return 'Approval is outdated because the executable policy changed. Review and approve the current policy.';
    case 'revoked':
      return 'Approval was revoked. Review and explicitly approve the policy again.';
    case 'not-approved':
      return 'Review and approve the current executable policy before running these actions.';
    case 'policy-invalid':
      return 'The project policy is invalid. Fix it before requesting approved verification.';
    case 'policy-missing':
      return 'No executable policy exists yet. Configure and approve one before running these actions.';
    default:
      return 'Checking the current executable policy approval.';
  }
}

export function ApprovedVerificationActions({
  approval,
  approvalPhase,
  runPhase,
  viewingHistory,
  onRunQuick,
  onRunFull,
}: ApprovedVerificationActionsProps) {
  const checking = approvalPhase === 'loading';
  const active = runPhase === 'running' || runPhase === 'cancelling';
  const enabled =
    approvalPhase === 'ready' && approval?.status === 'approved' && !active && !viewingHistory;

  return (
    <Card aria-labelledby="approved-verification-title" aria-busy={checking}>
      <CardHeader>
        <div>
          <p className="eyebrow">Simple actions</p>
          <CardTitle id="approved-verification-title">Approved verification</CardTitle>
          <CardDescription>
            Run only the named suites in the current approved Quick or Full policy. The engine
            checks authorization again at execution time.
          </CardDescription>
        </div>
        {checking ? <Spinner /> : null}
      </CardHeader>
      <div className="approved-verification-content">
        <p role="status">{availabilityMessage(approval)}</p>
        <div className="approved-verification-actions">
          <Button variant="primary" disabled={!enabled} onClick={onRunQuick}>
            <PlayIcon className="button-icon" /> Verify Changes / Quick Verification
          </Button>
          <Button variant="secondary" disabled={!enabled} onClick={onRunFull}>
            <PlayIcon className="button-icon" /> Full Verification
          </Button>
        </div>
        <p className="approved-verification-boundary">
          These actions use approved policy membership, not the read-only project-profile preview.
          Stop, output, gate, and history appear in the verification run below.
        </p>
      </div>
    </Card>
  );
}
