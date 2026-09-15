import { Button, Card, CardDescription, CardHeader, CardTitle, StatusBadge } from '@verify/ui';

import type { ConfigResult, DiscoveryResult, LiveCheck } from '../dashboard/types.js';

export interface ChecksPanelProps {
  readonly config: ConfigResult;
  readonly discovery: DiscoveryResult;
  readonly liveChecks: readonly LiveCheck[];
  readonly initializing: boolean;
  readonly onInitialize: () => void;
}

export function ChecksPanel({
  config,
  discovery,
  initializing,
  liveChecks,
  onInitialize,
}: ChecksPanelProps) {
  const configuredChecks = config.config ? Object.entries(config.config.suites) : [];

  return (
    <Card aria-labelledby="checks-title">
      <CardHeader>
        <div>
          <p className="eyebrow">Configured execution</p>
          <CardTitle id="checks-title">
            {config.exists ? 'Configured checks' : 'Suggested checks'}
          </CardTitle>
          <CardDescription>
            {config.exists
              ? `${configuredChecks.length} commands from .verify/project.yml`
              : 'Review the discovered commands before initialization.'}
          </CardDescription>
        </div>
        {!config.exists ? (
          <Button variant="primary" onClick={onInitialize} disabled={initializing}>
            Initialize project
          </Button>
        ) : null}
      </CardHeader>

      <ul
        className="check-list"
        aria-label={config.exists ? 'Configured checks' : 'Suggested checks'}
      >
        {config.exists
          ? configuredChecks.map(([id, check]) => {
              const live = liveChecks.find((item) => item.check.id === id);
              return (
                <li key={id}>
                  <div className="check-list__identity">
                    <StatusBadge
                      status={live?.status ?? 'ready'}
                      label={live ? live.status : 'Ready'}
                    />
                    <div>
                      <strong>{id}</strong>
                      <code>{check.command}</code>
                    </div>
                  </div>
                  <span className={`policy policy--${check.failure_policy}`}>
                    {check.failure_policy === 'block' ? 'Blocks on failure' : 'Warns on failure'}
                  </span>
                </li>
              );
            })
          : discovery.suggestedSuites.map((check) => (
              <li key={check.id}>
                <div className="check-list__identity">
                  <StatusBadge status="unknown" label="Suggested" />
                  <div>
                    <strong>{check.id}</strong>
                    <code>{check.command}</code>
                  </div>
                </div>
                <span className={`policy policy--${check.failure_policy}`}>
                  {check.failure_policy === 'block' ? 'Blocks on failure' : 'Warns on failure'}
                </span>
              </li>
            ))}
      </ul>

      {!config.exists ? (
        <p className="config-note">
          Initialization writes <code>{config.path}</code>. Existing configuration is never
          overwritten.
        </p>
      ) : null}
    </Card>
  );
}
