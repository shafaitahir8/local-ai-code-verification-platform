import type {
  ProjectProfileResult,
  VerificationPlanPreviewResult,
  VerificationRun,
} from '@verify/domain';
import { describe, expect, it } from 'vitest';

import {
  createRequestDecoder,
  decodeRequestLine,
  decodeResultLine,
  decodeServerMessageLine,
  encodeError,
  encodeEvent,
  encodeRequest,
  encodeResult,
  NdjsonDecoder,
  ProtocolDecodeError,
  PROTOCOL_VERSION,
  type ProtocolEventMessage,
  type ProtocolResultMap,
  type ProtocolRequest,
} from '../src/index.js';

const sourceDigest = 'a'.repeat(64);
const targetDigest = 'b'.repeat(64);

function migratedConfig(): ProtocolResultMap['config.migrate.apply']['config'] {
  return {
    version: 2,
    project: { name: 'example' },
    suites: {
      test: { type: 'test', command: 'npm test', failure_policy: 'block' },
    },
    plans: { quick: { suites: ['test'] }, full: { suites: ['test'] } },
    launch_targets: {},
    discovery: { exclusions: [] },
    overrides: {},
  };
}

function completedRun(): VerificationRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryRoot: '/workspace/example',
    status: 'completed',
    startedAt: '2026-09-07T08:00:00.000Z',
    completedAt: '2026-09-07T08:00:01.000Z',
    durationMs: 1_000,
    checks: [
      {
        id: 'test',
        name: 'Unit tests',
        type: 'test',
        command: 'npm test',
        failurePolicy: 'block',
        status: 'passed',
        startedAt: '2026-09-07T08:00:00.000Z',
        completedAt: '2026-09-07T08:00:01.000Z',
        durationMs: 1_000,
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        findings: [],
        artifacts: [
          {
            type: 'log',
            path: '/workspace/example/.verify/test.log',
            source: 'generic-command',
            metadata: { retained: true },
          },
        ],
      },
    ],
    gate: {
      status: 'PASS',
      reasons: [],
      evaluatedAt: '2026-09-07T08:00:01.000Z',
      summary: {
        total: 1,
        passed: 1,
        warning: 0,
        failed: 0,
        error: 0,
        cancelled: 0,
        skipped: 0,
      },
    },
  };
}

function completedProfile(): ProjectProfileResult {
  return {
    status: 'completed',
    profile: {
      profileVersion: 1,
      repositoryRoot: '/workspace/example',
      displayName: 'example',
      generatedAt: '2026-09-12T08:00:00.000Z',
      completeness: 'complete',
      scan: {
        entriesScanned: 8,
        filesScanned: 6,
        directoriesScanned: 2,
        bytesRead: 512,
        skippedDirectories: 1,
        elapsedMs: 12,
        limitsReached: [],
      },
      capabilities: [
        {
          id: 'runtime.node',
          kind: 'runtime',
          name: 'Node.js',
          confidence: 'confirmed',
          evidenceIds: ['node.manifest.package-json'],
        },
        {
          id: 'framework.vite',
          kind: 'framework',
          name: 'Vite',
          confidence: 'confirmed',
          evidenceIds: ['node.config.vite'],
        },
        {
          id: 'test-framework.vitest',
          kind: 'test-framework',
          name: 'Vitest',
          confidence: 'confirmed',
          evidenceIds: ['node.script.test'],
        },
      ],
      workspaceUnits: [
        {
          id: 'workspace.root',
          path: '.',
          name: 'example',
          evidenceIds: ['node.manifest.package-json'],
        },
      ],
      taskCandidates: [
        {
          id: 'task.root.test',
          kind: 'test',
          label: 'Run test (test)',
          command: 'vitest run',
          workingDirectory: '.',
          workspaceId: 'workspace.root',
          confidence: 'confirmed',
          evidenceIds: ['node.script.test'],
        },
      ],
      evidence: [
        {
          id: 'node.config.vite',
          sensorId: 'node',
          kind: 'config',
          path: 'vite.config.ts',
          summary: 'Vite configuration is present.',
        },
        {
          id: 'node.manifest.package-json',
          sensorId: 'node',
          kind: 'manifest',
          path: 'package.json',
          summary: 'Node package manifest is present.',
        },
        {
          id: 'node.script.test',
          sensorId: 'node',
          kind: 'script',
          path: 'package.json',
          pointer: ['scripts', 'test'],
          summary: 'package.json declares the test script.',
        },
      ],
      ambiguities: [],
      warnings: [],
    },
  };
}

