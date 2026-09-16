import { parseDocument, stringify } from 'yaml';

import { ConfigValidationError } from './errors.js';
import {
  PROJECT_CONFIG_VERSION,
  PROJECT_POLICY_VERSION,
  type ProjectConfigV1,
  type ProjectConfigV2,
  type ProjectPolicy,
} from './types.js';
import { validateProjectConfig, validateProjectConfigV2 } from './validation.js';

function parseProjectYaml(source: string): unknown {
  const document = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new ConfigValidationError(
      document.errors.map((error) => ({
        path: '$',
        message: `YAML parse error: ${error.message}`,
      })),
    );
  }

  let parsed: unknown;
  try {
    parsed = document.toJS({ maxAliasCount: 50 });
  } catch (error) {
    throw new ConfigValidationError([
      {
        path: '$',
        message: `YAML conversion error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }

  return parsed;
}

export function parseProjectConfig(source: string): ProjectConfigV1 {
  return validateProjectConfig(parseProjectYaml(source));
}

export function parseProjectConfigV2(source: string): ProjectConfigV2 {
  return validateProjectConfigV2(parseProjectYaml(source));
}

export function parseProjectPolicy(source: string): ProjectPolicy {
  const parsed = parseProjectYaml(source);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    'version' in parsed &&
    parsed.version === PROJECT_POLICY_VERSION
  ) {
    return validateProjectConfigV2(parsed);
  }
  return validateProjectConfig(parsed);
}

export function serializeProjectConfig(config: ProjectConfigV1): string {
  const validated = validateProjectConfig(config);
  const suites = Object.fromEntries(
    Object.entries(validated.suites).map(([id, suite]) => [
      id,
      {
        type: suite.type,
        command: suite.command,
        failure_policy: suite.failure_policy,
        ...(suite.timeout_ms === undefined ? {} : { timeout_ms: suite.timeout_ms }),
      },
    ]),
  );

  return stringify(
    {
      version: PROJECT_CONFIG_VERSION,
      project: { name: validated.project.name },
      suites,
    },
    { lineWidth: 0 },
  );
}
