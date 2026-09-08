import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { ConfigAlreadyExistsError, ConfigNotFoundError, ConfigUnsafePathError } from './errors.js';
import { createSuggestedProjectConfig, discoverProject } from './discovery.js';
import {
  PROJECT_CONFIG_RELATIVE_PATH,
  type InitializeProjectConfigOptions,
  type InitializeProjectConfigResult,
  type ProjectConfigPreview,
  type ProjectConfigV1,
} from './types.js';
import { validateProjectConfig } from './validation.js';
import { parseProjectConfig, serializeProjectConfig } from './yaml.js';

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

async function assertNotSymbolicPath(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new ConfigUnsafePathError(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return;
    throw error;
  }
}

export function getProjectConfigPath(repositoryRoot: string): string {
  return resolve(repositoryRoot, PROJECT_CONFIG_RELATIVE_PATH);
}

export async function projectConfigExists(repositoryRoot: string): Promise<boolean> {
  try {
    await access(getProjectConfigPath(repositoryRoot));
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false;
    throw error;
  }
}

export async function loadProjectConfig(repositoryRoot: string): Promise<ProjectConfigV1> {
  const path = getProjectConfigPath(repositoryRoot);
  try {
    return parseProjectConfig(await readFile(path, 'utf8'));
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new ConfigNotFoundError(path);
    }
    throw error;
  }
}

export async function previewProjectConfig(repositoryRoot: string): Promise<ProjectConfigPreview> {
  const discovery = await discoverProject(repositoryRoot);
  return {
    path: getProjectConfigPath(repositoryRoot),
    exists: await projectConfigExists(repositoryRoot),
    discovery,
    suggestedConfig: createSuggestedProjectConfig(discovery),
  };
}

export async function initializeProjectConfig(
  options: InitializeProjectConfigOptions,
): Promise<InitializeProjectConfigResult> {
  const path = getProjectConfigPath(options.repositoryRoot);
  const existed = await projectConfigExists(options.repositoryRoot);

  if (existed && options.force !== true) {
    throw new ConfigAlreadyExistsError(path);
  }

  const discovery =
    options.config === undefined ? await discoverProject(options.repositoryRoot) : undefined;
  const config = validateProjectConfig(
    options.config ??
      (discovery === undefined ? undefined : createSuggestedProjectConfig(discovery)),
  );

  await assertNotSymbolicPath(dirname(path));
  await mkdir(dirname(path), { recursive: true });
  await assertNotSymbolicPath(path);

  try {
    await writeFile(path, serializeProjectConfig(config), {
      encoding: 'utf8',
      flag: options.force === true ? 'w' : 'wx',
    });
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      throw new ConfigAlreadyExistsError(path);
    }
    throw error;
  }

  return {
    path,
    config,
    ...(discovery === undefined ? {} : { discovery }),
    overwritten: existed,
  };
}