function completedPlanPreview(): VerificationPlanPreviewResult {
  const profileResult = completedProfile();
  if (profileResult.status !== 'completed') {
    throw new Error('Expected a completed profile fixture.');
  }

  const testDecision = {
    taskCandidateId: 'task.root.test',
    kind: 'test' as const,
    label: 'Run test (test)',
    command: 'vitest run',
    workingDirectory: '.',
    workspaceId: 'workspace.root',
    confidence: 'confirmed' as const,
    capabilityIds: ['test-framework.vitest'],
    evidenceIds: ['node.script.test'],
    reason: 'Selected from one confirmed root test task with deterministic evidence.',
  };
  const planProvenance = {
    planVersion: 1 as const,
    status: 'ready' as const,
    repositoryRoot: profileResult.profile.repositoryRoot,
    profileVersion: profileResult.profile.profileVersion,
    profileGeneratedAt: profileResult.profile.generatedAt,
    profileCompleteness: profileResult.profile.completeness,
    recommendationSource: 'deterministic-project-profile' as const,
  };

  return {
    status: 'completed',
    preview: {
      profile: profileResult.profile,
      plans: {
        quick: {
          ...planProvenance,
          mode: 'quick',
          statusReason: 'One evidence-backed check is selected for the quick preview.',
          selectedChecks: [testDecision],
          skippedChecks: [],
        },
        full: {
          ...planProvenance,
          mode: 'full',
          statusReason: 'One evidence-backed check is selected for the full preview.',
          selectedChecks: [testDecision],
          skippedChecks: [],
        },
      },
    },
  };
}

function expectInvalidPlanPreview(result: unknown): void {
  expect(() =>
    encodeResult('verification.plan', {
      protocolVersion: 1,
      id: 'invalid-plan-source',
      // Runtime validation is deliberately tested with untrusted input.
      result: result as VerificationPlanPreviewResult,
    }),
  ).toThrow(ProtocolDecodeError);
}

