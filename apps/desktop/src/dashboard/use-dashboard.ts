import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EngineRequestError, type EngineClient } from '../engine/index.js';
import type {
  ConfigResult,
  DiscoveryResult,
  InspectionResult,
  LatestGateResult,
  LiveCheck,
  LoadPhase,
  RunsResult,
  RunPhase,
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
  readonly discovery?: DiscoveryResult;
  readonly config?: ConfigResult;
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
  readonly initializeProject: () => Promise<void>;
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
  const [discovery, setDiscovery] = useState<DiscoveryResult>();
  const [config, setConfig] = useState<ConfigResult>();
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
  const runController = useRef<AbortController | undefined>(undefined);
  const initialRepositoryOpened = useRef(false);

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
      runController.current?.abort();
      setRepository(selectedRepository);
      setLoadPhase('loading');
      setRunPhase('idle');
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
            client.request('config.get', { repository: selectedRepository }),
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
      } catch (loadError) {
        if (generation !== loadGeneration.current) {
          return;
        }
        setError(errorMessage(loadError));
        setLoadPhase('error');
        setLiveAnnouncement('Repository loading failed.');
      }
    },
    [client],
  );

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
      setConfig({ exists: true, path: initialized.path, config: initialized.config });
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
    discovery,
    config,
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
    initializeProject,
    runVerification,
    stopVerification,
    selectHistoryRun,
  };
}
