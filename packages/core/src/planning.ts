import {
  VERIFICATION_PLAN_CHECK_KINDS,
  VERIFICATION_PLAN_VERSION,
  type ProjectCapability,
  type ProjectProfile,
  type ProjectTaskCandidate,
  type VerificationPlan,
  type VerificationPlanCheckDecision,
  type VerificationPlanCheckKind,
  type VerificationPlanMode,
  type VerificationPlanPreview,
} from '@verify/domain';

const KIND_ORDER = new Map(
  VERIFICATION_PLAN_CHECK_KINDS.map((kind, index) => [kind, index] as const),
);

const CAPABILITY_KIND_BY_CHECK: Readonly<
  Record<VerificationPlanCheckKind, ProjectCapability['kind']>
> = {
  test: 'test-framework',
  lint: 'linter',
  typecheck: 'typechecker',
  build: 'build-tool',
};

const QUICK_SELECTED_KINDS = new Set<VerificationPlanCheckKind>(['test', 'lint']);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isVerificationCheckKind(
  kind: ProjectTaskCandidate['kind'],
): kind is VerificationPlanCheckKind {
  return VERIFICATION_PLAN_CHECK_KINDS.includes(kind as VerificationPlanCheckKind);
}

function isVerificationTaskCandidate(
  candidate: ProjectTaskCandidate,
): candidate is ProjectTaskCandidate & { readonly kind: VerificationPlanCheckKind } {
  return isVerificationCheckKind(candidate.kind);
}

function compareCandidates(left: ProjectTaskCandidate, right: ProjectTaskCandidate): number {
  const kind =
    (KIND_ORDER.get(left.kind as VerificationPlanCheckKind) ?? Number.MAX_SAFE_INTEGER) -
    (KIND_ORDER.get(right.kind as VerificationPlanCheckKind) ?? Number.MAX_SAFE_INTEGER);
  return kind === 0 ? compareText(left.id, right.id) : kind;
}

function hasConfirmedCapability(
  profile: ProjectProfile,
  kind: ProjectCapability['kind'],
  name?: string,
): boolean {
  return profile.capabilities.some(
    (capability) =>
      capability.kind === kind &&
      capability.confidence === 'confirmed' &&
      (name === undefined || capability.name.toLowerCase() === name.toLowerCase()) &&
      hasResolvableEvidence(profile, capability.evidenceIds),
  );
}

function hasResolvableEvidence(profile: ProjectProfile, evidenceIds: readonly string[]): boolean {
  if (evidenceIds.length === 0) return false;
  return evidenceIds.every(
    (id) => profile.evidence.filter((evidence) => evidence.id === id).length === 1,
  );
}

function hasUniqueProfileIds(profile: ProjectProfile): boolean {
  return [profile.evidence, profile.capabilities, profile.taskCandidates].every(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
  );
}

function isSupportedProfile(profile: ProjectProfile): boolean {
  return (
    profile.completeness === 'complete' &&
    hasUniqueProfileIds(profile) &&
    profile.ambiguities.length === 0 &&
    profile.workspaceUnits.length === 1 &&
    profile.workspaceUnits[0]?.path === '.' &&
    hasConfirmedCapability(profile, 'runtime', 'Node.js') &&
    hasConfirmedCapability(profile, 'framework', 'Vite') &&
    hasConfirmedCapability(profile, 'test-framework', 'Vitest')
  );
}

function sourceCapabilities(
  profile: ProjectProfile,
  kind: VerificationPlanCheckKind,
): readonly ProjectCapability[] {
  return profile.capabilities
    .filter(
      (capability) =>
        capability.kind === CAPABILITY_KIND_BY_CHECK[kind] &&
        capability.confidence === 'confirmed' &&
        hasResolvableEvidence(profile, capability.evidenceIds),
    )
    .sort((left, right) => compareText(left.id, right.id));
}

function validEvidenceIds(
  profile: ProjectProfile,
  candidate: ProjectTaskCandidate,
): readonly string[] {
  return [
    ...new Set(candidate.evidenceIds.filter((id) => hasResolvableEvidence(profile, [id]))),
  ].sort(compareText);
}

function decision(
  candidate: ProjectTaskCandidate,
  capabilities: readonly ProjectCapability[],
  evidenceIds: readonly string[],
  reason: string,
): VerificationPlanCheckDecision {
  return {
    taskCandidateId: candidate.id,
    kind: candidate.kind as VerificationPlanCheckKind,
    label: candidate.label,
    command: candidate.command,
    workingDirectory: candidate.workingDirectory,
    ...(candidate.workspaceId === undefined ? {} : { workspaceId: candidate.workspaceId }),
    confidence: candidate.confidence,
    capabilityIds: capabilities.map((capability) => capability.id),
    evidenceIds,
    reason,
  };
}

function selectedReason(mode: VerificationPlanMode, kind: VerificationPlanCheckKind): string {
  return `Selected for the ${mode} plan because the profile contains one confirmed root ${kind} task and separately confirmed ${kind} capability evidence.`;
}

