import {
  discoverProject,
  getProjectConfigPath,
  initializeProjectConfig,
  loadProjectConfig,
  previewProjectConfig,
  projectConfigExists,
} from '@verify/config';
import { VerifierApplication } from '@verify/core';
import { GenericCommandAdapter } from '@verify/adapter-generic-command';
import { GitRepositoryService } from '@verify/repository';
import { createSqliteRunRepository } from '@verify/storage';
import { VerificationRunner } from '@verify/verification';
import type { SqliteNativeBinding } from '@verify/storage';

export interface ApplicationComposition {
  readonly application: VerifierApplication;
  close(): void;
}

export interface ApplicationCompositionOptions {
  /** Preloaded better-sqlite3 addon supplied by the self-contained executable bootstrap. */
  readonly sqliteNativeBinding?: SqliteNativeBinding;
}

export function createApplicationComposition(
  options: ApplicationCompositionOptions = {},
): ApplicationComposition {
  const git = new GitRepositoryService();
  const runRepository = createSqliteRunRepository({ nativeBinding: options.sqliteNativeBinding });
  const verification = new VerificationRunner(new GenericCommandAdapter());

  const application = new VerifierApplication({
    configuration: {
      exists: projectConfigExists,
      load: loadProjectConfig,
      preview: previewProjectConfig,
      discover: discoverProject,
      initialize: initializeProjectConfig,
      path: getProjectConfigPath,
    },
    repository: {
      resolveRoot: (startPath) => git.discoverRoot(startPath),
      inspect: (startPath) => git.inspect(startPath),
    },
    verification,
    runs: runRepository,
  });

  return {
    application,
    close: () => runRepository.close(),
  };
}
