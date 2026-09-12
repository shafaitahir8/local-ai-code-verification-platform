import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  StatusBadge,
} from '@verify/ui';

import type {
  DiscoveryResult,
  InspectionResult,
  ProfilePhase,
  ProjectProfile,
  ProjectProfileProgress,
} from '../dashboard/types.js';
import { BranchIcon, RefreshIcon, StopIcon } from './icons.js';

export interface ProjectOverviewProps {
  readonly discovery: DiscoveryResult;
  readonly inspection: InspectionResult;
  readonly profile?: ProjectProfile;
  readonly profilePhase: ProfilePhase;
  readonly profileProgress?: ProjectProfileProgress;
  readonly profileError?: string;
  readonly onRefresh: () => void;
  readonly onStop: () => void;
}

function confidenceStatus(confidence: ProjectProfile['capabilities'][number]['confidence']) {
  return confidence === 'tentative' ? ('warning' as const) : ('ready' as const);
}

function legacySignals(discovery: DiscoveryResult): readonly string[] {
  return [
    discovery.projectTypes.includes('node') ? 'Node.js' : undefined,
    discovery.projectTypes.includes('typescript') ? 'TypeScript' : undefined,
    discovery.projectTypes.includes('python') ? 'Python' : undefined,
    discovery.projectTypes.includes('vite') ? 'Vite' : undefined,
    discovery.node?.packageManager,
  ].filter((signal): signal is string => Boolean(signal));
}

function profileStatusDescription(
  phase: ProfilePhase,
  profile: ProjectProfile | undefined,
  progress: ProjectProfileProgress | undefined,
): string {
  if (phase === 'running') {
    return progress?.message ?? 'Scanning repository metadata.';
  }
  if (phase === 'cancelling') {
    return 'Waiting for the deterministic project scan to stop.';
  }
  if (phase === 'cancelled') {
    return profile
      ? 'Refresh cancelled; the last completed profile remains displayed.'
      : 'Scan cancelled before a project profile was produced.';
  }
  if (phase === 'error') {
    return profile
      ? 'Refresh failed; the last completed profile remains displayed.'
      : 'Project profiling is unavailable; existing repository controls remain usable.';
  }
  if (profile?.completeness === 'partial') {
    const limitation =
      profile.scan.limitsReached.length > 0
        ? 'A scan budget was reached'
        : 'One or more scan warnings affected coverage';
    return `${profile.scan.entriesScanned.toLocaleString()} entries inspected. ${limitation}, so evidence may be incomplete. No project commands were run.`;
  }
  if (profile) {
    return `${profile.scan.entriesScanned.toLocaleString()} entries inspected. No project commands were run.`;
  }
  return 'Deterministic repository evidence only; no discovered command is executed.';
}