describe('protocol request codec', () => {
  it('round-trips a method-specific request as one NDJSON record', () => {
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'request-1',
      method: 'runs.list',
      params: { repository: '/workspace/example', limit: 10 },
    } satisfies ProtocolRequest<'runs.list'>;

    const encoded = encodeRequest(request);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(encoded.split('\n')).toHaveLength(2);
    expect(decodeRequestLine(encoded)).toEqual(request);
  });

  it('round-trips an additive cancellation request with its own correlation id', () => {
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-1',
      method: 'verification.cancel',
      params: { targetRequestId: 'run-1' },
    } satisfies ProtocolRequest<'verification.cancel'>;

    const encoded = encodeRequest(request);

    expect(decodeRequestLine(encoded)).toEqual(request);
    expect(
      decodeResultLine(
        'verification.cancel',
        encodeResult('verification.cancel', {
          protocolVersion: PROTOCOL_VERSION,
          id: request.id,
          result: { accepted: true },
        }),
      ),
    ).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      id: request.id,
      result: { accepted: true },
    });
  });

  it('round-trips additive profiling and general cancellation requests', () => {
    const profileRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'profile-1',
      method: 'project.profile',
      params: { repository: '/workspace/example' },
    } satisfies ProtocolRequest<'project.profile'>;
    const cancelRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-profile-1',
      method: 'operation.cancel',
      params: { targetRequestId: profileRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;

    expect(decodeRequestLine(encodeRequest(profileRequest))).toEqual(profileRequest);
    expect(decodeRequestLine(encodeRequest(cancelRequest))).toEqual(cancelRequest);
    expect(
      decodeResultLine(
        'operation.cancel',
        encodeResult('operation.cancel', {
          protocolVersion: PROTOCOL_VERSION,
          id: cancelRequest.id,
          result: { accepted: true },
        }),
      ),
    ).toMatchObject({ result: { accepted: true } });
  });

  it('round-trips the additive read-only verification planning request', () => {
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'plan-1',
      method: 'verification.plan',
      params: { repository: '/workspace/example' },
    } satisfies ProtocolRequest<'verification.plan'>;

    expect(decodeRequestLine(encodeRequest(request))).toEqual(request);
  });

  it('round-trips approved Quick/Full execution without changing legacy run frames', () => {
    for (const mode of ['quick', 'full'] as const) {
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        id: `approved-${mode}`,
        method: 'verification.plan.run',
        params: { repository: '/workspace/example', mode },
      } satisfies ProtocolRequest<'verification.plan.run'>;
      expect(decodeRequestLine(encodeRequest(request))).toEqual(request);
      expect(
        decodeResultLine(
          'verification.plan.run',
          encodeResult('verification.plan.run', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: completedRun(),
          }),
        ),
      ).toMatchObject({ id: request.id, result: completedRun() });
    }

    for (const params of [
      { repository: '/workspace/example' },
      { repository: '/workspace/example', mode: 'relevant' },
      { repository: '/workspace/example', mode: 'quick', command: 'npm test' },
    ]) {
      expect(() =>
        decodeRequestLine(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            id: 'invalid-approved-run',
            method: 'verification.plan.run',
            params,
          }),
        ),
      ).toThrow(ProtocolDecodeError);
    }

    expect(
      decodeRequestLine(
        encodeRequest({
          protocolVersion: PROTOCOL_VERSION,
          id: 'legacy-run',
          method: 'verification.run',
          params: { repository: '/workspace/example' },
        }),
      ),
    ).toMatchObject({ method: 'verification.run' });
  });

  it('rejects incompatible versions, unknown methods, extra fields, and malformed params', () => {
    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 2,
          id: 'request-1',
          method: 'runs.list',
          params: { repository: '/workspace/example' },
        }),
      ),
    ).toThrow(ProtocolDecodeError);

    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          id: 'request-1',
          method: 'unknown.method',
          params: {},
        }),
      ),
    ).toThrow(ProtocolDecodeError);

    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          id: 'request-1',
          method: 'runs.list',
          params: { repository: '/workspace/example', limit: 0 },
          consoleOutput: 'must not enter the protocol',
        }),
      ),
    ).toThrow(ProtocolDecodeError);

    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          id: 'cancel-1',
          method: 'verification.cancel',
          params: { targetRequestId: '', force: true },
        }),
      ),
    ).toThrow(ProtocolDecodeError);
  });
});

