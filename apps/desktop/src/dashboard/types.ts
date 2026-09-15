import type { ProtocolEventMessage, ProtocolResultMap } from '@verify/protocol';

export type DiscoveryResult = ProtocolResultMap['project.discover'];
export type ProjectProfileResult = ProtocolResultMap['project.profile'];
export type ProjectProfile = Extract<ProjectProfileResult, { status: 'completed' }>['profile'];
export type VerificationPlanResult = ProtocolResultMap['verification.plan'];
export type VerificationPlanPreview = Extract<
  VerificationPlanResult,
  { status: 'completed' }
>['preview'];
export type VerificationPlan =
  VerificationPlanPreview['plans'][keyof VerificationPlanPreview['plans']];
export type ProjectProfileProgress = Extract<
  ProtocolEventMessage,
  { event: 'profile.progress' }
>['data'];
export type ConfigResult = ProtocolResultMap['config.get'];
export type InspectionResult = ProtocolResultMap['repository.inspect'];
export type VerificationRun = ProtocolResultMap['verification.run'];
export type LatestGateResult = ProtocolResultMap['gate.latest'];
export type RunsResult = ProtocolResultMap['runs.list'];
export type VerificationCheckResult = VerificationRun['checks'][number];
export type VerificationCheck = Extract<
  ProtocolEventMessage,
  { event: 'check.started' }
>['data']['check'];

export interface LiveCheck {
  readonly check: VerificationCheck;
  readonly status: 'running' | VerificationCheckResult['status'];
  readonly result?: VerificationCheckResult;
}

export type LoadPhase = 'empty' | 'loading' | 'ready' | 'error';
export type RunPhase = 'idle' | 'running' | 'cancelling' | 'completed' | 'error';
export type ProfilePhase = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'error';