export function ProjectOverview({
  discovery,
  inspection,
  profile,
  profileError,
  profilePhase,
  profileProgress,
  onRefresh,
  onStop,
}: ProjectOverviewProps) {
  const profiling = profilePhase === 'running' || profilePhase === 'cancelling';
  const signals = legacySignals(discovery);

  return (
    <Card aria-labelledby="project-overview-title" aria-busy={profiling}>
      <CardHeader>
        <div>
          <p className="eyebrow">Detected project</p>
          <CardTitle id="project-overview-title">
            {profile?.displayName ?? discovery.projectName}
          </CardTitle>
          <CardDescription className="path-text">
            {profile?.repositoryRoot ?? discovery.repositoryRoot}
          </CardDescription>
        </div>
        <div className="project-overview__header-actions">
          <span className="branch-chip">
            <BranchIcon />
            <span>{inspection.branch || 'Detached HEAD'}</span>
          </span>
          {profiling ? (
            <Button
              variant="danger"
              compact
              onClick={onStop}
              disabled={profilePhase === 'cancelling'}
            >
              <StopIcon className="button-icon" />
              {profilePhase === 'cancelling' ? 'Stopping scan...' : 'Stop project scan'}
            </Button>
          ) : (
            <Button variant="secondary" compact onClick={onRefresh}>
              <RefreshIcon className="button-icon" />
              Understand Project
            </Button>
          )}
        </div>
      </CardHeader>

      <div className="profile-status" aria-live="polite">
        {profilePhase === 'running' ? <Spinner /> : null}
        <StatusBadge
          status={
            profilePhase === 'running' || profilePhase === 'cancelling'
              ? 'running'
              : profilePhase === 'cancelled'
                ? 'cancelled'
                : profilePhase === 'error'
                  ? 'error'
                  : profile?.completeness === 'partial'
                    ? 'warning'
                    : profile
                      ? 'ready'
                      : 'unknown'
          }
          label={
            profilePhase === 'running'
              ? 'Scanning'
              : profilePhase === 'cancelling'
                ? 'Stopping'
                : profilePhase === 'cancelled'
                  ? 'Scan stopped'
                  : profilePhase === 'error'
                    ? 'Scan unavailable'
                    : profile?.completeness === 'partial'
                      ? 'Partial profile'
                      : profile
                        ? 'Profile ready'
                        : 'Not scanned'
          }
        />
        <span className="muted-text">
          {profileStatusDescription(profilePhase, profile, profileProgress)}
        </span>
      </div>

      {profiling && profileProgress ? (
        <div className="profile-progress">
          <progress
            aria-label="Project sensors completed"
            max={Math.max(profileProgress.sensorCount, 1)}
            value={profileProgress.sensorsCompleted}
          />
          <span>
            {profileProgress.sensorCount === 0
              ? 'Repository inventory in progress'
              : `${profileProgress.sensorsCompleted} of ${profileProgress.sensorCount} sensors`}
            ; {profileProgress.entriesScanned.toLocaleString()} entries;{' '}
            {profileProgress.bytesRead.toLocaleString()} bytes read
          </span>
        </div>
      ) : null}

      {profileError ? (
        <p className="profile-notice profile-notice--error">
          <strong>Project profile could not be refreshed.</strong> {profileError}
        </p>
      ) : null}

      {profile ? (
        <div className="profile-details">
          <div className="profile-section">
            <h3>Deterministic facts</h3>
            {profile.capabilities.length > 0 ? (
              <ul className="profile-capabilities" aria-label="Detected project capabilities">
                {profile.capabilities.map((capability) => (
                  <li key={capability.id}>
                    <div>
                      <strong>{capability.name}</strong>
                      <span>{capability.kind.replaceAll('-', ' ')}</span>
                    </div>
                    <StatusBadge
                      status={confidenceStatus(capability.confidence)}
                      label={capability.confidence}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-text">No evidence-backed project capabilities were found.</p>
            )}
          </div>

          <div className="profile-section">
            <h3>Observed command candidates</h3>
            {profile.taskCandidates.length > 0 ? (
              <ul className="profile-tasks" aria-label="Observed project scripts">
                {profile.taskCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <div>
                      <strong>{candidate.label}</strong>
                      <code>{candidate.command}</code>
                    </div>
                    <span>
                      {candidate.kind} - {candidate.confidence}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-text">No evidence-backed scripts were found.</p>
            )}
            <p className="profile-boundary">
              Evidence only - these commands were not run and cannot be started from this view.
            </p>
          </div>

          {profile.ambiguities.length > 0 ? (
            <div className="profile-section profile-notice" aria-labelledby="profile-ambiguities">
              <h3 id="profile-ambiguities">Ambiguities</h3>
              <ul>
                {profile.ambiguities.map((ambiguity) => (
                  <li key={ambiguity.code}>{ambiguity.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {profile.warnings.length > 0 ? (
            <div
              className="profile-section profile-notice profile-notice--warning"
              aria-labelledby="profile-warnings"
            >
              <h3 id="profile-warnings">Scan warnings</h3>
              <ul>
                {profile.warnings.map((warning) => (
                  <li key={`${warning.code}:${warning.sensorId ?? ''}:${warning.path ?? ''}`}>
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <details className="profile-evidence">
            <summary>Deterministic evidence ({profile.evidence.length})</summary>
            <ul>
              {profile.evidence.map((item) => (
                <li key={item.id}>
                  <strong>{item.summary}</strong>
                  <span>
                    {item.kind} - <code>{item.path}</code>
                    {item.pointer ? ` - ${item.pointer.join('.')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <>
          <div className="signal-list" aria-label="Legacy detected technology signals">
            {signals.length > 0 ? (
              signals.map((signal) => <StatusBadge key={signal} status="ready" label={signal} />)
            ) : (
              <span className="muted-text">No framework signals detected</span>
            )}
          </div>
          <p className="supporting-copy">
            {discovery.markers.length} project signal files found and{' '}
            {Object.keys(discovery.node?.scripts ?? {}).length} package scripts recognized by legacy
            discovery.
          </p>
        </>
      )}
    </Card>
  );
}
