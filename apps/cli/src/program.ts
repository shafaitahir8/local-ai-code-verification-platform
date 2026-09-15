import { Command, CommanderError, Option } from 'commander';

import type { VerifierApplication } from '@verify/core';
import type { ProjectProfileProgress } from '@verify/domain';
import type { VerificationLifecycleEvent } from '@verify/verification';

import { exitCodeForRun, EXIT_CODES } from './exit-codes.js';
import {
  formatCheckResult,
  formatGate,
  formatInspection,
  formatProjectProfile,
  formatRun,
  formatVerificationPlanPreview,
} from './format.js';
import { serveProtocol } from './protocol-server.js';

export interface CliIo {
  writeOut(value: string): void;
  writeError(value: string): void;
  setExitCode(code: number): void;
}

export interface CliContext {
  readonly application: VerifierApplication;
  readonly io: CliIo;
}

interface JsonOption {
  readonly json?: boolean;
}

function line(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function writeJson(io: CliIo, value: unknown): void {
  io.writeOut(`${JSON.stringify(value)}\n`);
}

function progressWriter(io: CliIo): (event: VerificationLifecycleEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'check.started':
        io.writeOut(line(`Running ${event.check.name}: ${event.check.command}`));
        break;
      case 'check.output':
        if (event.stream === 'stderr') io.writeError(event.chunk);
        else io.writeOut(event.chunk);
        break;
      case 'check.completed':
        io.writeOut(line(formatCheckResult(event.result)));
        break;
    }
  };
}

function profileProgressWriter(io: CliIo): (progress: ProjectProfileProgress) => void {
  return (progress) => {
    io.writeOut(line(`${progress.message} (${progress.entriesScanned} entries)`));
  };
}

