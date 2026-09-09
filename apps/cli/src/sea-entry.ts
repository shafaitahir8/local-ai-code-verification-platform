import { createApplicationComposition } from './composition.js';
import { runCli } from './runtime.js';
import { loadEmbeddedSqliteNativeBinding } from './sea-native-binding.js';

void runCli({
  // Node SEA exposes the executable in both argv[0] and argv[1], matching script argv offset.
  argv: process.argv.slice(2),
  createComposition: () =>
    createApplicationComposition({ sqliteNativeBinding: loadEmbeddedSqliteNativeBinding() }),
});
