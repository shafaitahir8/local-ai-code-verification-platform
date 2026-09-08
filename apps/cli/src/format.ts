import type {
  GateResult,
  RepositoryChange,
  VerificationCheckResult,
  VerificationRun,
} from '@verify/domain';

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
