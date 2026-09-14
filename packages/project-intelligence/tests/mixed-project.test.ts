import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';

const mixedFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/mixed-node-python/', import.meta.url),
);

async function snapshot(
  directory: string,
  relative = '',
): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {};
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(result, await snapshot(directory, path));
    } else if (entry.isFile()) {
      const content = await readFile(join(directory, ...path.split('/')));
      result[path] = createHash('sha256').update(content).digest('hex');
    }
  }
  return result;
}

describe('mixed Node and Python profiling', () => {
  it('retains both ecosystems and reports test-framework ambiguity without selecting one', async () => {
    const before = await snapshot(mixedFixtureRoot);
    const result = await new FileSystemProjectProfiler().profile({
      repositoryRoot: mixedFixtureRoot,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'language.python',
        'package-manager.npm',
        'runtime.node',
        'runtime.python',
        'test-framework.pytest',
        'test-framework.vitest',
      ]),
    );
    expect(result.profile.ambiguities).toEqual([
      expect.objectContaining({
        code: 'MULTIPLE_TEST_FRAMEWORKS',
        candidateIds: ['test-framework.pytest', 'test-framework.vitest'],
      }),
    ]);
    expect(result.profile.taskCandidates).toEqual([
      expect.objectContaining({ kind: 'test', command: 'vitest run', workingDirectory: '.' }),
    ]);
    expect(result.profile).not.toHaveProperty('selectedWorkspaceId');
    expect(result.profile).not.toHaveProperty('selectedTaskId');
    expect(await snapshot(mixedFixtureRoot)).toEqual(before);
  });
});
