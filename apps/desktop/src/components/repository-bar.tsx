import { forwardRef, type FormEvent, type Ref } from 'react';

import { Button, Spinner } from '@verify/ui';

import { FolderIcon, RefreshIcon } from './icons.js';

export interface RepositoryBarProps {
  readonly path: string;
  readonly busy: boolean;
  readonly hasProject: boolean;
  readonly onPathChange: (path: string) => void;
  readonly onBrowse: () => void;
  readonly onOpen: (path: string) => void;
}

export const RepositoryBar = forwardRef(function RepositoryBar(
  { busy, hasProject, onBrowse, onOpen, onPathChange, path }: RepositoryBarProps,
  browseButtonRef: Ref<HTMLButtonElement>,
) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onOpen(path);
  };

  return (
    <form className="repository-bar" onSubmit={submit} aria-label="Open repository">
      <label className="repository-field">
        <span className="verify-sr-only">Repository path</span>
        <FolderIcon className="repository-field__icon" />
        <input
          value={path}
          onChange={(event) => onPathChange(event.currentTarget.value)}
          placeholder="Select or enter a local Git repository path"
          autoComplete="off"
          spellCheck="false"
          aria-describedby="repository-path-help"
        />
      </label>
      <span id="repository-path-help" className="verify-sr-only">
        Enter a path manually when the native folder dialog is unavailable.
      </span>
      <Button
        ref={browseButtonRef}
        onClick={onBrowse}
        disabled={busy}
        aria-keyshortcuts="Control+O Meta+O"
      >
        Browse…
      </Button>
      <Button type="submit" variant="primary" disabled={busy || path.trim().length === 0}>
        {busy ? <Spinner /> : hasProject ? <RefreshIcon className="button-icon" /> : null}
        {hasProject ? 'Inspect again' : 'Open project'}
      </Button>
    </form>
  );
});
