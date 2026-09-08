export type { GitCommandExecutor, GitCommandResult, RepositoryService } from './contracts.js';
export { GitParseError, RepositoryError } from './errors.js';
export type { RepositoryErrorCode } from './errors.js';
export {
  discoverRepositoryRoot,
  GitRepositoryService,
  inspectRepository,
} from './git-repository.js';
export { SystemGitCommandExecutor } from './git-executor.js';
export type { SystemGitCommandExecutorOptions } from './git-executor.js';
export { parseNumstatZ, parsePorcelainV2 } from './parsers.js';
export type {
  GitNumstatEntry,
  ParsedPorcelainV2,
  PorcelainBranch,
  PorcelainFileEntry,
} from './parsers.js';
