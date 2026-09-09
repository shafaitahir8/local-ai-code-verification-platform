import { StatusBadge } from '@verify/ui';

import type { LatestGateResult, RunPhase, VerificationRun } from '../dashboard/types.js';
import { ShieldIcon } from './icons.js';

export interface GateHeroProps {
  readonly run?: VerificationRun;
  readonly latestGate?: LatestGateResult;
  readonly runPhase: RunPhase;
  readonly viewingHistory: boolean;
}

const gateHeadline = {
  PASS: 'Ready for merge',
  WARN: 'Review recommended',
  BLOCK: 'Merge blocked',
} as const;

export function GateHero({ latestGate, run, runPhase, viewingHistory }: GateHeroProps) {
  const gate = run?.gate ?? latestGate?.gate;
  const isRunning = runPhase === 'running' && !viewingHistory;
  const isCancelling = runPhase === 'cancelling' && !viewingHistory;
  const isActive = isRunning || isCancelling;

  return (
    <section className="gate-hero" aria-labelledby="gate-heading" aria-live="polite">
      <div className="gate-hero__watermark" aria-hidden="true">
        <ShieldIcon />
      </div>
      <div className="gate-hero__content">
        <p className="eyebrow">
          {viewingHistory
            ? 'Saved verification run'
            : isActive
              ? 'Verification running'
              : 'Quality gate'}
        </p>
        <h1 id="gate-heading">
          {isCancelling
            ? 'Saving interrupted run'
            : isRunning
              ? 'Collecting evidence'
              : gate
                ? gateHeadline[gate.status]
                : 'No result yet'}
        </h1>
        {isActive ? (
          <StatusBadge
            status="running"
            label={isCancelling ? 'Stopping configured checks' : 'Running configured checks'}
          />
        ) : gate ? (
          <StatusBadge status={gate.status} label={`Quality gate: ${gate.status}`} />
        ) : (
          <StatusBadge status="unknown" label="Quality gate not evaluated" />
        )}
        <p className="gate-hero__reason">
          {isActive
            ? isCancelling
              ? 'Waiting for the engine to persist cancelled evidence and release its processes.'
              : 'Live output is available below. The engine will provide the final gate.'
            : (gate?.reasons.at(0) ??
              'Run verification to produce a deterministic release decision.')}
        </p>
      </div>
      {gate ? (
        <dl className="gate-summary" aria-label="Gate result summary">
          <div>
            <dt>Passed</dt>
            <dd>{gate.summary.passed}</dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd>{gate.summary.warning}</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd>{gate.summary.failed + gate.summary.error}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{gate.summary.total}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