describe('server message codec', () => {
  it('round-trips completed and cancelled verification plan previews', () => {
    const completed = completedPlanPreview();

    expect(
      decodeResultLine(
        'verification.plan',
        encodeResult('verification.plan', {
          protocolVersion: 1,
          id: 'plan-1',
          result: completed,
        }),
      ),
    ).toEqual({ protocolVersion: 1, id: 'plan-1', result: completed });
    expect(
      decodeResultLine(
        'verification.plan',
        encodeResult('verification.plan', {
          protocolVersion: 1,
          id: 'plan-cancelled',
          result: { status: 'cancelled' },
        }),
      ),
    ).toEqual({
      protocolVersion: 1,
      id: 'plan-cancelled',
      result: { status: 'cancelled' },
    });
  });

  it('rejects verification plan decisions without reasons or known check kinds', () => {
    const completed = completedPlanPreview();
    if (completed.status !== 'completed') {
      throw new Error('Expected a completed planning fixture.');
    }
    const decision = completed.preview.plans.quick.selectedChecks[0];
    if (decision === undefined) {
      throw new Error('Expected one selected planning decision.');
    }

    for (const invalidDecision of [
      { ...decision, reason: '' },
      { ...decision, kind: 'deploy' },
    ]) {
      const invalid = {
        ...completed,
        preview: {
          ...completed.preview,
          plans: {
            ...completed.preview.plans,
            quick: {
              ...completed.preview.plans.quick,
              selectedChecks: [invalidDecision],
            },
          },
        },
      };

      expect(() =>
        encodeResult('verification.plan', {
          protocolVersion: 1,
          id: 'invalid-plan',
          // Runtime validation is deliberately tested with untrusted input.
          result: invalid as unknown as VerificationPlanPreviewResult,
        }),
      ).toThrow(ProtocolDecodeError);
    }
  });

  it('rejects swapped plan modes and provenance that differs from the embedded profile', () => {
    const completed = completedPlanPreview();
    if (completed.status !== 'completed') {
      throw new Error('Expected a completed planning fixture.');
    }

    const invalidQuickPlans = [
      { ...completed.preview.plans.quick, mode: 'full' },
      { ...completed.preview.plans.quick, repositoryRoot: '/workspace/other' },
      {
        ...completed.preview.plans.quick,
        profileGeneratedAt: '2026-09-15T00:00:00.000Z',
      },
      { ...completed.preview.plans.quick, profileCompleteness: 'partial' },
    ];

    for (const quick of invalidQuickPlans) {
      const invalid = {
        ...completed,
        preview: {
          ...completed.preview,
          plans: { ...completed.preview.plans, quick },
        },
      };

      expect(() =>
        encodeResult('verification.plan', {
          protocolVersion: 1,
          id: 'invalid-plan-provenance',
          // Runtime validation is deliberately tested with untrusted input.
          result: invalid as unknown as VerificationPlanPreviewResult,
        }),
      ).toThrow(ProtocolDecodeError);
    }
  });

  it('rejects plan decisions that invent or alter an observed task candidate', () => {
    const completed = completedPlanPreview();
    if (completed.status !== 'completed') throw new Error('Expected a completed planning fixture.');
    const decision = completed.preview.plans.quick.selectedChecks[0];
    if (decision === undefined) throw new Error('Expected one selected planning decision.');

    for (const changedDecision of [
      { ...decision, taskCandidateId: 'task.not-observed' },
      { ...decision, kind: 'build' },
      { ...decision, label: 'Invented label' },
      { ...decision, command: 'invented command' },
      { ...decision, workingDirectory: 'elsewhere' },
      { ...decision, workspaceId: 'workspace.other' },
      { ...decision, confidence: 'tentative' },
    ]) {
      expectInvalidPlanPreview({
        ...completed,
        preview: {
          ...completed.preview,
          plans: {
            ...completed.preview.plans,
            quick: { ...completed.preview.plans.quick, selectedChecks: [changedDecision] },
          },
        },
      });
    }

    expectInvalidPlanPreview({
      ...completed,
      preview: {
        ...completed.preview,
        plans: {
          ...completed.preview.plans,
          quick: {
            ...completed.preview.plans.quick,
            selectedChecks: [decision],
            skippedChecks: [decision],
          },
        },
      },
    });
  });

  it('rejects absent, fabricated, duplicate, or unrelated plan evidence', () => {
    const completed = completedPlanPreview();
    if (completed.status !== 'completed') throw new Error('Expected a completed planning fixture.');
    const decision = completed.preview.plans.quick.selectedChecks[0];
    if (decision === undefined) throw new Error('Expected one selected planning decision.');

    for (const changedDecision of [
      { ...decision, evidenceIds: [] },
      { ...decision, evidenceIds: ['not-in-profile'] },
      { ...decision, evidenceIds: ['node.config.vite'] },
      { ...decision, evidenceIds: ['node.script.test', 'node.script.test'] },
    ]) {
      expectInvalidPlanPreview({
        ...completed,
        preview: {
          ...completed.preview,
          plans: {
            ...completed.preview.plans,
            quick: { ...completed.preview.plans.quick, selectedChecks: [changedDecision] },
          },
        },
      });
    }

    expectInvalidPlanPreview({
      ...completed,
      preview: {
        ...completed.preview,
        plans: {
          ...completed.preview.plans,
          quick: {
            ...completed.preview.plans.quick,
            selectedChecks: [],
            skippedChecks: [{ ...decision, evidenceIds: [] }],
          },
        },
      },
    });

    expectInvalidPlanPreview({
      ...completed,
      preview: {
        ...completed.preview,
        profile: {
          ...completed.preview.profile,
          taskCandidates: completed.preview.profile.taskCandidates.map((candidate) =>
            candidate.id === decision.taskCandidateId
              ? { ...candidate, evidenceIds: [...candidate.evidenceIds, 'not-in-profile'] }
              : candidate,
          ),
        },
      },
    });
  });

  it('rejects unresolved, duplicate, or unrelated capability sources', () => {
    const completed = completedPlanPreview();
    if (completed.status !== 'completed') throw new Error('Expected a completed planning fixture.');
    const decision = completed.preview.plans.quick.selectedChecks[0];
    if (decision === undefined) throw new Error('Expected one selected planning decision.');

    for (const changedDecision of [
      { ...decision, capabilityIds: [] },
      { ...decision, capabilityIds: ['not-in-profile'] },
      { ...decision, capabilityIds: ['framework.vite'] },
      { ...decision, capabilityIds: ['test-framework.vitest', 'test-framework.vitest'] },
    ]) {
      expectInvalidPlanPreview({
        ...completed,
        preview: {
          ...completed.preview,
          plans: {
            ...completed.preview.plans,
            quick: { ...completed.preview.plans.quick, selectedChecks: [changedDecision] },
          },
        },
      });
    }

    for (const capabilityEvidenceIds of [[], ['not-in-profile']]) {
      expectInvalidPlanPreview({
        ...completed,
        preview: {
          ...completed.preview,
          profile: {
            ...completed.preview.profile,
            capabilities: completed.preview.profile.capabilities.map((capability) =>
              capability.id === 'test-framework.vitest'
                ? { ...capability, evidenceIds: capabilityEvidenceIds }
                : capability,
            ),
          },
        },
      });
    }
  });

  it('rejects duplicate source IDs inside a completed plan preview without changing project.profile', () => {
    const completed = completedPlanPreview();
    if (completed.status !== 'completed') throw new Error('Expected a completed planning fixture.');

    for (const field of ['evidence', 'capabilities', 'workspaceUnits', 'taskCandidates'] as const) {
      const sources = completed.preview.profile[field];
      const first = sources[0];
      if (first === undefined) throw new Error(`Expected nonempty ${field} fixture sources.`);
      expectInvalidPlanPreview({
        ...completed,
        preview: {
          ...completed.preview,
          profile: { ...completed.preview.profile, [field]: [...sources, first] },
        },
      });
    }
  });

  it('round-trips typed profile progress and terminal results', () => {
    const progress: ProtocolEventMessage = {
      protocolVersion: 1,
      id: 'profile-1',
      event: 'profile.progress',
      data: {
        phase: 'sensors',
        message: 'Inspecting project metadata with node.',
        entriesScanned: 8,
        bytesRead: 128,
        sensorsCompleted: 0,
        sensorCount: 1,
      },
    };
    const completed = completedProfile();

    expect(decodeServerMessageLine(encodeEvent(progress))).toEqual(progress);
    expect(
      decodeResultLine(
        'project.profile',
        encodeResult('project.profile', {
          protocolVersion: 1,
          id: progress.id,
          result: completed,
        }),
      ),
    ).toEqual({ protocolVersion: 1, id: progress.id, result: completed });
    expect(
      decodeResultLine(
        'project.profile',
        encodeResult('project.profile', {
          protocolVersion: 1,
          id: 'profile-cancelled',
          result: { status: 'cancelled' },
        }),
      ),
    ).toMatchObject({ result: { status: 'cancelled' } });

    if (completed.status !== 'completed') throw new Error('Expected a completed profile fixture.');
    const partial: ProjectProfileResult = {
      status: 'completed',
      profile: {
        ...completed.profile,
        completeness: 'partial',
        scan: { ...completed.profile.scan, limitsReached: ['entries'] },
        warnings: [
          {
            code: 'SCAN_LIMIT_REACHED',
            message: 'Project profiling reached the entries scan limit.',
            affectsCompleteness: true,
          },
        ],
      },
    };
    expect(
      decodeResultLine(
        'project.profile',
        encodeResult('project.profile', {
          protocolVersion: 1,
          id: 'profile-partial',
          result: partial,
        }),
      ),
    ).toMatchObject({ result: { status: 'completed', profile: { completeness: 'partial' } } });
  });

  it('round-trips output events without splitting embedded newlines', () => {
    const event: ProtocolEventMessage = {
      protocolVersion: 1,
      id: 'request-1',
      event: 'check.output',
      data: {
        runId: 'run-1',
        checkId: 'test',
        stream: 'stdout',
        chunk: 'first line\nsecond line\n',
        timestamp: '2026-09-07T08:00:00.500Z',
      },
    };

    const encoded = encodeEvent(event);
    expect(encoded.split('\n')).toHaveLength(2);
    expect(decodeServerMessageLine(encoded)).toEqual(event);
  });

  it('validates a terminal result against its correlated method', () => {
    const run = completedRun();
    const encoded = encodeResult('verification.run', {
      protocolVersion: 1,
      id: 'request-1',
      result: run,
    });

    expect(decodeResultLine('verification.run', encoded)).toEqual({
      protocolVersion: 1,
      id: 'request-1',
      result: run,
    });
    expect(() => decodeResultLine('repository.inspect', encoded)).toThrow(ProtocolDecodeError);
  });

  it('round-trips structured errors, including uncorrelated parse failures', () => {
    const encoded = encodeError({
      protocolVersion: 1,
      id: null,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request JSON could not be decoded.',
        details: { line: 1 },
      },
    });

    expect(decodeServerMessageLine(encoded)).toEqual({
      protocolVersion: 1,
      id: null,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request JSON could not be decoded.',
        details: { line: 1 },
      },
    });
  });

  it('rejects a domain result with an impossible timestamp or missing evidence', () => {
    const invalidRun = {
      ...completedRun(),
      completedAt: 'not-a-date',
      checks: [{ ...completedRun().checks[0], findings: undefined }],
    };
    expect(() =>
      encodeResult('verification.run', {
        protocolVersion: 1,
        id: 'request-1',
        // Runtime validation is deliberately tested with untrusted input.
        result: invalidRun as unknown as VerificationRun,
      }),
    ).toThrow(ProtocolDecodeError);
  });
});

