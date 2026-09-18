import type { DashboardController } from '../dashboard/use-dashboard.js';
import { ApprovedVerificationActions } from './approved-verification-actions.js';
import { ChangePanel } from './change-panel.js';
import { ChecksPanel } from './checks-panel.js';
import { ConfigMigrationCard } from './config-migration.js';
import { GateHero } from './gate-hero.js';
import { HistoryPanel } from './history-panel.js';
import { PolicyApprovalCard } from './policy-approval.js';
import { ProjectOverview } from './project-overview.js';
import { RunPanel } from './run-panel.js';
import { VerificationPlanPreviewCard } from './verification-plan-preview.js';

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
      <div className="dashboard-grid__wide">
        <ApprovedVerificationActions
          approval={controller.approval}
          approvalPhase={controller.approvalPhase}
          runPhase={controller.runPhase}
          viewingHistory={Boolean(controller.selectedHistoryId)}
          onRunQuick={() => void controller.runApprovedVerification('quick')}
          onRunFull={() => void controller.runApprovedVerification('full')}
        />
      </div>
      <div className="dashboard-grid__wide">
        <VerificationPlanPreviewCard
          preview={controller.planPreview}
          profilePhase={controller.profilePhase}
        />
      </div>
      <div className="dashboard-grid__wide">
        <ConfigMigrationCard
          policy={config}
          preview={controller.migrationPreview}
          phase={controller.migrationPhase}
          error={controller.migrationError}
          onPreview={() => void controller.previewMigration()}
          onApply={() => void controller.applyMigration()}
        />
      </div>
      <div className="dashboard-grid__wide">
        <PolicyApprovalCard
          approval={controller.approval}
          phase={controller.approvalPhase}
          error={controller.approvalError}
          onApprove={() => void controller.approvePolicy()}
          onRevoke={() => void controller.revokeApproval()}
          onRefresh={() => void controller.refreshApproval()}
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