function skippedReason(
  profileSupported: boolean,
  mode: VerificationPlanMode,
  candidate: ProjectTaskCandidate,
  sameKindCount: number,
  hasCapabilities: boolean,
  matchingCapabilityDeclared: boolean,
  evidenceComplete: boolean,
  rootWorkspaceId: string | undefined,
): string {
  if (!profileSupported) {
    return 'Skipped because slice 6A requires a complete, unambiguous, single-root Node/Vite/Vitest profile.';
  }
  if (
    candidate.workingDirectory !== '.' ||
    (candidate.workspaceId !== undefined && candidate.workspaceId !== rootWorkspaceId)
  ) {
    return 'Skipped because slice 6A does not select a non-root workspace target.';
  }
  if (sameKindCount > 1) {
    return `Skipped because multiple credible ${candidate.kind} tasks exist and the preview does not guess a target.`;
  }
  if (candidate.confidence !== 'confirmed') {
    return `Skipped because the observed ${candidate.kind} task is ${candidate.confidence}; this preview requires confirmed task evidence.`;
  }
  if (!hasCapabilities) {
    if (matchingCapabilityDeclared) {
      return 'Skipped because matching capability evidence references are missing or ambiguous in the profile.';
    }
    return `Skipped because the profile has no matching confirmed ${CAPABILITY_KIND_BY_CHECK[candidate.kind as VerificationPlanCheckKind]} capability.`;
  }
  if (!evidenceComplete) {
    return 'Skipped because one or more source evidence references are missing from the profile.';
  }
  if (mode === 'quick' && !QUICK_SELECTED_KINDS.has(candidate.kind as VerificationPlanCheckKind)) {
    return `Skipped in Quick mode; the ${candidate.kind} task is reserved for the Full plan.`;
  }
  return 'Skipped because the task is not eligible for this deterministic preview.';
}

export function createVerificationPlan<Mode extends VerificationPlanMode>(
  profile: ProjectProfile,
  mode: Mode,
): VerificationPlan<Mode> {
  const profileSupported = isSupportedProfile(profile);
  const rootWorkspaceId = profile.workspaceUnits.find((workspace) => workspace.path === '.')?.id;
  const candidates = profile.taskCandidates.filter(isVerificationTaskCandidate);
  const reportableCandidates = candidates.filter(
    (candidate) => validEvidenceIds(profile, candidate).length > 0,
  );
  const countByKind = new Map<VerificationPlanCheckKind, number>();
  for (const candidate of candidates) {
    countByKind.set(candidate.kind, (countByKind.get(candidate.kind) ?? 0) + 1);
  }

  const selectedChecks: VerificationPlanCheckDecision[] = [];
  const skippedChecks: VerificationPlanCheckDecision[] = [];

  for (const candidate of [...reportableCandidates].sort(compareCandidates)) {
    const kind = candidate.kind;
    const capabilities = sourceCapabilities(profile, kind);
    const evidenceIds = validEvidenceIds(profile, candidate);
    const evidenceComplete = hasResolvableEvidence(profile, candidate.evidenceIds);
    const eligible =
      profileSupported &&
      candidate.workingDirectory === '.' &&
      (candidate.workspaceId === undefined || candidate.workspaceId === rootWorkspaceId) &&
      countByKind.get(kind) === 1 &&
      candidate.confidence === 'confirmed' &&
      capabilities.length > 0 &&
      evidenceComplete &&
      (mode === 'full' || QUICK_SELECTED_KINDS.has(kind));

    if (eligible) {
      selectedChecks.push(
        decision(candidate, capabilities, evidenceIds, selectedReason(mode, kind)),
      );
    } else {
      skippedChecks.push(
        decision(
          candidate,
          capabilities,
          evidenceIds,
          skippedReason(
            profileSupported,
            mode,
            candidate,
            countByKind.get(kind) ?? 0,
            capabilities.length > 0,
            profile.capabilities.some(
              (capability) =>
                capability.kind === CAPABILITY_KIND_BY_CHECK[kind] &&
                capability.confidence === 'confirmed',
            ),
            evidenceComplete,
            rootWorkspaceId,
          ),
        ),
      );
    }
  }

  return {
    planVersion: VERIFICATION_PLAN_VERSION,
    mode,
    status: selectedChecks.length > 0 ? 'ready' : 'unavailable',
    statusReason:
      selectedChecks.length > 0
        ? `${selectedChecks.length} evidence-backed check${selectedChecks.length === 1 ? '' : 's'} selected for the ${mode} preview.`
        : !profileSupported
          ? 'No checks were selected because slice 6A requires a complete, unambiguous, single-root Node/Vite/Vitest profile.'
          : candidates.length === 0
            ? 'No evidence-backed verification task candidates were available.'
            : reportableCandidates.length === 0
              ? 'No observed verification task candidate had resolvable source evidence.'
              : 'No observed task candidate met the deterministic selection rules.',
    repositoryRoot: profile.repositoryRoot,
    profileVersion: profile.profileVersion,
    profileGeneratedAt: profile.generatedAt,
    profileCompleteness: profile.completeness,
    recommendationSource: 'deterministic-project-profile',
    selectedChecks,
    skippedChecks,
  };
}

export function createVerificationPlanPreview(profile: ProjectProfile): VerificationPlanPreview {
  return {
    profile,
    plans: {
      quick: createVerificationPlan(profile, 'quick'),
      full: createVerificationPlan(profile, 'full'),
    },
  } as const;
}
