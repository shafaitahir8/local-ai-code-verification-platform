import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import { initialMigration } from './0001-initial.js';
import { approvalReceiptsMigration } from './0002-approval-receipts.js';

const migrations = [initialMigration, approvalReceiptsMigration] as const;

interface AppliedMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export interface AppliedStorageMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface StorageMigrationResult {
  readonly applied: readonly AppliedStorageMigration[];
  readonly currentVersion: number;
}

export class StorageMigrationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageMigrationError';
  }
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function isAppliedMigrationRow(value: unknown): value is AppliedMigrationRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.version === 'number' &&
    typeof row.name === 'string' &&
    typeof row.checksum === 'string'
  );
}

/** Applies the package's ordered forward-only migrations in a transaction per migration. */
export function runStorageMigrations(database: Database.Database): StorageMigrationResult {
  database.exec(`
    CREATE TABLE IF NOT EXISTS __verify_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersion = migrations.at(-1)?.version ?? 0;
  const knownVersions = new Set<number>(migrations.map((migration) => migration.version));

  const migrate = database.transaction((): StorageMigrationResult => {
    const rawRows: unknown[] = database
      .prepare('SELECT version, name, checksum FROM __verify_migrations ORDER BY version ASC')
      .all();

    if (!rawRows.every(isAppliedMigrationRow)) {
      throw new StorageMigrationError('The storage migration ledger is malformed.');
    }

    const unsupported = rawRows.find((row) => !knownVersions.has(row.version));
    if (unsupported !== undefined) {
      throw new StorageMigrationError(
        `Storage migration version ${unsupported.version} is not supported by this application (latest supported: ${currentVersion}).`,
      );
    }

    const appliedByVersion = new Map(rawRows.map((row) => [row.version, row]));
    const applied: AppliedStorageMigration[] = [];

    for (const migration of migrations) {
      const migrationChecksum = checksum(migration.sql);
      const existing = appliedByVersion.get(migration.version);

      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== migrationChecksum) {
          throw new StorageMigrationError(
            `Migration ${migration.version} (${migration.name}) does not match the applied checksum.`,
          );
        }
        continue;
      }

      const appliedAt = new Date().toISOString();
      try {
        database.exec(migration.sql);
        database
          .prepare(
            `INSERT INTO __verify_migrations (version, name, checksum, applied_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(migration.version, migration.name, migrationChecksum, appliedAt);
      } catch (error) {
        throw new StorageMigrationError(
          `Could not apply storage migration ${migration.version} (${migration.name}).`,
          { cause: error },
        );
      }

      applied.push({
        version: migration.version,
        name: migration.name,
        checksum: migrationChecksum,
        appliedAt,
      });
    }

    return { applied, currentVersion };
  });

  try {
    return migrate.immediate();
  } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    throw new StorageMigrationError('Could not acquire the storage migration lock.', {
      cause: error,
    });
  }
}
