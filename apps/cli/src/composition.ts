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

export interface ApplicationComposition {
  readonly application: VerifierApplication;
  close(): void;
}

export function createApplicationComposition(): ApplicationComposition {
  const git = new GitRepositoryService();
  const runRepository = createSqliteRunRepository();
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
