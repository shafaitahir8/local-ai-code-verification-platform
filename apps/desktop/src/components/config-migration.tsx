import { Button, Card, CardDescription, CardHeader, CardTitle, Spinner } from '@verify/ui';

import type { ConfigResult, MigrationPhase, MigrationPreview } from '../dashboard/types.js';

export interface ConfigMigrationProps {
  readonly policy: ConfigResult;
  readonly preview?: MigrationPreview;
  readonly phase: MigrationPhase;
  readonly error?: string;
  readonly onPreview: () => void;
  readonly onApply: () => void;
}

export function ConfigMigrationCard({
  policy,
  preview,
  phase,
  error,
  onPreview,
  onApply,
}: ConfigMigrationProps) {
  const version = policy.config?.version;
  const busy = phase === 'previewing' || phase === 'applying';
  const canApply = version === 1 && preview !== undefined && phase === 'ready';

  return (
    <Card aria-labelledby="config-migration-title" aria-busy={busy}>
      <CardHeader>
        <div>
          <p className="eyebrow">Reviewable project policy</p>
          <CardTitle id="config-migration-title">Configuration Migration</CardTitle>
          <CardDescription>
            Review the exact policy change before updating <code>.verify/project.yml</code>.
          </CardDescription>
        </div>
        {busy ? <Spinner /> : null}
      </CardHeader>

      <div className="migration-content">
        <p className="migration-version">
          Current version: <strong>{version ?? 'Not configured'}</strong>
          {version === 1 ? (
            <>
              {' '}
              → Target version: <strong>2</strong>
            </>
          ) : null}
        </p>

        {!policy.exists ? (
          <p>Initialize project configuration before reviewing a migration.</p>
        ) : version === 2 ? (
          <p>This project already uses configuration version 2. No migration is needed.</p>
        ) : (
          <>
            <p>
              Version 1 stays unchanged until you review the preview and choose Apply Migration.
            </p>
            <div className="migration-actions">
              <Button variant="secondary" disabled={busy} onClick={onPreview}>
                {preview ? 'Refresh Migration Preview' : 'Review Migration'}
              </Button>
              {preview ? (
                <Button variant="primary" disabled={!canApply} onClick={onApply}>
                  Apply Migration
                </Button>
              ) : null}
            </div>
          </>
        )}

        {phase === 'previewing' ? (
          <p role="status">Preparing the exact version 1 to version 2 policy diff.</p>
        ) : null}
        {phase === 'applying' ? (
          <p role="status">Checking that the source is unchanged and applying migration.</p>
        ) : null}
        {phase === 'applied' ? (
          <p role="status">Migration applied. Commands are not approved by this change.</p>
        ) : null}
        {phase === 'stale' ? (
          <p className="migration-error" role="alert">
            The policy changed after this preview. Nothing was overwritten. Review a fresh migration
            preview before applying.
          </p>
        ) : null}
        {error && phase !== 'stale' ? (
          <p className="migration-error" role="alert">
            {error}
          </p>
        ) : null}

        {preview ? (
          <section aria-labelledby="migration-preview-title" className="migration-preview">
            <h3 id="migration-preview-title">Migration Preview</h3>
            <p>{preview.summary}</p>
            <p>
              Source version {preview.sourceVersion} → target version {preview.targetVersion}
            </p>
            <pre className="migration-diff" aria-label="Exact migration YAML diff">
              {preview.diff}
            </pre>
            <details>
              <summary>Technical revision details</summary>
              <p>
                Source SHA-256: <code>{preview.sourceDigest}</code>
              </p>
              <p>
                Target SHA-256: <code>{preview.targetDigest}</code>
              </p>
            </details>
          </section>
        ) : null}

        <p className="migration-boundary">
          Reviewing does not write policy. Applying changes only the YAML policy; it does not
          approve or run commands.
        </p>
      </div>
    </Card>
  );
}
