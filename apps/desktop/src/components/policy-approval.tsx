import { Button, Card, CardDescription, CardHeader, CardTitle, Spinner } from '@verify/ui';

import type { ApprovalPhase, ApprovalStatus } from '../dashboard/types.js';

export interface PolicyApprovalProps {
  readonly approval?: ApprovalStatus;
  readonly phase: ApprovalPhase;
  readonly error?: string;
  readonly onApprove: () => void;
  readonly onRevoke: () => void;
  readonly onRefresh: () => void;
}

const labels: Readonly<Record<ApprovalStatus['status'], string>> = {
  'policy-missing': 'No policy to approve',
  'policy-invalid': 'Policy invalid; approval unavailable',
  'migration-required': 'Migration required before approval',
  'not-approved': 'Not approved',
  approved: 'Approved',
  outdated: 'Approval outdated because policy changed',
  revoked: 'Approval revoked',
};

export function PolicyApprovalCard({
  approval,
  phase,
  error,
  onApprove,
  onRevoke,
  onRefresh,
}: PolicyApprovalProps) {
  const busy = phase === 'loading' || phase === 'approving' || phase === 'revoking';
  const reviewedPolicy = approval?.review;
  const canApprove =
    reviewedPolicy !== undefined &&
    reviewedPolicy !== null &&
    approval?.policyVersion === 2 &&
    approval.policyDigest !== null &&
    (approval.status === 'not-approved' ||
      approval.status === 'outdated' ||
      approval.status === 'revoked') &&
    !busy;
  const canRevoke = approval?.receipt?.revokedAt === null && !busy;

  return (
    <Card aria-labelledby="policy-approval-title" aria-busy={busy}>
      <CardHeader>
        <div>
          <p className="eyebrow">Local execution permission</p>
          <CardTitle id="policy-approval-title">Executable Policy Approval</CardTitle>
          <CardDescription>
            Review the current commands, then explicitly approve their policy for future smart
            actions. This does not run anything.
          </CardDescription>
        </div>
        {busy ? <Spinner /> : null}
      </CardHeader>

      <div className="approval-content">
        <p role="status" className="approval-status">
          {approval
            ? labels[approval.status]
            : busy
              ? 'Checking approval status…'
              : 'Status unavailable'}
        </p>
        {approval?.status === 'migration-required' ? (
          <p>
            Version 1 verification still works. Migrate explicitly before approving new actions.
          </p>
        ) : null}
        {approval?.status === 'policy-invalid' ? (
          <p>
            Fix or restore the project policy before approval. A saved receipt can still be revoked.
          </p>
        ) : null}
        {approval?.status === 'outdated' ? (
          <p>
            The saved receipt does not match the current executable policy. Review and approve
            again.
          </p>
        ) : null}
        {approval?.status === 'revoked' ? (
          <p>Previous approval was revoked. Review the policy before approving again.</p>
        ) : null}

        {reviewedPolicy ? (
          <section aria-labelledby="approval-review-title" className="approval-review">
            <h3 id="approval-review-title">Commands in the current policy</h3>
            <ul aria-label="Executable policy suites">
              {reviewedPolicy.suites.map((suite) => (
                <li key={suite.id}>
                  <strong>{suite.id}</strong>: <code>{suite.command}</code> ({suite.type};{' '}
                  {suite.failurePolicy};{' '}
                  {suite.timeoutMs === null ? 'default timeout' : `timeout ${suite.timeoutMs} ms`})
                </li>
              ))}
            </ul>
            <p>
              Quick: {reviewedPolicy.plans.quick.join(', ') || 'No suites'} · Full:{' '}
              {reviewedPolicy.plans.full.join(', ') || 'No suites'}
            </p>
          </section>
        ) : null}

        {approval?.policyDigest ? (
          <details>
            <summary>Approval identity</summary>
            <p>
              Executable policy SHA-256: <code>{approval.policyDigest}</code>
            </p>
            <p>Repository: {approval.repositoryRoot}</p>
          </details>
        ) : null}

        <div className="approval-actions">
          <Button variant="secondary" disabled={busy} onClick={onRefresh}>
            Refresh Approval Status
          </Button>
          {canApprove ? (
            <Button variant="primary" onClick={onApprove}>
              Approve Current Policy
            </Button>
          ) : null}
          {canRevoke ? (
            <Button variant="secondary" onClick={onRevoke}>
              Revoke Approval
            </Button>
          ) : null}
        </div>
        {phase === 'approving' ? <p role="status">Approving the reviewed policy…</p> : null}
        {phase === 'revoking' ? <p role="status">Revoking the current approval…</p> : null}
        {error ? (
          <p className="approval-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="approval-boundary">
          Migration does not approve commands. Approval does not execute a plan or change the
          existing verification gate.
        </p>
      </div>
    </Card>
  );
}
