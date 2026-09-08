import { describe, expect, it } from 'vitest';

import { GitParseError, parseNumstatZ, parsePorcelainV2 } from '../src/index.js';

describe('parsePorcelainV2', () => {
  it('parses branch metadata and every MVP change category', () => {
    const output = [
      '# branch.oid abcdef123456',
      '# branch.head feature/login',
      '# branch.upstream origin/feature/login',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb src/staged.ts',
      '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/unstaged file.ts',
      '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new name.ts',
      'src/old name.ts',
      'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/conflict.ts',
      '? notes/new file.txt',
      '',
    ].join('\0');

    const parsed = parsePorcelainV2(output);

    expect(parsed.branch).toEqual({
      oid: 'abcdef123456',
      head: 'feature/login',
      upstream: 'origin/feature/login',
      ahead: 2,
      behind: 1,
    });
    expect(parsed.files).toMatchObject([
      { path: 'src/staged.ts', status: 'modified', staged: true, unstaged: false },
      { path: 'src/unstaged file.ts', status: 'modified', staged: false, unstaged: true },
      {
        path: 'src/new name.ts',
        originalPath: 'src/old name.ts',
        status: 'renamed',
        staged: true,
        unstaged: false,
      },
      { path: 'src/conflict.ts', status: 'conflicted', staged: true, unstaged: true },
      {
        path: 'notes/new file.txt',
        status: 'untracked',
        staged: false,
        unstaged: true,
      },
    ]);
  });

  it('represents detached and unborn branch metadata without inventing a name', () => {
    expect(
      parsePorcelainV2('# branch.oid deadbeef\0# branch.head (detached)\0').branch,
    ).toMatchObject({ oid: 'deadbeef', head: null });
    expect(parsePorcelainV2('# branch.oid (initial)\0# branch.head main\0').branch).toMatchObject({
      oid: '(initial)',
      head: 'main',
    });
  });

  it('supports newline-delimited porcelain samples used by diagnostics', () => {
    const parsed = parsePorcelainV2(
      '# branch.oid abc\n# branch.head main\n1 A. N... 000000 100644 100644 0000000 abc file.ts\n',
    );
    expect(parsed.files[0]).toMatchObject({ path: 'file.ts', status: 'added' });
  });

  it('fails explicitly on malformed or unknown records', () => {
    expect(() => parsePorcelainV2('1 malformed\0')).toThrowError(GitParseError);
    expect(() => parsePorcelainV2('x future-record\0')).toThrow(/Unknown porcelain-v2 record/u);
    expect(() => parsePorcelainV2('2 R. N... 100644 100644 100644 a b R100 new.ts\0')).toThrow(
      /no original path/u,
    );
  });
});

describe('parseNumstatZ', () => {
  it('parses text, binary, spaces, and rename records', () => {
    const output = [
      '12\t3\tsrc/file with spaces.ts',
      '-\t-\tassets/logo.png',
      '4\t1\t',
      'src/old.ts',
      'src/new.ts',
      '',
    ].join('\0');

    expect(parseNumstatZ(output)).toEqual([
      {
        path: 'src/file with spaces.ts',
        additions: 12,
        deletions: 3,
        binary: false,
      },
      {
        path: 'assets/logo.png',
        additions: null,
        deletions: null,
        binary: true,
      },
      {
        path: 'src/new.ts',
        originalPath: 'src/old.ts',
        additions: 4,
        deletions: 1,
        binary: false,
      },
    ]);
  });

  it('distinguishes known zero counts from binary or malformed counts', () => {
    expect(parseNumstatZ('0\t0\tempty.txt\0')[0]).toMatchObject({
      additions: 0,
      deletions: 0,
      binary: false,
    });
    expect(() => parseNumstatZ('-\t1\tbroken.bin\0')).toThrow(/binary markers/u);
    expect(() => parseNumstatZ('many\t1\tbroken.txt\0')).toThrow(/Malformed numstat/u);
  });
});
