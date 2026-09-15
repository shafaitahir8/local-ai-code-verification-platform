import { Card, CardDescription, CardHeader, CardTitle, Spinner, StatusBadge } from '@verify/ui';

import type {
  ProfilePhase,
  VerificationPlan,
  VerificationPlanPreview,
} from '../dashboard/types.js';

export interface VerificationPlanPreviewProps {
  readonly preview?: VerificationPlanPreview;
  readonly profilePhase: ProfilePhase;
}

function modeName(mode: VerificationPlan['mode']): string {
  return mode === 'quick' ? 'Quick' : 'Full';
}

function PlanMode({ plan }: { readonly plan: VerificationPlan }) {
  const title = modeName(plan.mode);

  return (
    <section className="plan-mode" aria-labelledby={`verification-plan-${plan.mode}`}>
      <div className="plan-mode__header">
        <div>
          <h3 id={`verification-plan-${plan.mode}`}>{title}</h3>
          <p>{plan.statusReason}</p>
        </div>
        <StatusBadge
          status={plan.status === 'ready' ? 'ready' : 'unknown'}
          label={plan.status === 'ready' ? 'Ready' : 'Unavailable'}
        />
      </div>

      <div className="plan-decision-group">
        <h4>Selected checks</h4>
        {plan.selectedChecks.length > 0 ? (
          <ul className="plan-check-list" aria-label={`${title} selected checks`}>
            {plan.selectedChecks.map((decision) => (
              <li key={decision.taskCandidateId}>
                <div className="plan-check__heading">
                  <StatusBadge status="ready" label="Selected" />
                  <div>
                    <strong>{decision.label}</strong>
                    <code>{decision.command}</code>
                  </div>
                </div>
                <p>{decision.reason}</p>
                <details>
                  <summary>Technical recommendation evidence</summary>
                  <span>
                    Working directory: <code>{decision.workingDirectory}</code>
                  </span>
                  <span>
                    Capabilities:{' '}
                    <code>{decision.capabilityIds.join(', ') || 'No capability reference'}</code>
                  </span>
                  <span>
                    Evidence:{' '}
                    <code>{decision.evidenceIds.join(', ') || 'No evidence reference'}</code>
                  </span>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plan-empty">No checks were selected for this mode.</p>
        )}
      </div>

      <div className="plan-decision-group">
        <h4>Skipped checks</h4>
        {plan.skippedChecks.length > 0 ? (
          <ul className="plan-check-list" aria-label={`${title} skipped checks`}>
            {plan.skippedChecks.map((decision) => (
              <li key={decision.taskCandidateId}>
                <div className="plan-check__heading">
                  <StatusBadge status="skipped" label="Skipped" />
                  <div>
                    <strong>{decision.label}</strong>
                    <code>{decision.command}</code>
                  </div>
                </div>
                <p>{decision.reason}</p>
                <details>
                  <summary>Technical recommendation evidence</summary>
                  <span>
                    Working directory: <code>{decision.workingDirectory}</code>
                  </span>
                  <span>
                    Capabilities:{' '}
                    <code>{decision.capabilityIds.join(', ') || 'No capability reference'}</code>
                  </span>
                  <span>
                    Evidence:{' '}
                    <code>{decision.evidenceIds.join(', ') || 'No evidence reference'}</code>
                  </span>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plan-empty">No evidence-backed checks were skipped.</p>
        )}
      </div>

      <p className="plan-mode__source">
        Deterministic source: {plan.recommendationSource.replaceAll('-', ' ')} · Plan v
        {plan.planVersion}
      </p>
    </section>
  );
}

function phaseMessage(phase: ProfilePhase, hasPreview: boolean): string | undefined {
  if (phase === 'running') {
    return hasPreview
      ? 'Refreshing the project profile and verification plan preview.'
      : 'Building the project profile and verification plan preview.';
  }
  if (phase === 'cancelling') return 'Stopping the project scan and plan preview.';
  if (phase === 'cancelled') {
    return hasPreview
      ? 'Refresh stopped; the last completed verification plan remains displayed.'
      : 'The scan stopped before a verification plan could be produced.';
  }
  if (phase === 'error') {
    return hasPreview
      ? 'Refresh failed; the last completed verification plan remains displayed.'
      : 'A verification plan preview could not be produced.';
  }
  return undefined;
}

export function VerificationPlanPreviewCard({
  preview,
  profilePhase,
}: VerificationPlanPreviewProps) {
  const busy = profilePhase === 'running' || profilePhase === 'cancelling';
  const message = phaseMessage(profilePhase, preview !== undefined);

  return (
    <Card aria-labelledby="verification-plan-title" aria-busy={busy}>
      <CardHeader>
        <div>
          <p className="eyebrow">Deterministic recommendation</p>
          <CardTitle id="verification-plan-title">Verification Plan</CardTitle>
          <CardDescription>
            Quick and Full recommendations derived from the project profile.
          </CardDescription>
        </div>
        {busy ? <Spinner /> : null}
      </CardHeader>

      {message ? (
        <p
          className={`plan-preview-notice${profilePhase === 'error' ? ' plan-preview-notice--error' : ''}`}
          role="status"
        >
          {message}
        </p>
      ) : null}

      {preview ? (
        <>
          <p className="plan-preview-context">
            Based on the profile for <strong>{preview.profile.displayName}</strong> at{' '}
            <code>{preview.profile.repositoryRoot}</code>.
          </p>
          <div className="plan-preview-grid">
            <PlanMode plan={preview.plans.quick} />
            <PlanMode plan={preview.plans.full} />
          </div>
        </>
      ) : !busy && !message ? (
        <p className="plan-preview-notice">
          Understand the project to create a deterministic verification plan preview.
        </p>
      ) : null}

      <p className="plan-preview-boundary">
        Preview only — no check was run, and no repository, configuration, or history state was
        written.
      </p>
    </Card>
  );
}
