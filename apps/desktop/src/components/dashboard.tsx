import type { DashboardController } from '../dashboard/use-dashboard.js';
import { ChangePanel } from './change-panel.js';
import { ChecksPanel } from './checks-panel.js';
import { GateHero } from './gate-hero.js';
import { HistoryPanel } from './history-panel.js';
import { ProjectOverview } from './project-overview.js';
import { RunPanel } from './run-panel.js';

export function Dashboard({ controller }: { readonly controller: DashboardController }) {
  const { config, discovery, inspection } = controller;

  if (!config || !discovery || !inspection) {
    return null;
  }

  return (
    <div className="dashboard-grid">
      <div className="dashboard-grid__hero">
        <GateHero
          run={controller.displayedRun}
          latestGate={controller.latestGate}
          runPhase={controller.runPhase}
          viewingHistory={Boolean(controller.selectedHistoryId)}
        />
      </div>
      <div className="dashboard-grid__wide">
        <ProjectOverview
          discovery={discovery}
          inspection={inspection}
          profile={controller.profile}
          profilePhase={controller.profilePhase}
          profileProgress={controller.profileProgress}
          profileError={controller.profileError}
          onRefresh={() => void controller.understandProject()}
          onStop={controller.stopProjectProfile}
        />
      </div>
      <ChangePanel inspection={inspection} />
      <div className="dashboard-grid__wide">
        <ChecksPanel
          config={config}
          discovery={discovery}
          liveChecks={controller.liveChecks}
          initializing={false}
          onInitialize={() => void controller.initializeProject()}
        />
      </div>
      <div className="dashboard-grid__wide">
        <RunPanel
          configured={config.exists}
          output={controller.output}
          run={controller.displayedRun}
          runPhase={controller.runPhase}
          viewingHistory={Boolean(controller.selectedHistoryId)}
          onRun={() => void controller.runVerification()}
          onStop={controller.stopVerification}
        />
      </div>
      <div className="dashboard-grid__wide">
        <HistoryPanel
          runs={controller.history}
          selectedRunId={controller.selectedHistoryId}
          onSelect={controller.selectHistoryRun}
        />
      </div>
    </div>
  );
}
