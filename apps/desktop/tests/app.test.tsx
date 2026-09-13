import { render, screen, waitFor } from '@testing-library/react';
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
    expect(
      screen.getByRole('heading', { name: 'Observed command candidates' }),
    ).toBeInTheDocument();
    expect(screen.getByText('vitest run')).toBeInTheDocument();
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
        client={createMockEngineClient({ latencyMs: 0, failMethod: 'project.profile' })}
        pickRepository={async () => null}
        initialRepository="C:\\work\\profile-error"
      />,
    );

    expect(await screen.findByText('Scan unavailable')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'profile-error' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Configured checks' })).toBeInTheDocument();
    expect(
      screen.getByText(/MOCK_ERROR: Mock failure while calling project\.profile\./u),
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
    expect(screen.getByText('vitest run')).toBeInTheDocument();
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
      screen.getByText(/INTERRUPTED: The mock engine request was interrupted\./u),
    ).toBeInTheDocument();
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
    expect(screen.getByText('C:\\work\\new-profile')).toBeInTheDocument();
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