describe('additive configuration migration protocol', () => {
  it('round-trips policy inspection, preview, and guarded apply without changing protocol version', () => {
    const policyRequest = {
      protocolVersion: 1,
      id: 'policy',
      method: 'config.policy.get',
      params: { repository: '/repo' },
    } as const;
    const previewRequest = {
      protocolVersion: 1,
      id: 'preview',
      method: 'config.migrate.preview',
      params: { repository: '/repo' },
    } as const;
    expect(decodeRequestLine(encodeRequest(policyRequest))).toEqual(policyRequest);
    expect(decodeRequestLine(encodeRequest(previewRequest))).toEqual(previewRequest);

    const applyRequest = {
      protocolVersion: 1,
      id: 'apply',
      method: 'config.migrate.apply',
      params: {
        repository: '/repo',
        expectedSourceDigest: sourceDigest,
        expectedTargetDigest: targetDigest,
      },
    } as const;
    expect(decodeRequestLine(encodeRequest(applyRequest))).toEqual(applyRequest);

    const preview = {
      path: '/repo/.verify/project.yml',
      sourceVersion: 1 as const,
      targetVersion: 2 as const,
      sourceDigest,
      targetDigest,
      targetYaml: 'version: 2\n',
      diff: '--- a/.verify/project.yml\n+++ b/.verify/project.yml\n',
      summary: 'Existing suites are preserved.',
    };
    expect(
      decodeResultLine(
        'config.migrate.preview',
        encodeResult('config.migrate.preview', {
          protocolVersion: 1,
          id: 'preview',
          result: preview,
        }),
      ),
    ).toEqual({ protocolVersion: 1, id: 'preview', result: preview });

    const applied = {
      path: preview.path,
      version: 2 as const,
      sourceDigest,
      targetDigest,
      config: migratedConfig(),
    };
    expect(
      decodeResultLine(
        'config.migrate.apply',
        encodeResult('config.migrate.apply', {
          protocolVersion: 1,
          id: 'apply',
          result: applied,
        }),
      ),
    ).toEqual({ protocolVersion: 1, id: 'apply', result: applied });

    const inspected = {
      repositoryRoot: '/repo',
      path: preview.path,
      exists: true,
      config: migratedConfig(),
    };
    expect(
      decodeResultLine(
        'config.policy.get',
        encodeResult('config.policy.get', {
          protocolVersion: 1,
          id: 'inspect',
          result: inspected,
        }),
      ),
    ).toEqual({ protocolVersion: 1, id: 'inspect', result: inspected });
  });

  it('rejects missing or malformed reviewed digests and keeps config.get strict v1', () => {
    const request = {
      protocolVersion: 1,
      id: 'apply',
      method: 'config.migrate.apply',
      params: { repository: '/repo', expectedSourceDigest: 'not-a-digest' },
    };
    expect(() => decodeRequestLine(JSON.stringify(request))).toThrow(ProtocolDecodeError);

    expect(() =>
      encodeResult('config.get', {
        protocolVersion: 1,
        id: 'legacy',
        result: {
          exists: true,
          path: '/repo/.verify/project.yml',
          config: migratedConfig() as unknown as NonNullable<
            ProtocolResultMap['config.get']['config']
          >,
        },
      }),
    ).toThrow(ProtocolDecodeError);
  });

  it('preserves a structured stale migration error', () => {
    const error = {
      protocolVersion: 1,
      id: 'apply',
      error: { code: 'MIGRATION_STALE', message: 'Policy changed since preview.' },
    } as const;
    expect(decodeResultLine('config.migrate.apply', encodeError(error))).toEqual(error);
  });
});

