CREATE TABLE admin_login_attempts (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX admin_login_attempts_updated_idx
  ON admin_login_attempts(updated_at);