export function createProgram(context: CliContext): Command {
  const { application, io } = context;
  const program = new Command();
  program
    .name('verify')
    .description('Local-first deterministic code verification')
    .version('0.1.0')
    .showSuggestionAfterError()
    .configureOutput({
      writeOut: (value) => io.writeOut(value),
      writeErr: (value) => io.writeError(value),
    });

  program
    .command('init')
    .description('Discover project checks and initialize .verify/project.yml')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--force', 'replace an existing configuration after explicit confirmation')
    .option('--json', 'emit stable machine-readable JSON')
    .action(async (repository: string, options: JsonOption & { force?: boolean }) => {
      const result = await application.initializeProject({
        repository,
        force: options.force === true,
      });
      if (options.json === true) {
        writeJson(io, result);
        return;
      }
      io.writeOut(line(`${result.overwritten ? 'Replaced' : 'Initialized'} ${result.path}`));
      const suites = Object.entries(result.config.suites);
      if (suites.length === 0) {
        io.writeOut(
          line('No safe verification commands were detected; review the YAML before run.'),
        );
      } else {
        io.writeOut(line('Configured checks:'));
        for (const [name, suite] of suites) {
          io.writeOut(line(`  ${name}: ${suite.command} (${suite.failure_policy})`));
        }
      }
    });

  program
    .command('discover')
    .description('Inspect project markers and suggest checks without writing configuration')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--json', 'emit stable machine-readable JSON')
    .action(async (repository: string, options: JsonOption) => {
      const discovery = await application.discover(repository);
      if (options.json === true) writeJson(io, discovery);
      else {
        io.writeOut(line(`Project: ${discovery.projectName}`));
        io.writeOut(line(`Detected: ${discovery.projectTypes.join(', ') || 'generic'}`));
        for (const suite of discovery.suggestedSuites) {
          io.writeOut(line(`  ${suite.id}: ${suite.command} — ${suite.reason}`));
        }
        for (const warning of discovery.warnings) io.writeError(line(`Warning: ${warning}`));
      }
    });

  program
    .command('understand')
    .description('Build a deterministic, read-only profile of the project')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--json', 'emit the protocol-equivalent profile result as JSON')
    .action(async (repository: string, options: JsonOption) => {
      const controller = new AbortController();
      const handleInterrupt = (): void => controller.abort();
      process.once('SIGINT', handleInterrupt);
      try {
        const result = await application.profileProject({
          repository,
          signal: controller.signal,
          ...(options.json === true ? {} : { onProgress: profileProgressWriter(io) }),
        });
        if (options.json === true) writeJson(io, result);
        else if (result.status === 'completed') {
          io.writeOut(line(formatProjectProfile(result.profile)));
        } else {
          io.writeError(line('Project understanding cancelled.'));
        }
        if (result.status === 'cancelled') io.setExitCode(EXIT_CODES.interrupted);
      } finally {
        process.removeListener('SIGINT', handleInterrupt);
      }
    });

  program
    .command('plan')
    .description('Preview deterministic Quick and Full verification plans without executing them')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--json', 'emit the protocol-equivalent plan preview result as JSON')
    .action(async (repository: string, options: JsonOption) => {
      const controller = new AbortController();
      const handleInterrupt = (): void => controller.abort();
      process.once('SIGINT', handleInterrupt);
      try {
        const result = await application.previewVerificationPlans({
          repository,
          signal: controller.signal,
          ...(options.json === true ? {} : { onProgress: profileProgressWriter(io) }),
        });
        if (options.json === true) writeJson(io, result);
        else if (result.status === 'completed') {
          io.writeOut(line(formatVerificationPlanPreview(result.preview)));
        } else {
          io.writeError(line('Verification plan preview cancelled.'));
        }
        if (result.status === 'cancelled') io.setExitCode(EXIT_CODES.interrupted);
      } finally {
        process.removeListener('SIGINT', handleInterrupt);
      }
    });

  program
    .command('inspect')
    .description('Inspect the current Git branch and working-tree changes')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--json', 'emit stable machine-readable JSON')
    .action(async (repository: string, options: JsonOption) => {
      const inspection = await application.inspectRepository(repository);
      if (options.json === true) writeJson(io, inspection);
      else io.writeOut(line(formatInspection(inspection)));
    });

  program
    .command('run')
    .description('Execute configured checks, persist evidence, and evaluate the quality gate')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--json', 'emit one stable JSON result without progress on stdout')
    .action(async (repository: string, options: JsonOption) => {
      const controller = new AbortController();
      const handleInterrupt = (): void => controller.abort();
      process.once('SIGINT', handleInterrupt);
      try {
        const run = await application.runVerification({
          repository,
          signal: controller.signal,
          ...(options.json === true ? {} : { onEvent: progressWriter(io) }),
        });
        if (options.json === true) writeJson(io, run);
        else io.writeOut(line(formatRun(run)));
        io.setExitCode(exitCodeForRun(run));
      } finally {
        process.removeListener('SIGINT', handleInterrupt);
      }
    });

  program
    .command('gate')
    .description('Return the latest persisted quality gate')
    .argument('[repository]', 'path inside the Git repository', '.')
    .option('--json', 'emit stable machine-readable JSON')
    .action(async (repository: string, options: JsonOption) => {
      const run = await application.getLatestRun(repository);
      if (run.gate === undefined) throw new Error(`Run ${run.id} has no quality gate result.`);
      if (options.json === true) writeJson(io, run.gate);
      else io.writeOut(line(formatGate(run.gate)));
      io.setExitCode(exitCodeForRun(run));
    });

  program
    .command('history')
    .description('List recent persisted verification runs')
    .argument('[repository]', 'path inside the Git repository', '.')
    .addOption(
      new Option('-n, --limit <count>', 'maximum runs to return')
        .default(20)
        .argParser((value) => Number.parseInt(value, 10)),
    )
    .option('--json', 'emit stable machine-readable JSON')
    .action(async (repository: string, options: JsonOption & { limit: number }) => {
      const runs = await application.getRunHistory(repository, options.limit);
      if (options.json === true) writeJson(io, runs);
      else if (runs.length === 0) io.writeOut(line('No verification runs found.'));
      else {
        for (const run of runs) {
          io.writeOut(
            line(
              `${run.startedAt}  ${run.gate?.status ?? 'NO GATE'}  ${run.checks.length} checks  ${run.id}`,
            ),
          );
        }
      }
    });

  program
    .command('protocol')
    .description('Serve protocol version 1 over newline-delimited stdin/stdout')
    .action(async () => {
      await serveProtocol(application, io);
    });

  program.exitOverride();
  return program;
}

export async function executeCli(argv: readonly string[], context: CliContext): Promise<number> {
  context.io.setExitCode(EXIT_CODES.success);
  try {
    await createProgram(context).parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === EXIT_CODES.success) {
      return EXIT_CODES.success;
    }
    throw error;
  }
  return typeof process.exitCode === 'number'
    ? process.exitCode
    : Number(process.exitCode ?? EXIT_CODES.success);
}
