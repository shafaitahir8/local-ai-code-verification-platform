import { Card } from '@verify/ui';

import { FolderIcon, ShieldIcon } from './icons.js';

export function EmptyState({ loading = false }: { readonly loading?: boolean }) {
  return (
    <Card className="empty-state" aria-labelledby="empty-state-title" aria-busy={loading}>
      <div className="empty-state__mark" aria-hidden="true">
        {loading ? <ShieldIcon /> : <FolderIcon />}
      </div>
      <p className="eyebrow">Local-first verification</p>
      <h1 id="empty-state-title">{loading ? 'Inspecting repository…' : 'Open a repository'}</h1>
      <p>
        {loading
          ? 'Reading project signals, configuration, Git changes, and local run history.'
          : 'Choose a Git repository to discover its configured checks and inspect current changes. Source and evidence stay on this machine.'}
      </p>
      <ol className="onboarding-steps" aria-label="First launch workflow">
        <li>
          <span>1</span>Select a repository
        </li>
        <li>
          <span>2</span>Inspect configuration and changes
        </li>
        <li>
          <span>3</span>Run the local quality gate
        </li>
      </ol>
    </Card>
  );
}
