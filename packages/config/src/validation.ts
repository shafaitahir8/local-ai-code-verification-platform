import type { FailurePolicy } from '@verify/domain';

import { ConfigValidationError } from './errors.js';
import {
  PROJECT_CONFIG_VERSION,
  type ProjectConfigV1,
  type ProjectSuiteConfigV1,
} from './types.js';

const ROOT_KEYS = new Set(['version', 'project', 'suites']);
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
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: 'is not supported by configuration schema version 1.',
      });
    }
  }
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
