import { Card, CardDescription, CardHeader, CardTitle, StatusBadge } from '@verify/ui';

import type { DiscoveryResult, InspectionResult } from '../dashboard/types.js';
import { BranchIcon } from './icons.js';

export interface ProjectOverviewProps {
  readonly discovery: DiscoveryResult;
  readonly inspection: InspectionResult;
}

export function ProjectOverview({ discovery, inspection }: ProjectOverviewProps) {
  const signals = [
    discovery.projectTypes.includes('node') ? 'Node.js' : undefined,
    discovery.projectTypes.includes('typescript') ? 'TypeScript' : undefined,
    discovery.projectTypes.includes('python') ? 'Python' : undefined,
    discovery.projectTypes.includes('vite') ? 'Vite' : undefined,
    discovery.node?.packageManager,
  ].filter((signal): signal is string => Boolean(signal));

  return (
    <Card aria-labelledby="project-overview-title">
      <CardHeader>
        <div>
          <p className="eyebrow">Detected project</p>
          <CardTitle id="project-overview-title">{discovery.projectName}</CardTitle>
          <CardDescription className="path-text">{discovery.repositoryRoot}</CardDescription>
        </div>
        <span className="branch-chip">
          <BranchIcon />
          <span>{inspection.branch || 'Detached HEAD'}</span>
        </span>
      </CardHeader>
      <div className="signal-list" aria-label="Detected technology signals">
        {signals.length > 0 ? (
          signals.map((signal) => <StatusBadge key={signal} status="ready" label={signal} />)
        ) : (
          <span className="muted-text">No framework signals detected</span>
        )}
      </div>
      <p className="supporting-copy">
        {discovery.markers.length} project signal files found and{' '}
        {Object.keys(discovery.node?.scripts ?? {}).length} package scripts recognized.
      </p>
    </Card>
  );
}
