export const initialMigration = {
  version: 1,
  name: 'initial',
  sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  repository_root TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE verification_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  repository_root TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'error', 'cancelled')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  gate_status TEXT CHECK (gate_status IS NULL OR gate_status IN ('PASS', 'WARN', 'BLOCK')),
  gate_reasons_json TEXT,
  gate_evaluated_at TEXT,
  gate_summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX verification_runs_repository_started_idx
  ON verification_runs(repository_root, started_at);
CREATE INDEX verification_runs_project_idx ON verification_runs(project_id);

CREATE TABLE check_results (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  run_id TEXT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('passed', 'warning', 'failed', 'error', 'cancelled', 'skipped')
  ),
  failure_policy TEXT NOT NULL CHECK (failure_policy IN ('block', 'warn')),
  command TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  error_summary TEXT,
  UNIQUE (run_id, ordinal)
);

CREATE INDEX check_results_run_idx ON check_results(run_id);

CREATE TABLE findings (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  check_result_row_id INTEGER NOT NULL
    REFERENCES check_results(row_id) ON DELETE CASCADE ON UPDATE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  id TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message TEXT NOT NULL,
  file TEXT,
  line INTEGER CHECK (line IS NULL OR line >= 1),
  column INTEGER CHECK (column IS NULL OR column >= 1),
  rule_id TEXT,
  UNIQUE (check_result_row_id, ordinal)
);

CREATE INDEX findings_check_idx ON findings(check_result_row_id);

CREATE TABLE artifacts (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  check_result_row_id INTEGER NOT NULL
    REFERENCES check_results(row_id) ON DELETE CASCADE ON UPDATE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  name TEXT,
  metadata_json TEXT,
  UNIQUE (check_result_row_id, ordinal)
);

CREATE INDEX artifacts_check_idx ON artifacts(check_result_row_id);
`,
} as const;
