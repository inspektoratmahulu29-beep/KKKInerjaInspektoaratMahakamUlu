CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  at TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS revision_state (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS import_log (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  sheet_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_log_created_at ON import_log(created_at);
CREATE INDEX IF NOT EXISTS idx_import_log_year ON import_log(year);

INSERT OR IGNORE INTO revision_state (id, revision, updated_at) VALUES ('global', 0, NULL);
