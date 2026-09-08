import { Button, Card, CardDescription, CardHeader, CardTitle, StatusBadge } from '@verify/ui';

import type { RunsResult } from '../dashboard/types.js';
import { ChevronIcon, HistoryIcon } from './icons.js';

export interface HistoryPanelProps {
  readonly runs: RunsResult['runs'];
  readonly selectedRunId?: string;
  readonly onSelect: (runId?: string) => void;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function HistoryPanel({ onSelect, runs, selectedRunId }: HistoryPanelProps) {
  return (
    <Card aria-labelledby="history-title">
      <CardHeader>
        <div>
          <p className="eyebrow">Local SQLite history</p>
          <CardTitle id="history-title">Recent runs</CardTitle>
          <CardDescription>Persisted engine results for this repository.</CardDescription>
        </div>
        <HistoryIcon className="section-icon" />
      </CardHeader>

      {selectedRunId ? (
        <div className="history-notice" role="status">
          <span>Viewing saved run {selectedRunId}</span>
          <Button compact variant="quiet" onClick={() => onSelect(undefined)}>
            Return to latest
          </Button>
        </div>
      ) : null}

      {runs.length === 0 ? (
        <div className="compact-empty">
          <span className="muted-text">No persisted runs yet.</span>
        </div>
      ) : (
        <ol className="history-list">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="history-row"
                aria-pressed={selectedRunId === run.id}
                aria-label={`Open run ${run.id}, ${run.gate?.status ?? run.status}`}
                onClick={() => onSelect(run.id)}
              >
                <StatusBadge
                  status={run.gate?.status ?? 'unknown'}
                  label={run.gate?.status ?? run.status}
                />
                <span className="history-row__time">
                  <time dateTime={run.startedAt}>{formatTimestamp(run.startedAt)}</time>
                  <small>
                    {run.checks.length} checks · {run.id}
                  </small>
                </span>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
