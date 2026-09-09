import { useEffect, useRef, useState } from 'react';

import type { EngineClient } from './engine/index.js';
import type { RepositoryPicker } from './runtime.js';
import { useDashboard } from './dashboard/use-dashboard.js';
import { Dashboard } from './components/dashboard.js';
import { EmptyState } from './components/empty-state.js';
import { ShieldIcon } from './components/icons.js';
import { RepositoryBar } from './components/repository-bar.js';
import { ThemeControl } from './components/theme-control.js';

export interface AppProps {
  readonly client: EngineClient;
  readonly pickRepository: RepositoryPicker;
  readonly initialRepository?: string;
}

export function App({ client, initialRepository, pickRepository }: AppProps) {
  const controller = useDashboard(client, initialRepository);
  const [path, setPath] = useState(initialRepository ?? '');
  const browseButton = useRef<HTMLButtonElement>(null);
  const busy =
    controller.loadPhase === 'loading' ||
    controller.runPhase === 'running' ||
    controller.runPhase === 'cancelling';

  const browse = async () => {
    const selected = await pickRepository();
    browseButton.current?.focus();
    if (selected) {
      setPath(selected);
      await controller.openRepository(selected);
    }
  };

  useEffect(() => {
    const openShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void browse();
      }
    };
    window.addEventListener('keydown', openShortcut);
    return () => window.removeEventListener('keydown', openShortcut);
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="brand" aria-label="Local Code Verifier">
          <span className="brand__mark" aria-hidden="true">
            <ShieldIcon />
          </span>
          <span>
            <strong>Local Verify</strong>
            <small>Deterministic code gate</small>
          </span>
        </div>
        <div className="header-actions">
          <span className="local-chip">
            <span aria-hidden="true" /> Local only
          </span>
          <ThemeControl />
        </div>
      </header>

      <div className="workspace-bar">
        <RepositoryBar
          ref={browseButton}
          path={path}
          busy={busy}
          hasProject={controller.loadPhase === 'ready'}
          onPathChange={setPath}
          onBrowse={() => void browse()}
          onOpen={(repository) => void controller.openRepository(repository)}
        />
      </div>

      <main id="main-content" className="app-main" tabIndex={-1}>
        {controller.error ? (
          <div className="error-banner" role="alert">
            <strong>Unable to complete the request</strong>
            <span>{controller.error}</span>
          </div>
        ) : null}

        {controller.loadPhase === 'ready' ? (
          <Dashboard controller={controller} />
        ) : (
          <EmptyState loading={controller.loadPhase === 'loading'} />
        )}
      </main>

      <footer className="app-footer">
        <span>v0.1.0 deterministic MVP</span>
        <span>Source, commands, and run evidence remain on this machine.</span>
      </footer>

      <div className="verify-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {controller.liveAnnouncement}
      </div>
    </div>
  );
}
