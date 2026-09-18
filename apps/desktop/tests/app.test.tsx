import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { createMockEngineClient } from '../src/engine/index.js';

describe('desktop dashboard', () => {
  it('shows the empty first-launch workflow before a repository is selected', () => {
    render(
      <App client={createMockEngineClient({ latencyMs: 0 })} pickRepository={async () => null} />,
    );

    expect(screen.getByRole('heading', { name: 'Open a repository' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'First launch workflow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Browse…' })).toBeEnabled();
  });

  it('communicates the loading state while repository evidence is requested', async () => {
    render(
      <App
        client={createMockEngineClient({ latencyMs: 80 })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\loading-project"
      />,
    );

    const heading = await screen.findByRole('heading', { name: /Inspecting repository/u });
    expect(heading.closest('[aria-busy="true"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { name: 'loading-project' })).toBeInTheDocument();
  });

  it('opens a repository and presents project, Git, checks, and history evidence', async () => {
    const user = userEvent.setup();
    render(
      <App client={createMockEngineClient({ latencyMs: 0 })} pickRepository={async () => null} />,
    );

    const path = screen.getByRole('textbox', { name: 'Repository path' });
    await user.type(path, 'C:\\work\\atlas-web');
    await user.click(screen.getByRole('button', { name: 'Open project' }));

    expect(await screen.findByRole('heading', { name: 'atlas-web' })).toBeInTheDocument();
    expect(screen.getByText('feature/session-hardening')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current changes' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Configured checks' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent runs' })).toBeInTheDocument();
  });

  it('automatically renders deterministic project facts, candidates, and evidence', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 5 })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\profile-project"
      />,
    );

    expect(await screen.findByText('Profile ready')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deterministic facts' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Detected project capabilities' })).toHaveTextContent(
      'Node.js',
    );
    expect(screen.getAllByText('Vite')).toHaveLength(2);
    expect(screen.getAllByText('confirmed').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Detected workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Detected workspace units' })).toHaveTextContent(
      'profile-project',
    );
    expect(
      screen.getByRole('heading', { name: 'Observed command candidates' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Observed project scripts' })).getByText(
        'vitest run',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Evidence only - these commands were not run and cannot be started from this view.',
      ),
    ).toBeInTheDocument();
    const evidence = screen.getByText(/^Deterministic evidence \(/u);
    await user.click(evidence);
    expect(screen.getByText('A Vite configuration file is present.')).toBeInTheDocument();
    expect(screen.queryByText(/\bAI\b/u)).not.toBeInTheDocument();
  });

  it('automatically renders distinct read-only Quick and Full plan previews with reasons', async () => {
    const client = createMockEngineClient({ latencyMs: 0 });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\plan-preview"
      />,
    );

    const card = await screen.findByRole('region', { name: 'Verification Plan' });
    const quickSelected = within(card).getByRole('list', { name: 'Quick selected checks' });
    const quickSkipped = within(card).getByRole('list', { name: 'Quick skipped checks' });
    const fullSelected = within(card).getByRole('list', { name: 'Full selected checks' });

    expect(quickSelected).toHaveTextContent('Run test (test)');
    expect(quickSelected).toHaveTextContent('Run lint (lint)');
    expect(quickSelected).not.toHaveTextContent('Run build (build)');
    expect(quickSkipped).toHaveTextContent('Run typecheck (typecheck)');
    expect(quickSkipped).toHaveTextContent('Run build (build)');
    expect(quickSkipped).toHaveTextContent('reserved for the Full plan');
    expect(fullSelected).toHaveTextContent('Run test (test)');
    expect(fullSelected).toHaveTextContent('Run lint (lint)');
    expect(fullSelected).toHaveTextContent('Run typecheck (typecheck)');
    expect(fullSelected).toHaveTextContent('Run build (build)');
    expect(within(card).getAllByText('Ready')).toHaveLength(2);
    expect(card).toHaveTextContent('deterministic project profile');
    expect(card).toHaveTextContent(
      'Preview only — no check was run, and no repository, configuration, or history state was written.',
    );
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(request.mock.calls.some(([method]) => method === 'verification.plan')).toBe(true);
    expect(request.mock.calls.some(([method]) => method === 'project.profile')).toBe(false);
    expect(request.mock.calls.some(([method]) => method === 'verification.run')).toBe(false);
  });

  it('does not preview or apply configuration migration merely by opening a repository', async () => {
    const client = createMockEngineClient({ latencyMs: 0 });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\migration-review"
      />,
    );

    const card = await screen.findByRole('region', { name: 'Configuration Migration' });
    expect(card).toHaveTextContent('Current version: 1 → Target version: 2');
    expect(within(card).getByRole('button', { name: 'Review Migration' })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: 'Apply Migration' })).not.toBeInTheDocument();
    expect(request.mock.calls.some(([method]) => method === 'config.policy.get')).toBe(true);
    expect(request.mock.calls.some(([method]) => method === 'config.get')).toBe(false);
    expect(request.mock.calls.some(([method]) => method === 'config.migrate.preview')).toBe(false);
    expect(request.mock.calls.some(([method]) => method === 'config.migrate.apply')).toBe(false);
  });

  it('renders the engine exact diff and applies only reviewed digests after a deliberate click', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({ latencyMs: 0 });
    const repository = 'C:\\work\\migration-apply';
    const expectedPreview = await client.request('config.migrate.preview', {
      repository,
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App client={client} pickRepository={async () => null} initialRepository={repository} />,
    );

    const card = await screen.findByRole('region', { name: 'Configuration Migration' });
    await user.click(within(card).getByRole('button', { name: 'Review Migration' }));
    expect(
      await within(card).findByRole('heading', { name: 'Migration Preview' }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent('Preserves named suites and proposes Quick and Full membership');
    const diff = card.querySelector('pre.migration-diff');
    expect(diff?.textContent).toBe(expectedPreview.diff);
    expect(diff).toHaveTextContent('-version: 1');
    expect(diff).toHaveTextContent('+version: 2');
    expect(request.mock.calls.some(([method]) => method === 'config.migrate.apply')).toBe(false);

    await user.click(within(card).getByRole('button', { name: 'Apply Migration' }));
    await waitFor(() => expect(card).toHaveTextContent('Current version: 2'));
    expect(card).toHaveTextContent('Commands are not approved by this change.');
    const applyCall = request.mock.calls.find(([method]) => method === 'config.migrate.apply');
    expect(applyCall?.[1]).toMatchObject({
      repository,
      expectedSourceDigest: expectedPreview.sourceDigest,
      expectedTargetDigest: expectedPreview.targetDigest,
    });
    expect(request.mock.calls.some(([method]) => method === 'verification.run')).toBe(false);
    expect(screen.getByRole('region', { name: 'Configured checks' })).toHaveTextContent('test');
  });

  it('reports a stale migration conflict without claiming success or overwriting policy', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({ latencyMs: 0, migrationStale: true });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\stale-migration"
      />,
    );

    const card = await screen.findByRole('region', { name: 'Configuration Migration' });
    await user.click(within(card).getByRole('button', { name: 'Review Migration' }));
    await user.click(await within(card).findByRole('button', { name: 'Apply Migration' }));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'The policy changed after this preview. Nothing was overwritten.',
    );
    expect(card).toHaveTextContent('Current version: 1');
    expect(within(card).queryByRole('button', { name: 'Apply Migration' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Review Migration' })).toBeEnabled();
    expect(request.mock.calls.some(([method]) => method === 'verification.run')).toBe(false);
  });

  it('reopens a migrated version-2 repository without calling strict version-1 config.get', async () => {
    const client = createMockEngineClient({ latencyMs: 0, initialPolicyVersion: 2 });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\already-migrated"
      />,
    );

    const card = await screen.findByRole('region', { name: 'Configuration Migration' });
    expect(card).toHaveTextContent('Current version: 2');
    expect(card).toHaveTextContent('No migration is needed');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Configured checks' })).toHaveTextContent('test');
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeEnabled();
    expect(request.mock.calls.some(([method]) => method === 'config.get')).toBe(false);
  });

  it('does not approve a version-1 policy or a migration automatically', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({ latencyMs: 0 });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\approval-after-migration"
      />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    expect(
      await within(approval).findByText('Migration required before approval'),
    ).toBeInTheDocument();
    expect(within(approval).queryByRole('button', { name: 'Approve Current Policy' })).toBeNull();

    const migration = screen.getByRole('region', { name: 'Configuration Migration' });
    await user.click(within(migration).getByRole('button', { name: 'Review Migration' }));
    await user.click(await within(migration).findByRole('button', { name: 'Apply Migration' }));

    expect(await within(approval).findByText('Not approved')).toBeInTheDocument();
    expect(within(approval).getByRole('button', { name: 'Approve Current Policy' })).toBeEnabled();
    expect(request.mock.calls.some(([method]) => method === 'config.approval.approve')).toBe(false);
    expect(request.mock.calls.some(([method]) => method === 'verification.run')).toBe(false);
    expect(request.mock.calls.some(([method]) => method === 'verification.plan.run')).toBe(false);
  });

  it('keeps approved Quick and Full actions unavailable until policy approval is explicit', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({ latencyMs: 0, initialPolicyVersion: 2 });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\not-approved-smart-actions"
      />,
    );

    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    expect(
      await within(actions).findByText(/Review and approve the current executable policy/u),
    ).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'Verify Changes / Quick Verification' }),
    ).toBeDisabled();
    expect(within(actions).getByRole('button', { name: 'Full Verification' })).toBeDisabled();
    expect(request.mock.calls.some(([method]) => method === 'verification.plan.run')).toBe(false);

    const approval = screen.getByRole('region', { name: 'Executable Policy Approval' });
    await user.click(within(approval).getByRole('button', { name: 'Approve Current Policy' }));
    expect(await within(approval).findByText('Approved')).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'Verify Changes / Quick Verification' }),
    ).toBeEnabled();
  });

  it('runs approved Quick and Full modes through the existing verification result path', async () => {
    const user = userEvent.setup();
    const repository = 'C:\\work\\approved-modes';
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'approved',
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App client={client} pickRepository={async () => null} initialRepository={repository} />,
    );

    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    const quick = within(actions).getByRole('button', {
      name: 'Verify Changes / Quick Verification',
    });
    await waitFor(() => expect(quick).toBeEnabled());
    await user.click(quick);
    expect(
      await screen.findByText('Verification completed. Quality gate PASS.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Verification run' })).toHaveTextContent(
      'Unit tests',
    );
    expect(screen.getByRole('region', { name: 'Verification run' })).toHaveTextContent('Lint');
    expect(screen.getByRole('region', { name: 'Verification run' })).not.toHaveTextContent(
      'Type check',
    );
    expect(request.mock.calls.find(([method]) => method === 'verification.plan.run')?.[1]).toEqual({
      repository,
      mode: 'quick',
    });

    await user.click(within(actions).getByRole('button', { name: 'Full Verification' }));
    expect(
      await screen.findByText('Verification completed. Quality gate PASS.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Verification run' })).toHaveTextContent(
        'Type check',
      ),
    );
    expect(
      request.mock.calls.filter(([method]) => method === 'verification.plan.run').at(-1)?.[1],
    ).toEqual({
      repository,
      mode: 'full',
    });
    expect(request.mock.calls.some(([method]) => method === 'verification.run')).toBe(false);
    expect(
      request.mock.calls.filter(([method]) => method === 'config.approval.status').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('keeps approved actions disabled until a completed run finishes refreshing gate and history', async () => {
    const user = userEvent.setup();
    let releaseRefresh: () => void = () => undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'approved',
      verificationRefreshBarrier: refreshBarrier,
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\approved-refresh-boundary"
      />,
    );

    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    const quick = within(actions).getByRole('button', {
      name: 'Verify Changes / Quick Verification',
    });
    const full = within(actions).getByRole('button', { name: 'Full Verification' });
    await waitFor(() => expect(quick).toBeEnabled());
    await user.click(quick);
    try {
      await waitFor(() =>
        expect(
          request.mock.calls.filter(([method]) => method === 'gate.latest').length,
        ).toBeGreaterThanOrEqual(2),
      );
      expect(full).toBeDisabled();
      expect(
        request.mock.calls.filter(([method]) => method === 'verification.plan.run'),
      ).toHaveLength(1);
    } finally {
      releaseRefresh();
    }

    await waitFor(() => expect(full).toBeEnabled());
    await user.click(full);
    await waitFor(() =>
      expect(
        request.mock.calls.filter(([method]) => method === 'verification.plan.run'),
      ).toHaveLength(2),
    );
  });

  it('allows a repository opened through a nested path when approval names its canonical root', async () => {
    const user = userEvent.setup();
    const repository = 'C:\\work\\canonical-root\\packages\\app';
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'approved',
      approvalCanonicalRoot: 'C:\\work\\canonical-root',
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App client={client} pickRepository={async () => null} initialRepository={repository} />,
    );

    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    const quick = within(actions).getByRole('button', {
      name: 'Verify Changes / Quick Verification',
    });
    await waitFor(() => expect(quick).toBeEnabled());
    await user.click(quick);

    expect(
      await screen.findByText('Verification completed. Quality gate PASS.'),
    ).toBeInTheDocument();
    expect(request.mock.calls.find(([method]) => method === 'verification.plan.run')?.[1]).toEqual({
      repository,
      mode: 'quick',
    });
  });

  it('rechecks approval and does not start a smart run when policy becomes outdated', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'approved',
      outdateApprovalAfterStatusReads: 2,
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\changed-after-approval"
      />,
    );
    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    await user.click(await within(actions).findByRole('button', { name: 'Full Verification' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not currently approved');
    expect(actions).toHaveTextContent('Approval is outdated');
    expect(within(actions).getByRole('button', { name: 'Full Verification' })).toBeDisabled();
    expect(request.mock.calls.some(([method]) => method === 'verification.plan.run')).toBe(false);
  });

  it('stops an approved Quick run through the existing verification cancellation path', async () => {
    const user = userEvent.setup();
    let acknowledgeCancellation: () => void = () => undefined;
    const cancellationAcknowledgement = new Promise<void>((resolve) => {
      acknowledgeCancellation = resolve;
    });
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'approved',
      verificationCheckLatencyMs: 10_000,
      verificationCancellationBarrier: cancellationAcknowledgement,
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\cancel-approved-quick"
      />,
    );

    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    await user.click(
      await within(actions).findByRole('button', { name: 'Verify Changes / Quick Verification' }),
    );
    expect(await screen.findByRole('heading', { name: 'Collecting evidence' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Stop run' }));
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    acknowledgeCancellation();
    expect(await screen.findByText('Verification interrupted and saved.')).toBeInTheDocument();
    expect(screen.getByText('Quality gate: BLOCK')).toBeInTheDocument();
    expect(
      request.mock.calls.find(([method]) => method === 'verification.plan.run')?.[1],
    ).toMatchObject({
      mode: 'quick',
    });
  });

  it('cannot start a smart run for a repository replaced during approval recheck', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({
      latencyMs: 80,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'approved',
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => 'C:\\work\\new-smart-repository'}
        initialRepository="C:\\work\\old-smart-repository"
      />,
    );

    const actions = await screen.findByRole('region', { name: 'Approved verification' });
    await user.click(await within(actions).findByRole('button', { name: 'Full Verification' }));
    await user.keyboard('{Control>}o{/Control}');
    expect(
      await screen.findByRole('heading', { name: 'new-smart-repository' }),
    ).toBeInTheDocument();
    expect(request.mock.calls.some(([method]) => method === 'verification.plan.run')).toBe(false);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Executable Policy Approval' })).toHaveTextContent(
        'new-smart-repository',
      ),
    );
  });

  it('explicitly approves the reviewed digest and revokes without running a command', async () => {
    const user = userEvent.setup();
    const repository = 'C:\\work\\approval-actions';
    const client = createMockEngineClient({ latencyMs: 0, initialPolicyVersion: 2 });
    const request = vi.spyOn(client, 'request');
    render(
      <App client={client} pickRepository={async () => null} initialRepository={repository} />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    expect(await within(approval).findByText('Not approved')).toBeInTheDocument();
    expect(approval).toHaveTextContent('pnpm test');
    expect(approval).toHaveTextContent('Quick: test, lint');
    expect(approval).toHaveTextContent('Full: test, typecheck, lint');
    expect(request.mock.calls.some(([method]) => method === 'config.approval.approve')).toBe(false);

    const digest = (await client.request('config.approval.status', { repository })).policyDigest;
    await user.click(within(approval).getByRole('button', { name: 'Approve Current Policy' }));
    expect(await within(approval).findByText('Approved')).toBeInTheDocument();
    const approveCall = request.mock.calls.find(([method]) => method === 'config.approval.approve');
    expect(approveCall?.[1]).toEqual({ repository, expectedPolicyDigest: digest });

    await user.click(within(approval).getByRole('button', { name: 'Revoke Approval' }));
    expect(await within(approval).findByText('Approval revoked')).toBeInTheDocument();
    expect(request.mock.calls.some(([method]) => method === 'verification.run')).toBe(false);
    expect(request.mock.calls.some(([method]) => method === 'config.migrate.apply')).toBe(false);
  });

  it('renders the command snapshot bound to approval status rather than a separate policy fetch', async () => {
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      approvalReviewTestCommand: 'pnpm run reviewed-tests',
    });
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\review-snapshot"
      />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    await within(approval).findByText('Not approved');
    expect(approval).toHaveTextContent('pnpm run reviewed-tests');
    expect(approval).not.toHaveTextContent('pnpm test');
  });

  it('shows outdated approval and requires explicit reapproval', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'outdated',
    });
    const request = vi.spyOn(client, 'request');
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\outdated-approval"
      />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    expect(
      await within(approval).findByText('Approval outdated because policy changed'),
    ).toBeInTheDocument();
    expect(approval).toHaveTextContent('Review and approve again.');
    expect(request.mock.calls.some(([method]) => method === 'config.approval.approve')).toBe(false);
    await user.click(within(approval).getByRole('button', { name: 'Approve Current Policy' }));
    expect(await within(approval).findByText('Approved')).toBeInTheDocument();
  });

  it('allows a stale approval receipt to be explicitly revoked', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      initialApprovalStatus: 'outdated',
    });
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\revoke-outdated"
      />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    await within(approval).findByText('Approval outdated because policy changed');
    await user.click(within(approval).getByRole('button', { name: 'Revoke Approval' }));
    expect(await within(approval).findByText('Approval revoked')).toBeInTheDocument();
  });

  it('does not claim approval when the reviewed digest becomes stale', async () => {
    const user = userEvent.setup();
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      approvalStale: true,
    });
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\stale-approval"
      />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    await within(approval).findByText('Not approved');
    await user.click(within(approval).getByRole('button', { name: 'Approve Current Policy' }));
    expect(await within(approval).findByRole('alert')).toHaveTextContent('APPROVAL_STALE');
    expect(within(approval).queryByText('Approved')).not.toBeInTheDocument();
    expect(within(approval).queryByRole('button', { name: 'Approve Current Policy' })).toBeNull();
    await user.click(within(approval).getByRole('button', { name: 'Refresh Approval Status' }));
    expect(await within(approval).findByText('Not approved')).toBeInTheDocument();
  });

  it('ignores an old repository approval status after another repository is selected', async () => {
    let releaseOldStatus: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseOldStatus = resolve;
    });
    const user = userEvent.setup();
    const client = createMockEngineClient({
      latencyMs: 0,
      initialPolicyVersion: 2,
      approvalStatusBarrier: barrier,
    });
    render(
      <App
        client={client}
        pickRepository={async () => null}
        initialRepository="C:\\work\\old-approval"
      />,
    );

    const approval = await screen.findByRole('region', { name: 'Executable Policy Approval' });
    expect(approval).toHaveTextContent('Checking approval status');
    const path = screen.getByRole('textbox', { name: 'Repository path' });
    await user.clear(path);
    await user.type(path, 'C:\\work\\new-approval');
    await user.click(screen.getByRole('button', { name: 'Inspect again' }));
    expect(await screen.findByRole('heading', { name: 'new-approval' })).toBeInTheDocument();
    const newApproval = screen.getByRole('region', { name: 'Executable Policy Approval' });
    expect(await within(newApproval).findByText('Not approved')).toBeInTheDocument();
    await user.click(within(newApproval).getByRole('button', { name: 'Approve Current Policy' }));
    expect(await within(newApproval).findByText('Approved')).toBeInTheDocument();

    releaseOldStatus();
    await waitFor(() => expect(within(newApproval).getByText('Approved')).toBeInTheDocument());
    expect(newApproval).toHaveTextContent('new-approval');
  });

  it('does not let a delayed migration preview replace another selected repository', async () => {
    let releasePreview: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, migrationPreviewBarrier: barrier })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\old-migration"
      />,
    );

    const oldCard = await screen.findByRole('region', { name: 'Configuration Migration' });
    await user.click(within(oldCard).getByRole('button', { name: 'Review Migration' }));
    expect(oldCard).toHaveTextContent('Preparing the exact version 1 to version 2 policy diff.');
    const path = screen.getByRole('textbox', { name: 'Repository path' });
    await user.clear(path);
    await user.type(path, 'C:\\work\\new-migration');
    await user.click(screen.getByRole('button', { name: 'Inspect again' }));
    expect(await screen.findByRole('heading', { name: 'new-migration' })).toBeInTheDocument();

    releasePreview();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Configuration Migration' })).not.toHaveTextContent(
        'Migration Preview',
      );
    });
    expect(screen.getByRole('region', { name: 'Configuration Migration' })).toHaveTextContent(
      'Current version: 1',
    );
  });

  it('keeps conflicting evidence explicit instead of selecting a hidden winner', async () => {
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, profileAmbiguous: true })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\ambiguous-profile"
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Ambiguities' })).toBeInTheDocument();
    expect(
      screen.getByText('Both pnpm and npm package-manager evidence is present.'),
    ).toBeInTheDocument();
  });

  it('keeps the existing dashboard usable when project profiling fails', async () => {
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, failMethod: 'verification.plan' })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\profile-error"
      />,
    );

    expect(await screen.findByText('Scan unavailable')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'profile-error' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Configured checks' })).toBeInTheDocument();
    expect(
      screen.getAllByText(/MOCK_ERROR: Mock failure while calling verification\.plan\./u).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/A verification plan preview could not be produced\./u),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distinguishes a budget-limited partial profile from cancellation', async () => {
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, profileCompleteness: 'partial' })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\partial-profile"
      />,
    );

    expect(await screen.findByText('Partial profile')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Quick selected checks' })).not.toBeInTheDocument();
    expect(screen.getByText(/A scan budget was reached/u)).toBeInTheDocument();
    expect(
      screen.getByText('The entry limit was reached; this profile has partial coverage.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Scan stopped')).not.toBeInTheDocument();
  });

  it('stops an active scan and retains the last completed profile on refresh', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, profileLatencyMs: 100 })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\refresh-profile"
      />,
    );

    await screen.findByText('Profile ready');
    await user.click(screen.getByRole('button', { name: 'Understand Project' }));
    expect(await screen.findByText('Scanning')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Project sensors completed' }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Stop project scan' }));

    expect(await screen.findByText('Scan stopped')).toBeInTheDocument();
    expect(
      screen.getByText('Refresh cancelled; the last completed profile remains displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deterministic facts' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Observed project scripts' })).getByText(
        'vitest run',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Quick selected checks' })).toBeInTheDocument();
  });

  it('does not report cancellation when interruption lacks a terminal result', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({
          latencyMs: 0,
          profileLatencyMs: 100,
          rejectProfileCancellation: true,
        })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\unconfirmed-profile-stop"
      />,
    );

    await screen.findByText('Profile ready');
    await user.click(screen.getByRole('button', { name: 'Understand Project' }));
    await user.click(await screen.findByRole('button', { name: 'Stop project scan' }));

    expect(await screen.findByText('Scan unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Refresh failed; the last completed profile remains displayed.'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/INTERRUPTED: The mock engine request was interrupted\./u).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Scan stopped')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deterministic facts' })).toBeInTheDocument();
  });

  it('ignores profile events and results from a repository that has been replaced', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 30 })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\old-profile"
      />,
    );

    await screen.findByRole('button', { name: 'Stop project scan' });
    const path = screen.getByRole('textbox', { name: 'Repository path' });
    await user.clear(path);
    await user.type(path, 'C:\\work\\new-profile');
    await user.click(screen.getByRole('button', { name: 'Inspect again' }));

    expect(await screen.findByRole('heading', { name: 'new-profile' })).toBeInTheDocument();
    expect(await screen.findByText('Profile ready')).toBeInTheDocument();
    expect(
      screen.getByText('C:\\work\\new-profile', { selector: '.path-text' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('C:\\work\\new-profile', { selector: '.plan-preview-context code' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('C:\\work\\old-profile')).not.toBeInTheDocument();
  });

  it('initializes a discovered configuration before enabling verification', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, configExists: false })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\new-project"
      />,
    );

    const initialize = await screen.findByRole('button', { name: 'Initialize project' });
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeDisabled();
    await user.click(initialize);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run verification' })).toBeEnabled();
    });
    expect(screen.getByRole('region', { name: 'Configured checks' })).toBeInTheDocument();
  });

  it.each([
    ['PASS', '48 tests passed', 'Ready for merge'],
    ['WARN', '1 warning found', 'Review recommended'],
    ['BLOCK', '47 tests passed', 'Merge blocked'],
  ] as const)(
    'renders the engine-provided %s result and streamed evidence',
    async (scenario, expectedOutput, expectedHeadline) => {
      const user = userEvent.setup();
      render(
        <App
          client={createMockEngineClient({ latencyMs: 0, gateScenario: scenario })}
          pickRepository={async () => null}
          initialRepository={`C:\\work\\${scenario.toLowerCase()}-project`}
        />,
      );

      const run = await screen.findByRole('button', { name: 'Run verification' });
      await user.click(run);

      expect(await screen.findByText(new RegExp(expectedOutput, 'u'))).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: expectedHeadline })).toBeInTheDocument();
      expect(screen.getByText(`Quality gate: ${scenario}`)).toBeInTheDocument();
    },
  );

  it('shows cancellation progress and renders the persisted interrupted run', async () => {
    const user = userEvent.setup();
    let acknowledgeCancellation: () => void = () => undefined;
    const cancellationAcknowledgement = new Promise<void>((resolve) => {
      acknowledgeCancellation = resolve;
    });
    render(
      <App
        client={createMockEngineClient({
          latencyMs: 0,
          verificationCheckLatencyMs: 10_000,
          verificationCancellationBarrier: cancellationAcknowledgement,
        })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\running-project"
      />,
    );

    const run = await screen.findByRole('button', { name: 'Run verification' });
    await user.click(run);

    expect(await screen.findByRole('heading', { name: 'Collecting evidence' })).toBeInTheDocument();
    expect(await screen.findByText('running')).toBeInTheDocument();
    const stop = screen.getByRole('button', { name: 'Stop run' });
    expect(screen.getByText('Running configured checks')).toBeInTheDocument();
    await user.click(stop);

    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    acknowledgeCancellation();
    expect(await screen.findByText('Verification interrupted and saved.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Quality gate: BLOCK')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeEnabled();
  });

  it('does not let a cancelled run overwrite a newly opened repository', async () => {
    const user = userEvent.setup();
    const nextRepository = 'C:\\work\\new-project';
    render(
      <App
        client={createMockEngineClient({ latencyMs: 100 })}
        pickRepository={async () => nextRepository}
        initialRepository="C:\\work\\old-project"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Run verification' }));
    expect(await screen.findByRole('heading', { name: 'Collecting evidence' })).toBeInTheDocument();

    await user.keyboard('{Control>}o{/Control}');

    expect(await screen.findByRole('heading', { name: 'new-project' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready for merge' })).toBeInTheDocument();
    expect(screen.queryByText('Verification interrupted and saved.')).not.toBeInTheDocument();
  });

  it('renders a structured engine error without replacing it with a gate', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, failMethod: 'verification.run' })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\error-project"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Run verification' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'MOCK_ERROR: Mock failure while calling verification.run.',
    );
  });

  it('opens a persisted historical run and returns to the latest result', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createMockEngineClient({ latencyMs: 0, gateScenario: 'PASS' })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\history-project"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Open run mock-warn-003, WARN' }));

    expect(screen.getByText('Viewing saved run mock-warn-003')).toBeInTheDocument();
    expect(screen.getByText('Viewing persisted run mock-warn-003')).toBeInTheDocument();
    expect(screen.getByText('Quality gate: WARN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run verification' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Return to latest' }));
    await waitFor(() => {
      expect(screen.queryByText('Viewing persisted run mock-warn-003')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Quality gate: PASS')).toBeInTheDocument();
  });

  it('supports the open-project keyboard shortcut and restores browse-button focus', async () => {
    const user = userEvent.setup();
    const picker = vi.fn(async () => 'C:\\work\\keyboard-project');
    render(<App client={createMockEngineClient({ latencyMs: 0 })} pickRepository={picker} />);

    await user.keyboard('{Control>}o{/Control}');

    expect(picker).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'keyboard-project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse…' })).toHaveFocus();
  });

  it('has no automatically detectable accessibility violations on first launch', async () => {
    const { container } = render(
      <App client={createMockEngineClient({ latencyMs: 0 })} pickRepository={async () => null} />,
    );
    const result = await axe.run(container, {
      rules: {
        // JSDOM cannot calculate rendered foreground/background contrast.
        'color-contrast': { enabled: false },
      },
    });

    expect(result.violations).toEqual([]);
  });

  it('has no automatically detectable accessibility violations in the project profile view', async () => {
    const { container } = render(
      <App
        client={createMockEngineClient({ latencyMs: 0 })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\accessible-profile"
      />,
    );
    await screen.findByText('Profile ready');

    const result = await axe.run(container, {
      rules: {
        // JSDOM cannot calculate rendered foreground/background contrast.
        'color-contrast': { enabled: false },
      },
    });

    expect(result.violations).toEqual([]);
  });
});
