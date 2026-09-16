import type { FailurePolicy } from '@verify/domain';

import { ConfigValidationError } from './errors.js';
import {
  PROJECT_CONFIG_VERSION,
  PROJECT_POLICY_VERSION,
  type ProjectConfigV1,
  type ProjectConfigV2,
  type ProjectSuiteConfigV1,
} from './types.js';

const ROOT_KEYS = new Set(['version', 'project', 'suites']);
const POLICY_ROOT_KEYS = new Set([
  'version',
  'project',
  'suites',
  'plans',
  'launch_targets',
  'discovery',
  'overrides',
]);
const PROJECT_KEYS = new Set(['name']);
const SUITE_KEYS = new Set(['type', 'command', 'failure_policy', 'timeout_ms']);
const SUITE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: { path: string; message: string }[],
  version = 1,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: `is not supported by configuration schema version ${version}.`,
      });
    }
  }
}

function validateSuiteIds(
  value: unknown,
  path: string,
  knownSuites: Readonly<Record<string, unknown>>,
  issues: { path: string; message: string }[],
): readonly string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'is required and must be a list of named suite IDs.' });
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}.${index}`;
    if (typeof candidate !== 'string' || candidate.length === 0) {
      issues.push({ path: itemPath, message: 'must be a non-empty suite ID.' });
    } else if (seen.has(candidate)) {
      issues.push({ path: itemPath, message: `duplicates suite ID ${candidate}.` });
    } else if (!Object.hasOwn(knownSuites, candidate)) {
      issues.push({ path: itemPath, message: `references unknown suite ID ${candidate}.` });
    } else {
      seen.add(candidate);
      ids.push(candidate);
    }
  }
  return ids;
}

function validatePlanMembership(
  value: unknown,
  path: string,
  knownSuites: Readonly<Record<string, unknown>>,
  issues: { path: string; message: string }[],
): { readonly suites: readonly string[] } {
  if (!isRecord(value)) {
    issues.push({ path, message: 'is required and must be a mapping.' });
    return { suites: [] };
  }
  reportUnknownKeys(value, new Set(['suites']), path, issues, 2);
  return {
    suites: validateSuiteIds(value.suites, `${path}.suites`, knownSuites, issues),
  };
}

export function defaultFailurePolicy(type: string): FailurePolicy {
  return type.toLowerCase() === 'lint' ? 'warn' : 'block';
}

export function validateProjectConfig(value: unknown): ProjectConfigV1 {
  const issues: { path: string; message: string }[] = [];

  if (!isRecord(value)) {
    throw new ConfigValidationError([{ path: '$', message: 'must be a YAML mapping.' }]);
  }

  reportUnknownKeys(value, ROOT_KEYS, '$', issues);

  if (value.version !== PROJECT_CONFIG_VERSION) {
    issues.push({
      path: 'version',
      message: `must be ${PROJECT_CONFIG_VERSION}; received ${String(value.version)}.`,
    });
  }

  let projectName = '';
  if (!isRecord(value.project)) {
    issues.push({ path: 'project', message: 'is required and must be a mapping.' });
  } else {
    reportUnknownKeys(value.project, PROJECT_KEYS, 'project', issues);
    if (typeof value.project.name !== 'string' || value.project.name.trim().length === 0) {
      issues.push({ path: 'project.name', message: 'is required and must be a non-empty string.' });
    } else {
      projectName = value.project.name.trim();
    }
  }

  const suites: Record<string, ProjectSuiteConfigV1> = {};
  if (!isRecord(value.suites)) {
    issues.push({ path: 'suites', message: 'is required and must be a mapping.' });
  } else {
    for (const [suiteId, rawSuite] of Object.entries(value.suites)) {
      const suitePath = `suites.${suiteId}`;

      if (!SUITE_ID_PATTERN.test(suiteId)) {
        issues.push({
          path: suitePath,
          message: 'has an invalid ID; use letters, numbers, underscores, or hyphens.',
        });
      }

      if (!isRecord(rawSuite)) {
        issues.push({ path: suitePath, message: 'must be a mapping.' });
        continue;
      }

      reportUnknownKeys(rawSuite, SUITE_KEYS, suitePath, issues);

      let type = suiteId;
      if (rawSuite.type !== undefined) {
        if (typeof rawSuite.type !== 'string' || rawSuite.type.trim().length === 0) {
          issues.push({ path: `${suitePath}.type`, message: 'must be a non-empty string.' });
        } else {
          type = rawSuite.type.trim();
        }
      }

      let command = '';
      if (typeof rawSuite.command !== 'string' || rawSuite.command.trim().length === 0) {
        issues.push({ path: `${suitePath}.command`, message: 'is required.' });
      } else if (rawSuite.command.includes('\0')) {
        issues.push({ path: `${suitePath}.command`, message: 'must not contain a null byte.' });
      } else {
        command = rawSuite.command.trim();
      }

      let failurePolicy = defaultFailurePolicy(type);
      if (rawSuite.failure_policy !== undefined) {
        if (rawSuite.failure_policy !== 'block' && rawSuite.failure_policy !== 'warn') {
          issues.push({
            path: `${suitePath}.failure_policy`,
            message: 'must be either "block" or "warn".',
          });
        } else {
          failurePolicy = rawSuite.failure_policy;
        }
      }

      let timeoutMs: number | undefined;
      if (rawSuite.timeout_ms !== undefined) {
        if (
          typeof rawSuite.timeout_ms !== 'number' ||
          !Number.isSafeInteger(rawSuite.timeout_ms) ||
          rawSuite.timeout_ms <= 0
        ) {
          issues.push({
            path: `${suitePath}.timeout_ms`,
            message: 'must be a positive integer number of milliseconds.',
          });
        } else {
          timeoutMs = rawSuite.timeout_ms;
        }
      }

      suites[suiteId] = {
        type,
        command,
        failure_policy: failurePolicy,
        ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
      };
    }
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    version: PROJECT_CONFIG_VERSION,
    project: { name: projectName },
    suites,
  };
}

/** Validate the deliberately narrow policy-v2 boundary introduced in slice 6B. */
export function validateProjectConfigV2(value: unknown): ProjectConfigV2 {
  if (!isRecord(value)) {
    throw new ConfigValidationError([{ path: '$', message: 'must be a YAML mapping.' }]);
  }

  const issues: { path: string; message: string }[] = [];
  reportUnknownKeys(value, POLICY_ROOT_KEYS, '$', issues, 2);
  if (value.version !== PROJECT_POLICY_VERSION) {
    issues.push({
      path: 'version',
      message: `must be ${PROJECT_POLICY_VERSION}; received ${String(value.version)}.`,
    });
  }

  let base: ProjectConfigV1 | undefined;
  try {
    base = validateProjectConfig({
      version: PROJECT_CONFIG_VERSION,
      project: value.project,
      suites: value.suites,
    });
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) throw error;
    issues.push(...error.issues);
  }

  const knownSuites = base?.suites ?? (isRecord(value.suites) ? value.suites : {});
  let quick: { readonly suites: readonly string[] } = { suites: [] };
  let full: { readonly suites: readonly string[] } = { suites: [] };
  if (!isRecord(value.plans)) {
    issues.push({ path: 'plans', message: 'is required and must be a mapping.' });
  } else {
    reportUnknownKeys(value.plans, new Set(['quick', 'full']), 'plans', issues, 2);
    quick = validatePlanMembership(value.plans.quick, 'plans.quick', knownSuites, issues);
    full = validatePlanMembership(value.plans.full, 'plans.full', knownSuites, issues);
  }

  if (!isRecord(value.launch_targets)) {
    issues.push({ path: 'launch_targets', message: 'is required and must be an empty mapping.' });
  } else if (Object.keys(value.launch_targets).length > 0) {
    issues.push({
      path: 'launch_targets',
      message: 'non-empty launch targets are not supported in slice 6B.',
    });
  }

  if (!isRecord(value.discovery)) {
    issues.push({ path: 'discovery', message: 'is required and must be a mapping.' });
  } else {
    reportUnknownKeys(value.discovery, new Set(['exclusions']), 'discovery', issues, 2);
    if (!Array.isArray(value.discovery.exclusions)) {
      issues.push({
        path: 'discovery.exclusions',
        message: 'is required and must be an empty list.',
      });
    } else if (value.discovery.exclusions.length > 0) {
      issues.push({
        path: 'discovery.exclusions',
        message: 'non-empty exclusions are not supported in slice 6B.',
      });
    }
  }

  if (!isRecord(value.overrides)) {
    issues.push({ path: 'overrides', message: 'is required and must be an empty mapping.' });
  } else if (Object.keys(value.overrides).length > 0) {
    issues.push({
      path: 'overrides',
      message: 'non-empty overrides are not supported in slice 6B.',
    });
  }

  if (issues.length > 0 || base === undefined) {
    throw new ConfigValidationError(issues);
  }

  return {
    version: PROJECT_POLICY_VERSION,
    project: base.project,
    suites: base.suites,
    plans: { quick, full },
    launch_targets: {},
    discovery: { exclusions: [] },
    overrides: {},
  };
}