describe('additive executable-policy approval protocol', () => {
  const digest = 'c'.repeat(64);
  const current = {
    repositoryRoot: '/repo',
    policyPath: '/repo/.verify/project.yml',
    policyExists: true,
    policyVersion: 2,
    policyDigest: digest,
    review: {
      digestVersion: 1,
      policySchemaVersion: 2,
      suites: [
        {
          id: 'test',
          type: 'test',
          command: 'npm test',
          failurePolicy: 'block',
          timeoutMs: null,
        },
      ],
      plans: { quick: ['test'], full: ['test'] },
      launchTargets: {},
      overrides: {},
    },
    status: 'approved',
    receipt: {
      id: 'approval-1',
      repositoryRoot: '/repo',
      policySchemaVersion: 2,
      digestVersion: 1,
      policyDigest: digest,
      approvedAt: '2026-09-16T08:00:00.000Z',
      revokedAt: null,
    },
  } as const;

  it('round-trips status, explicit guarded approval, and revocation without changing protocol v1', () => {
    for (const method of ['config.approval.status', 'config.approval.revoke'] as const) {
      const request = {
        protocolVersion: 1,
        id: method,
        method,
        params: { repository: '/repo' },
      } satisfies ProtocolRequest<typeof method>;
      expect(decodeRequestLine(encodeRequest(request))).toEqual(request);
      expect(
        decodeResultLine(
          method,
          encodeResult(method, { protocolVersion: 1, id: method, result: current }),
        ),
      ).toEqual({ protocolVersion: 1, id: method, result: current });
    }

    const approve = {
      protocolVersion: 1,
      id: 'approve',
      method: 'config.approval.approve',
      params: { repository: '/repo', expectedPolicyDigest: digest },
    } satisfies ProtocolRequest<'config.approval.approve'>;
    expect(decodeRequestLine(encodeRequest(approve))).toEqual(approve);
    expect(
      decodeResultLine(
        'config.approval.approve',
        encodeResult('config.approval.approve', {
          protocolVersion: 1,
          id: 'approve',
          result: current,
        }),
      ),
    ).toEqual({ protocolVersion: 1, id: 'approve', result: current });
  });

  it('keeps receipts visible and revocable when the repository policy is unavailable', () => {
    for (const unavailable of [
      { status: 'policy-missing', policyExists: false },
      { status: 'policy-invalid', policyExists: true },
      { status: 'migration-required', policyExists: true, policyVersion: 1 },
    ] as const) {
      const result = {
        ...current,
        ...unavailable,
        policyVersion: unavailable.status === 'migration-required' ? 1 : null,
        policyDigest: null,
        review: null,
      } as ProtocolResultMap['config.approval.status'];
      expect(
        decodeResultLine(
          'config.approval.status',
          encodeResult('config.approval.status', {
            protocolVersion: 1,
            id: unavailable.status,
            result,
          }),
        ),
      ).toMatchObject({ result });
    }
  });

  it('rejects unguarded approval, malformed digest, and malformed receipt metadata', () => {
    for (const params of [
      { repository: '/repo' },
      { repository: '/repo', expectedPolicyDigest: 'x' },
    ]) {
      expect(() =>
        decodeRequestLine(
          JSON.stringify({
            protocolVersion: 1,
            id: 'approve',
            method: 'config.approval.approve',
            params,
          }),
        ),
      ).toThrow(ProtocolDecodeError);
    }
    expect(() =>
      encodeResult('config.approval.status', {
        protocolVersion: 1,
        id: 'invalid',
        result: {
          ...current,
          receipt: { ...current.receipt, digestVersion: 99 },
        } as unknown as ProtocolResultMap['config.approval.status'],
      }),
    ).toThrow(ProtocolDecodeError);
    for (const invalid of [
      { ...current, receipt: null },
      { ...current, review: null },
      { ...current, receipt: { ...current.receipt, repositoryRoot: '/other' } },
      { ...current, status: 'outdated' },
      { ...current, status: 'revoked' },
    ]) {
      expect(() =>
        encodeResult('config.approval.status', {
          protocolVersion: 1,
          id: 'invalid-state',
          result: invalid as unknown as ProtocolResultMap['config.approval.status'],
        }),
      ).toThrow(ProtocolDecodeError);
    }
  });

  it('preserves a structured stale approval conflict', () => {
    const error = {
      protocolVersion: 1,
      id: 'approve',
      error: { code: 'APPROVAL_STALE', message: 'Executable policy changed.' },
    } as const;
    expect(decodeResultLine('config.approval.approve', encodeError(error))).toEqual(error);
    const unavailable = {
      protocolVersion: 1,
      id: 'legacy-approve',
      error: { code: 'APPROVAL_UNAVAILABLE', message: 'Schema-v2 policy is required.' },
    } as const;
    expect(decodeResultLine('config.approval.approve', encodeError(unavailable))).toEqual(
      unavailable,
    );
  });
});

