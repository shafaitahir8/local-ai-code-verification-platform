import type {
  ProjectProfile,
  ProjectProfileCompleteness,
  ProjectProfileConfidence,
  ProjectTaskKind,
} from './project-profile.js';

export const VERIFICATION_PLAN_VERSION = 1 as const;

export const VERIFICATION_PLAN_MODES = ['quick', 'full'] as const;
export type VerificationPlanMode = (typeof VERIFICATION_PLAN_MODES)[number];

export const VERIFICATION_PLAN_STATUSES = ['ready', 'unavailable'] as const;
export type VerificationPlanStatus = (typeof VERIFICATION_PLAN_STATUSES)[number];

export const VERIFICATION_PLAN_RECOMMENDATION_SOURCES = ['deterministic-project-profile'] as const;
export type VerificationPlanRecommendationSource =
  (typeof VERIFICATION_PLAN_RECOMMENDATION_SOURCES)[number];

export const VERIFICATION_PLAN_CHECK_KINDS = ['test', 'lint', 'typecheck', 'build'] as const;
export type VerificationPlanCheckKind = Extract<
  ProjectTaskKind,
  (typeof VERIFICATION_PLAN_CHECK_KINDS)[number]
>;

export interface VerificationPlanCheckDecision {
  readonly taskCandidateId: string;
  readonly kind: VerificationPlanCheckKind;
  readonly label: string;
  readonly command: string;
  readonly workingDirectory: string;
  readonly workspaceId?: string;
  readonly confidence: ProjectProfileConfidence;
  readonly capabilityIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export interface VerificationPlan<Mode extends VerificationPlanMode = VerificationPlanMode> {
  readonly planVersion: typeof VERIFICATION_PLAN_VERSION;
  readonly mode: Mode;
  readonly status: VerificationPlanStatus;
  readonly statusReason: string;
  readonly repositoryRoot: string;
  readonly profileVersion: ProjectProfile['profileVersion'];
  readonly profileGeneratedAt: string;
  readonly profileCompleteness: ProjectProfileCompleteness;
  readonly recommendationSource: VerificationPlanRecommendationSource;
  readonly selectedChecks: readonly VerificationPlanCheckDecision[];
  readonly skippedChecks: readonly VerificationPlanCheckDecision[];
}

export interface VerificationPlanPreview {
  readonly profile: ProjectProfile;
  readonly plans: {
    readonly quick: VerificationPlan<'quick'>;
    readonly full: VerificationPlan<'full'>;
  };
}

export type VerificationPlanPreviewResult =
  | { readonly status: 'completed'; readonly preview: VerificationPlanPreview }
  | { readonly status: 'cancelled' };
