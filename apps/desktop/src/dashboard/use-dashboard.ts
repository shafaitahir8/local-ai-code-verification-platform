import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EngineRequestError, type EngineClient } from '../engine/index.js';
import type {
  ConfigResult,
  DiscoveryResult,
  InspectionResult,
  LatestGateResult,
  LiveCheck,
  LoadPhase,
  MigrationPhase,
  MigrationPreview,
  ProfilePhase,
  ProjectProfile,
  ProjectProfileProgress,
  RunsResult,
  RunPhase,
  VerificationPlanPreview,
  VerificationRun,
} from './types.js';

const MAX_VISIBLE_LOG_CHARACTERS = 200_000;

function errorMessage(error: unknown): string {
  if (error instanceof EngineRequestError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'An unknown desktop error occurred.';
}

export interface DashboardController {
  readonly repository: string;
  readonly loadPhase: LoadPhase;
  readonly runPhase: RunPhase;
  readonly profilePhase: ProfilePhase;
  readonly discovery?: DiscoveryResult;
  readonly profile?: ProjectProfile;
  readonly planPreview?: VerificationPlanPreview;
  readonly profileProgress?: ProjectProfileProgress;
  readonly profileError?: string;
  readonly config?: ConfigResult;
  readonly migrationPreview?: MigrationPreview;
  readonly migrationPhase: MigrationPhase;
  readonly migrationError?: string;
  readonly inspection?: InspectionResult;
  readonly latestGate?: LatestGateResult;
  readonly history: RunsResult['runs'];
  readonly activeRun?: VerificationRun;
  readonly displayedRun?: VerificationRun;
  readonly selectedHistoryId?: string;
  readonly liveChecks: readonly LiveCheck[];
  readonly output: string;
  readonly liveAnnouncement: string;
  readonly error?: string;
  readonly openRepository: (repository: string) => Promise<void>;
  readonly understandProject: () => Promise<void>;
  readonly stopProjectProfile: () => void;
  readonly initializeProject: () => Promise<void>;
  readonly previewMigration: () => Promise<void>;
  readonly applyMigration: () => Promise<void>;
  readonly runVerification: () => Promise<void>;
  readonly stopVerification: () => void;
  readonly selectHistoryRun: (runId?: string) => void;
}

export function useDashboard(
  client: EngineClient,
  initialRepository?: string,
): DashboardController {
  const [repository, setRepository] = useState('');
  const [loadPhase, setLoadPhase] = useState<LoadPhase>('empty');
  const [runPhase, setRunPhase] = useState<RunPhase>('idle');
  const [profilePhase, setProfilePhase] = useState<ProfilePhase>('idle');
  const [discovery, setDiscovery] = useState<DiscoveryResult>();
  const [planPreview, setPlanPreview] = useState<VerificationPlanPreview>();
  const [profileProgress, setProfileProgress] = useState<ProjectProfileProgress>();
  const [profileError, setProfileError] = useState<string>();
  const [config, setConfig] = useState<ConfigResult>();
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview>();
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('idle');
  const [migrationError, setMigrationError] = useState<string>();
  const [inspection, setInspection] = useState<InspectionResult>();
  const [latestGate, setLatestGate] = useState<LatestGateResult>();
  const [history, setHistory] = useState<RunsResult['runs']>([]);
  const [activeRun, setActiveRun] = useState<VerificationRun>();
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
  const [liveChecks, setLiveChecks] = useState<readonly LiveCheck[]>([]);
  const [output, setOutput] = useState('');
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [error, setError] = useState<string>();
  const loadGeneration = useRef(0);
  const migrationGeneration = useRef(0);
  const runController = useRef<AbortController | undefined>(undefined);
  const profileController = useRef<AbortController | undefined>(undefined);
  const currentRepository = useRef('');
  const initialRepositoryOpened = useRef(false);
  const profile = planPreview?.profile;

  const requestProjectPlanPreview = useCallback(
    async (selectedRepository: string, generation: number) => {
      const controller = new AbortController();
      profileController.current?.abort();
      profileController.current = controller;
      setProfilePhase('running');
      setProfileProgress(undefined);
      setProfileError(undefined);
      setLiveAnnouncement(`Understanding ${selectedRepository}.`);

      try {
        const result = await client.request(
          'verification.plan',
          { repository: selectedRepository },
          {
            signal: controller.signal,
            onEvent: (event) => {
              if (
                event.event !== 'profile.progress' ||
                generation !== loadGeneration.current ||
                profileController.current !== controller
              ) {
                return;
              }
              setProfileProgress(event.data);
              setLiveAnnouncement(event.data.message);
            },
          },
        );

        if (generation !== loadGeneration.current || profileController.current !== controller) {
          return;
        }

        if (result.status === 'cancelled') {
          setProfilePhase('cancelled');
          setLiveAnnouncement(
            'Project scan stopped. The last completed profile and plan preview are unchanged.',
          );
          return;
        }

        setPlanPreview(result.preview);
        setProfilePhase('completed');
        setLiveAnnouncement(
          result.preview.profile.completeness === 'partial'
            ? `${result.preview.profile.displayName} was understood with partial coverage; deterministic plan recommendations may be unavailable.`
            : `${result.preview.profile.displayName} project profile and verification plan preview are ready.`,
        );
      } catch (profileRequestError) {
        if (generation !== loadGeneration.current || profileController.current !== controller) {
          return;
        }

        setProfilePhase('error');
        setProfileError(errorMessage(profileRequestError));
        setLiveAnnouncement(
          controller.signal.aborted
            ? 'Project scan interruption was not confirmed. The last completed profile is unchanged.'
            : 'Project profiling failed. Existing repository details remain usable.',
        );
      } finally {
        if (profileController.current === controller) {
          profileController.current = undefined;
        }
      }
    },
    [client],
  );

  const openRepository = useCallback(
    async (nextRepository: string) => {
      const selectedRepository = nextRepository.trim();
      if (!selectedRepository) {
        setError('Enter or select a repository path.');
        setLoadPhase('error');
        return;
      }

      const generation = loadGeneration.current + 1;
      loadGeneration.current = generation;
      migrationGeneration.current += 1;
      runController.current?.abort();
      profileController.current?.abort();
      const repositoryChanged = currentRepository.current !== selectedRepository;
      currentRepository.current = selectedRepository;
      if (repositoryChanged) {
        setPlanPreview(undefined);
      }
      setRepository(selectedRepository);
      setConfig(undefined);
      setMigrationPreview(undefined);
      setMigrationPhase('idle');
      setMigrationError(undefined);
      setLoadPhase('loading');
      setRunPhase('idle');
      setProfilePhase('idle');
      setProfileProgress(undefined);
      setProfileError(undefined);
      setError(undefined);
      setSelectedHistoryId(undefined);
      setActiveRun(undefined);
      setLiveChecks([]);
      setOutput('');
      setLiveAnnouncement(`Loading ${selectedRepository}.`);

      try {
        const [nextDiscovery, nextConfig, nextInspection, nextGate, nextHistory] =
          await Promise.all([
            client.request('project.discover', { repository: selectedRepository }),
            client.request('config.policy.get', { repository: selectedRepository }),
            client.request('repository.inspect', { repository: selectedRepository }),
            client.request('gate.latest', { repository: selectedRepository }),
            client.request('runs.list', { repository: selectedRepository, limit: 10 }),
          ]);

        if (generation !== loadGeneration.current) {
          return;
        }

        setDiscovery(nextDiscovery);
        setConfig(nextConfig);
        setInspection(nextInspection);
        setLatestGate(nextGate);
        setHistory(nextHistory.runs);
        setLoadPhase('ready');
        setLiveAnnouncement(`${nextDiscovery.projectName} is ready.`);
        void requestProjectPlanPreview(selectedRepository, generation);
      } catch (loadError) {
        if (generation !== loadGeneration.current) {
          return;
        }
        setError(errorMessage(loadError));
        setLoadPhase('error');
        setLiveAnnouncement('Repository loading failed.');
      }
    },
    [client, requestProjectPlanPreview],
  );

  const understandProject = useCallback(async () => {
    if (!repository || loadPhase !== 'ready') {
      return;
    }
    await requestProjectPlanPreview(repository, loadGeneration.current);
  }, [loadPhase, repository, requestProjectPlanPreview]);

  const stopProjectProfile = useCallback(() => {
    const controller = profileController.current;
    if (controller === undefined || controller.signal.aborted) {
      return;
    }
    setProfilePhase('cancelling');
    setLiveAnnouncement('Stopping the project scan.');
    controller.abort();
  }, []);

  useEffect(() => {
    if (!initialRepository || initialRepositoryOpened.current) {
      return;
    }
    initialRepositoryOpened.current = true;
    void openRepository(initialRepository);
  }, [initialRepository, openRepository]);

  useEffect(
    () => () => {
      loadGeneration.current += 1;
      runController.current?.abort();
      profileController.current?.abort();
    },
    [],
  );

  const initializeProject = useCallback(async () => {
    if (!repository) {
      return;
    }

    setError(undefined);
    setLiveAnnouncement('Initializing project configuration.');
    try {
      const initialized = await client.request('config.init', { repository });
      const nextPolicy = await client.request('config.policy.get', { repository });
      setConfig(nextPolicy);
      setMigrationPreview(undefined);
      setMigrationPhase('idle');
      setLiveAnnouncement(
        initialized.overwritten
          ? 'Project configuration replaced.'
          : 'Project configuration created.',
      );
    } catch (initializationError) {
      setError(errorMessage(initializationError));
      setLiveAnnouncement('Project initialization failed.');
    }
  }, [client, repository]);

  const previewMigration = useCallback(async () => {
    if (!repository || config?.config?.version !== 1) {
      return;
    }

    const selectedRepository = repository;
    const repositoryGeneration = loadGeneration.current;
    const operationGeneration = migrationGeneration.current + 1;
    migrationGeneration.current = operationGeneration;
    setMigrationPreview(undefined);
    setMigrationPhase('previewing');
    setMigrationError(undefined);
    setLiveAnnouncement('Preparing a reviewable configuration migration preview.');

    try {
      const preview = await client.request('config.migrate.preview', {
        repository: selectedRepository,
      });
      if (
        repositoryGeneration !== loadGeneration.current ||
        operationGeneration !== migrationGeneration.current
      ) {
        return;
      }
      setMigrationPreview(preview);
      setMigrationPhase('ready');
      setLiveAnnouncement('Migration preview is ready. Nothing has been changed.');
    } catch (migrationRequestError) {
      if (
        repositoryGeneration !== loadGeneration.current ||
        operationGeneration !== migrationGeneration.current
      ) {
        return;
      }
      setMigrationPhase('error');
      setMigrationError(errorMessage(migrationRequestError));
      setLiveAnnouncement('Migration preview failed. Project configuration is unchanged.');
    }
  }, [client, config?.config?.version, repository]);

  const applyMigration = useCallback(async () => {
    if (!repository || !migrationPreview || config?.config?.version !== 1) {
      return;
    }

    const selectedRepository = repository;
    const reviewedPreview = migrationPreview;
    const repositoryGeneration = loadGeneration.current;
    const operationGeneration = migrationGeneration.current + 1;
    migrationGeneration.current = operationGeneration;
    setMigrationPhase('applying');
    setMigrationError(undefined);
    setLiveAnnouncement('Applying the reviewed migration after checking the source revision.');

    try {
      await client.request('config.migrate.apply', {
        repository: selectedRepository,
        expectedSourceDigest: reviewedPreview.sourceDigest,
        expectedTargetDigest: reviewedPreview.targetDigest,
      });
      if (
        repositoryGeneration !== loadGeneration.current ||
        operationGeneration !== migrationGeneration.current
      ) {
        return;
      }
      setMigrationPreview(undefined);
      setMigrationPhase('applied');
      setLiveAnnouncement('Configuration migration applied. Commands were not approved or run.');

      try {
        const nextPolicy = await client.request('config.policy.get', {
          repository: selectedRepository,
        });
        if (
          repositoryGeneration !== loadGeneration.current ||
          operationGeneration !== migrationGeneration.current
        ) {
          return;
        }
        setConfig(nextPolicy);
      } catch (refreshError) {
        if (
          repositoryGeneration !== loadGeneration.current ||
          operationGeneration !== migrationGeneration.current
        ) {
          return;
        }
        setMigrationError(
          `Migration was applied, but the policy view could not be refreshed: ${errorMessage(refreshError)}`,
        );
      }
    } catch (migrationRequestError) {
      if (
        repositoryGeneration !== loadGeneration.current ||
        operationGeneration !== migrationGeneration.current
      ) {
        return;
      }
      setMigrationPreview(undefined);
      if (
        migrationRequestError instanceof EngineRequestError &&
        migrationRequestError.code === 'MIGRATION_STALE'
      ) {
        setMigrationPhase('stale');
        setLiveAnnouncement(
          'The migration preview is stale. Nothing was overwritten; review the current policy again.',
        );
      } else {
        setMigrationPhase('error');
        setMigrationError(errorMessage(migrationRequestError));
        setLiveAnnouncement('Migration apply failed. No command was run.');
      }
    }
  }, [client, config?.config?.version, migrationPreview, repository]);

  const runVerification = useCallback(async () => {
    if (!repository || !config?.exists) {
      return;
    }

    const controller = new AbortController();
    const generation = loadGeneration.current;
    const selectedRepository = repository;
    runController.current?.abort();
    runController.current = controller;
    setRunPhase('running');
    setError(undefined);
    setSelectedHistoryId(undefined);
    setLiveChecks([]);
    setOutput('');
    setLiveAnnouncement('Verification started.');

    try {
      const run = await client.request(
        'verification.run',
        { repository },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (generation !== loadGeneration.current || runController.current !== controller) {
              return;
            }
            switch (event.event) {
              case 'check.started':
                setLiveChecks((current) => [
                  ...current.filter((item) => item.check.id !== event.data.check.id),
                  { check: event.data.check, status: 'running' },
                ]);
                setLiveAnnouncement(`${event.data.check.name} started.`);
                break;

              case 'check.output':
                setOutput((current) => {
                  const prefix = event.data.stream === 'stderr' ? '[stderr] ' : '';
                  return `${current}${prefix}${event.data.chunk}`.slice(
                    -MAX_VISIBLE_LOG_CHARACTERS,
                  );
                });
                break;

              case 'check.completed':
                setLiveChecks((current) => [
                  ...current.filter((item) => item.check.id !== event.data.result.id),
                  {
                    check: {
                      id: event.data.result.id,
                      name: event.data.result.name,
                      type: event.data.result.type,
                      command: event.data.result.command ?? event.data.result.name,
                      failurePolicy: event.data.result.failurePolicy,
                    },
                    status: event.data.result.status,
                    result: event.data.result,
                  },
                ]);
                setLiveAnnouncement(
                  `${event.data.result.name} completed with status ${event.data.result.status}.`,
                );
                break;

              case 'run.completed':
                setActiveRun(event.data.run);
                break;
            }
          },
        },
      );

      if (generation !== loadGeneration.current || runController.current !== controller) {
        return;
      }

      setActiveRun(run);
      setRunPhase('completed');
      setLiveAnnouncement(
        run.status === 'cancelled'
          ? 'Verification interrupted and saved.'
          : `Verification completed. Quality gate ${run.gate?.status ?? 'unavailable'}.`,
      );

      const [nextGate, nextHistory] = await Promise.all([
        client.request('gate.latest', { repository: selectedRepository }),
        client.request('runs.list', { repository: selectedRepository, limit: 10 }),
      ]);
      if (generation !== loadGeneration.current || runController.current !== controller) {
        return;
      }
      setLatestGate(nextGate);
      setHistory(nextHistory.runs);
    } catch (runError) {
      if (generation !== loadGeneration.current || runController.current !== controller) {
        return;
      }
      setRunPhase('error');
      setError(errorMessage(runError));
      setLiveAnnouncement(
        controller.signal.aborted ? 'Verification interrupted.' : 'Verification failed to execute.',
      );
    } finally {
      if (runController.current === controller) {
        runController.current = undefined;
      }
    }
  }, [client, config?.exists, repository]);

  const stopVerification = useCallback(() => {
    const controller = runController.current;
    if (controller === undefined || controller.signal.aborted) {
      return;
    }
    setRunPhase('cancelling');
    setLiveAnnouncement('Stopping verification and saving interrupted evidence.');
    controller.abort();
  }, []);

  const selectHistoryRun = useCallback((runId?: string) => {
    setSelectedHistoryId(runId);
  }, []);

  const displayedRun = useMemo(() => {
    if (selectedHistoryId) {
      return history.find((run) => run.id === selectedHistoryId);
    }
    return activeRun ?? history.at(0);
  }, [activeRun, history, selectedHistoryId]);

  return {
    repository,
    loadPhase,
    runPhase,
    profilePhase,
    discovery,
    profile,
    planPreview,
    profileProgress,
    profileError,
    config,
    migrationPreview,
    migrationPhase,
    migrationError,
    inspection,
    latestGate,
    history,
    activeRun,
    displayedRun,
    selectedHistoryId,
    liveChecks,
    output,
    liveAnnouncement,
    error,
    openRepository,
    understandProject,
    stopProjectProfile,
    initializeProject,
    previewMigration,
    applyMigration,
    runVerification,
    stopVerification,
    selectHistoryRun,
  };
}