describe('streaming NDJSON decoder', () => {
  it('decodes split chunks, multiple records, CRLF, and a final unterminated record', () => {
    const first = encodeRequest({
      protocolVersion: 1,
      id: 'one',
      method: 'config.get',
      params: { repository: '/one' },
    });
    const second = encodeRequest({
      protocolVersion: 1,
      id: 'two',
      method: 'project.discover',
      params: { repository: '/two' },
    }).trimEnd();
    const decoder = createRequestDecoder();

    expect(decoder.push(first.slice(0, 12))).toEqual([]);
    const decoded = decoder.push(`${first.slice(12).replace(/\n$/, '\r\n')}\n`);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.id).toBe('one');
    expect(decoder.push(second)).toEqual([]);
    expect(decoder.finish()[0]?.id).toBe('two');
  });

  it('reports source line numbers and enforces a bounded pending line', () => {
    const decoder = createRequestDecoder();
    decoder.push('\n');
    expect(() => decoder.push('{bad json}\n')).toThrowError(
      expect.objectContaining({ lineNumber: 2, code: 'INVALID_JSON' }),
    );

    const bounded = new NdjsonDecoder(decodeRequestLine, { maxLineLength: 8 });
    expect(() => bounded.push('123456789')).toThrowError(
      expect.objectContaining({ code: 'LINE_TOO_LONG', lineNumber: 1 }),
    );
  });
});
