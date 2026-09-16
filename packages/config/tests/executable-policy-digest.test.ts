import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  digestExecutablePolicy,
  parseProjectConfigV2,
  reviewExecutablePolicy,
} from '../src/index.js';

const policyYaml = `version: 2
project: { name: Example }
suites:
  test: { type: test, command: pnpm test, failure_policy: block, timeout_ms: 10000 }
  lint: { type: lint, command: pnpm lint, failure_policy: warn }
plans:
  quick: { suites: [test, lint] }
  full: { suites: [test, lint] }
launch_targets: {}
discovery: { exclusions: [] }
overrides: {}
`;

describe('canonical executable-policy digest', () => {
  it('returns the exact executable review snapshot used for digesting', () => {
    expect(reviewExecutablePolicy(parseProjectConfigV2(policyYaml))).toEqual({
      digestVersion: 1,
      policySchemaVersion: 2,
      suites: [
        { id: 'lint', type: 'lint', command: 'pnpm lint', failurePolicy: 'warn', timeoutMs: null },
        {
          id: 'test',
          type: 'test',
          command: 'pnpm test',
          failurePolicy: 'block',
          timeoutMs: 10000,
        },
      ],
      plans: { quick: ['test', 'lint'], full: ['test', 'lint'] },
      launchTargets: {},
      overrides: {},
    });
  });

  it('ignores formatting, comments, mapping order, and display name', () => {
    const equivalent = `# human comment
version: 2
project:
  name: Renamed presentation label
suites:
  lint:
    failure_policy: warn
    command: pnpm lint
    type: lint
  test:
    timeout_ms: 10000
    command: pnpm test # inline comment
    failure_policy: block
    type: test
plans:
  full: { suites: [test, lint] }
  quick: { suites: [test, lint] }
launch_targets: {}
discovery: { exclusions: [] }
overrides: {}
`;
    expect(digestExecutablePolicy(parseProjectConfigV2(equivalent))).toEqual(
      digestExecutablePolicy(parseProjectConfigV2(policyYaml)),
    );
  });

  it.each([
    ['command', 'pnpm test', 'pnpm test -- --runInBand'],
    ['type', 'type: lint', 'type: test'],
    ['timeout', 'timeout_ms: 10000', 'timeout_ms: 20000'],
    ['failure policy', 'failure_policy: warn', 'failure_policy: block'],
    ['suite membership', 'quick: { suites: [test, lint] }', 'quick: { suites: [test] }'],
    ['suite order', 'full: { suites: [test, lint] }', 'full: { suites: [lint, test] }'],
  ])('changes when %s changes', (_label, before, after) => {
    expect(
      digestExecutablePolicy(parseProjectConfigV2(policyYaml.replace(before, after))),
    ).not.toEqual(digestExecutablePolicy(parseProjectConfigV2(policyYaml)));
  });

  it('rejects malformed or unsupported policy before hashing', () => {
    expect(() => digestExecutablePolicy({ version: 2, suites: {} } as never)).toThrow(
      ConfigValidationError,
    );
    expect(() => parseProjectConfigV2(policyYaml.replace('version: 2', 'version: 3'))).toThrow(
      ConfigValidationError,
    );
  });
});
