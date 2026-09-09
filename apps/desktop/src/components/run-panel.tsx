import { Button, Card, CardDescription, CardHeader, CardTitle, StatusBadge } from '@verify/ui';

import type { RunPhase, VerificationRun } from '../dashboard/types.js';
import { PlayIcon, StopIcon, TerminalIcon } from './icons.js';

export interface RunPanelProps {
  readonly configured: boolean;
  readonly output: string;
  readonly run?: VerificationRun;
  readonly runPhase: RunPhase;
  readonly viewingHistory: boolean;
  readonly onRun: () => void;
  readonly onStop: () => void;
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) {
    return '—';
  }
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}

export function RunPanel({
  configured,
  onRun,
  onStop,
  output,
  run,
  runPhase,
  viewingHistory,
}: RunPanelProps) {
  const isRunning = runPhase === 'running';
  const isCancelling = runPhase === 'cancelling';
  const isActive = isRunning || isCancelling;
  const visibleOutput = viewingHistory
    ? (run?.checks.map((check) => `${check.stdout ?? ''}${check.stderr ?? ''}`).join('') ?? '')
    : output ||
      run?.checks.map((check) => `${check.stdout ?? ''}${check.stderr ?? ''}`).join('') ||
      '';

  return (
    <Card className="run-card" aria-labelledby="run-title">
      <CardHeader>
        <div>
          <p className="eyebrow">Deterministic evidence</p>
          <CardTitle id="run-title">Verification run</CardTitle>
          <CardDescription>
            {viewingHistory
              ? `Viewing persisted run ${run?.id ?? ''}`
              : isCancelling
                ? 'Stopping checks and saving interrupted evidence.'
                : isRunning
                  ? 'Configured commands are running locally.'
                  : 'Execute only the commands declared in repository configuration.'}
          </CardDescription>
        </div>
        {isActive ? (
          <Button variant="danger" onClick={onStop} disabled={isCancelling}>
            <StopIcon className="button-icon" /> {isCancelling ? 'Stopping…' : 'Stop run'}
          </Button>
        ) : (
          <Button variant="primary" onClick={onRun} disabled={!configured || viewingHistory}>
            <PlayIcon className="button-icon" /> Run verification
          </Button>
        )}
      </CardHeader>

      <div className="run-layout">
        <div className="results-list" aria-label="Check results">
          {(run?.checks ?? []).length > 0 ? (
            run?.checks.map((check) => (
              <details key={check.id} className="result-row">
                <summary>
                  <span className="result-row__name">
                    <StatusBadge status={check.status} label={check.status} />
                    <strong>{check.name}</strong>
                  </span>
                  <span>{formatDuration(check.durationMs)}</span>
                </summary>
                <div className="result-detail">
                  {check.command ? <code>{check.command}</code> : null}
                  {check.errorSummary ? <p>{check.errorSummary}</p> : null}
                  {check.findings.length > 0 ? (
                    <ul aria-label={`${check.name} findings`}>
                      {check.findings.map((finding, index) => (
                        <li key={finding.id ?? `${finding.source}-${String(index)}`}>
                          <strong>{finding.severity}:</strong> {finding.message}
                          {finding.file ? (
                            <span>
                              {' '}
                              — {finding.file}
                              {finding.line ? `:${finding.line}` : ''}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            ))
          ) : (
            <div className="compact-empty">
              <span className="muted-text">
                {isActive ? 'Results appear as checks complete.' : 'No check results to display.'}
              </span>
            </div>
          )}
        </div>

        <div className="terminal" aria-label="Verification output">
          <div className="terminal__toolbar">
            <span>
              <TerminalIcon />
              Local output
            </span>
            {isActive ? (
              <StatusBadge status="running" label={isCancelling ? 'Stopping' : 'Streaming'} />
            ) : null}
          </div>
          <pre tabIndex={0}>{visibleOutput || '$ Waiting for a verification run…'}</pre>
        </div>
      </div>
    </Card>
  );
}
