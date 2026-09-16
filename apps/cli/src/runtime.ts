import { ConfigMigrationStaleError } from '@verify/config';

import { createApplicationComposition, type ApplicationComposition } from './composition.js';
import { EXIT_CODES } from './exit-codes.js';
import { formatError } from './format.js';
import { executeCli, type CliIo } from './program.js';

export interface CliRuntimeOptions {
  readonly argv?: readonly string[];
  readonly io?: CliIo;
  readonly createComposition?: () => ApplicationComposition;
}

function createProcessIo(): CliIo {
  return {
    writeOut: (value) => process.stdout.write(value),
    writeError: (value) => process.stderr.write(value),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

/** Runs the CLI against an injectable composition root and always closes owned resources. */
export async function runCli(options: CliRuntimeOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const io = options.io ?? createProcessIo();
  let composition: ApplicationComposition | undefined;

  try {
    composition = (options.createComposition ?? createApplicationComposition)();
    return await executeCli(argv, {
      application: composition.application,
      io,
    });
  } catch (error) {
    io.setExitCode(EXIT_CODES.error);
    if (argv.includes('--json')) {
      io.writeOut(
        `${JSON.stringify({
          error: {
            code: error instanceof ConfigMigrationStaleError ? 'MIGRATION_STALE' : 'VERIFY_ERROR',
            message: formatError(error),
          },
        })}\n`,
      );
    } else {
      io.writeError(`Error: ${formatError(error)}\n`);
    }
    return EXIT_CODES.error;
  } finally {
    composition?.close();
  }
}
