CREATE TABLE r2_usage_counters (
  metric TEXT NOT NULL CHECK (metric IN ('class_a_upload', 'class_b_read')),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (metric, period)
) STRICT;
