import type {
  GateResult,
  ProjectProfile,
  RepositoryChange,
  VerificationCheckResult,
  VerificationPlan,
  VerificationPlanCheckDecision,
  VerificationPlanPreview,
  VerificationRun,
} from '@verify/domain';
import type { ProtocolResultMap } from '@verify/protocol';

export function formatProjectConfigMigrationPreview(
  preview: ProtocolResultMap['config.migrate.preview'],
): string {
  return [
    'Project Policy Migration Preview (read-only)',
    `Path: ${preview.path}`,
    `Current version: ${preview.sourceVersion}`,
    `Target version: ${preview.targetVersion}`,
    `Summary: ${preview.summary}`,
    `Source digest: ${preview.sourceDigest}`,
    `Target digest: ${preview.targetDigest}`,
    '',
    'Exact YAML diff:',
    preview.diff,
    '',
    'Proposed YAML:',
    preview.targetYaml,
    '',
    'To apply this reviewed migration, run verify config migrate --apply with both digests above.',
    'Applying migration does not approve commands.',
  ].join('\n');
}

function formatPlanDecision(decision: VerificationPlanCheckDecision): string[] {
  const lines = [
    `  ${decision.kind}: ${decision.label} — ${decision.command}`,
    `    Reason: ${decision.reason}`,
    `    Source: task ${decision.taskCandidateId}; capabilities: ${decision.capabilityIds.join(', ') || 'none'}`,
    `    Evidence: ${decision.evidenceIds.join(', ') || 'none'}`,
  ];
  if (decision.workingDirectory !== '.') {
    lines.push(`    Working directory: ${decision.workingDirectory}`);
  }
  return lines;
}

function formatPlan(plan: VerificationPlan): string[] {
  const lines = [
    `${plan.mode === 'quick' ? 'Quick' : 'Full'} plan: ${plan.status.toUpperCase()}`,
    `  ${plan.statusReason}`,
  ];

  lines.push('Selected checks:');
  if (plan.selectedChecks.length === 0) lines.push('  none');
  else {
    for (const decision of plan.selectedChecks) lines.push(...formatPlanDecision(decision));
  }

  lines.push('Skipped checks:');
  if (plan.skippedChecks.length === 0) lines.push('  none');
  else {
    for (const decision of plan.skippedChecks) lines.push(...formatPlanDecision(decision));
  }

  return lines;
}

export function formatVerificationPlanPreview(preview: VerificationPlanPreview): string {
  return [
    'Verification Plan Preview (read-only)',
    `Project: ${preview.profile.displayName}`,
    `Repository: ${preview.profile.repositoryRoot}`,
    `Recommendation source: ${preview.plans.quick.recommendationSource}`,
    '',
    ...formatPlan(preview.plans.quick),
    '',
    ...formatPlan(preview.plans.full),
  ].join('\n');
}

export function formatProjectProfile(profile: ProjectProfile): string {
  const lines = [
    `Project: ${profile.displayName}`,
    `Repository: ${profile.repositoryRoot}`,
    `Profile: ${profile.completeness.toUpperCase()}`,
    `Scanned: ${profile.scan.entriesScanned} entries; ${profile.scan.bytesRead} metadata bytes`,
  ];

  if (profile.capabilities.length === 0) {
    lines.push('Detected capabilities: none');
  } else {
    lines.push('Detected capabilities:');
    for (const capability of profile.capabilities) {
      lines.push(
        `  ${capability.kind}: ${capability.name} (${capability.confidence}; evidence: ${capability.evidenceIds.join(', ')})`,
      );
    }
  }

  if (profile.workspaceUnits.length > 0) {
    lines.push('Detected workspace units:');
    for (const workspace of profile.workspaceUnits) {
      lines.push(
        `  ${workspace.name ?? workspace.id}: ${workspace.path} (evidence: ${workspace.evidenceIds.join(', ')})`,
      );
    }
  }

  if (profile.taskCandidates.length > 0) {
    lines.push('Observed task candidates (not executed or approved):');
    for (const task of profile.taskCandidates) {
      lines.push(
        `  ${task.kind}: ${task.command} (${task.confidence}; evidence: ${task.evidenceIds.join(', ')})`,
      );
    }
  }

  for (const ambiguity of profile.ambiguities) {
    lines.push(`Ambiguity [${ambiguity.code}]: ${ambiguity.message}`);
  }
  for (const warning of profile.warnings) {
    lines.push(`Warning [${warning.code}]: ${warning.message}`);
  }
  return lines.join('\n');
}

export function formatInspection(change: RepositoryChange): string {
  const branch = change.branch ?? '(detached HEAD)';
  const uncertainty = change.hasUnknownStatistics ? ' (some binary/unknown line counts)' : '';
  const lines = [
    `Repository: ${change.repositoryRoot}`,
    `Branch: ${branch}`,
    `Changed: ${change.filesChanged} files, +${change.additions} / -${change.deletions}${uncertainty}`,
    `Staged: ${change.stagedFiles}; unstaged/untracked: ${change.unstagedFiles}`,
  ];
  for (const file of change.files) {
    const state = [file.staged ? 'staged' : '', file.unstaged ? 'unstaged' : '']
      .filter(Boolean)
      .join(', ');
    lines.push(`  ${file.status.padEnd(12)} ${file.path} (${state})`);
  }
  return lines.join('\n');
}

export function formatCheckResult(result: VerificationCheckResult): string {
  const exit = result.exitCode === undefined ? '' : `, exit ${result.exitCode}`;
  return `${result.name}: ${result.status.toUpperCase()} (${result.durationMs}ms${exit})`;
}

export function formatGate(gate: GateResult): string {
  const counts = gate.summary;
  const lines = [
    `Quality Gate: ${gate.status}`,
    `${counts.passed}/${counts.total} passed; ${counts.failed} failed; ${counts.error} errors; ${counts.warning} warnings`,
  ];
  for (const reason of gate.reasons) lines.push(`  - ${reason}`);
  return lines.join('\n');
}

export function formatRun(run: VerificationRun): string {
  return [
    run.gate === undefined ? 'Quality Gate: unavailable' : formatGate(run.gate),
    `Run ID: ${run.id}`,
  ].join('\n');
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
