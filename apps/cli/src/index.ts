import { createApplicationComposition } from './composition.js';
import { EXIT_CODES } from './exit-codes.js';
import { formatError } from './format.js';
import { executeCli, type CliIo } from './program.js';

const io: CliIo = {
  writeOut: (value) => process.stdout.write(value),
  writeError: (value) => process.stderr.write(value),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

const composition = createApplicationComposition();

try {
  await executeCli(process.argv.slice(2), {
    application: composition.application,
    io,
  });
} catch (error) {
  process.exitCode = EXIT_CODES.error;
  const json = process.argv.includes('--json');
  if (json) {
    io.writeOut(
      `${JSON.stringify({
        error: {
          code: 'VERIFY_ERROR',
          message: formatError(error),
        },
      })}\n`,
    );
  } else {
    io.writeError(`Error: ${formatError(error)}\n`);
  }
} finally {
  composition.close();
}
