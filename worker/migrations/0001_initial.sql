PRAGMA foreign_keys = ON;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  asset_code_prefix TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  item_type TEXT NOT NULL CHECK (item_type IN ('individual', 'bundle')),
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  public_specifications TEXT,
  location TEXT,
  condition TEXT CHECK (condition IS NULL OR condition IN ('good', 'fair', 'damaged', 'unknown')),
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'maintenance', 'missing', 'retired')),
  purchase_date TEXT,
  purchase_price_minor INTEGER CHECK (purchase_price_minor IS NULL OR purchase_price_minor >= 0),
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  supplier TEXT,
  public_notes TEXT,
  admin_notes TEXT,
  record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX equipment_category_idx ON equipment(category_id);
CREATE INDEX equipment_lifecycle_idx ON equipment(lifecycle_status);
CREATE INDEX equipment_name_idx ON equipment(name COLLATE NOCASE);

CREATE TABLE bundle_components (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  required_on_return INTEGER NOT NULL DEFAULT 1 CHECK (required_on_return IN (0, 1)),
  notes TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (equipment_id, component_name)
) STRICT;

CREATE INDEX bundle_components_equipment_idx ON bundle_components(equipment_id, display_order);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE nfc_labels (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'lost', 'replaced', 'retired')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  retired_at TEXT
) STRICT;

CREATE UNIQUE INDEX one_active_label_per_equipment_idx
  ON nfc_labels(equipment_id)
  WHERE status = 'active';
CREATE INDEX nfc_labels_equipment_idx ON nfc_labels(equipment_id, created_at);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  can_share INTEGER NOT NULL DEFAULT 0 CHECK (can_share IN (0, 1)),
  sharing_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
) STRICT;

CREATE INDEX reservations_equipment_time_idx
  ON reservations(equipment_id, status, starts_at, ends_at);
CREATE INDEX reservations_member_idx ON reservations(member_id, status, starts_at);

CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  checked_out_at TEXT NOT NULL,
  expected_return_at TEXT,
  returned_at TEXT,
  checkout_notes TEXT,
  return_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expected_return_at IS NULL OR expected_return_at > checked_out_at),
  CHECK (returned_at IS NULL OR returned_at >= checked_out_at)
) STRICT;

CREATE UNIQUE INDEX one_open_checkout_per_equipment_idx
  ON checkouts(equipment_id)
  WHERE returned_at IS NULL;
CREATE INDEX checkouts_member_open_idx ON checkouts(member_id, returned_at);

CREATE TABLE equipment_files (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('photo', 'manual', 'certificate', 'receipt', 'record', 'other')),
  visibility TEXT NOT NULL DEFAULT 'admin' CHECK (visibility IN ('public', 'admin')),
  storage_key TEXT,
  external_url TEXT,
  filename TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (storage_key IS NOT NULL OR external_url IS NOT NULL)
) STRICT;

CREATE INDEX equipment_files_equipment_idx ON equipment_files(equipment_id, kind);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  requirement TEXT NOT NULL,
  requested_by_member_id TEXT REFERENCES members(id),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'ordered', 'received')),
  selected_option_id TEXT REFERENCES proposal_options(id) ON DELETE SET NULL,
  received_equipment_id TEXT REFERENCES equipment(id),
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE proposal_options (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_url TEXT NOT NULL,
  supplier TEXT,
  quoted_price_minor INTEGER CHECK (quoted_price_minor IS NULL OR quoted_price_minor >= 0),
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  notes TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX proposal_options_proposal_idx ON proposal_options(proposal_id, display_order);
CREATE INDEX proposals_status_idx ON proposals(status, updated_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'member', 'system')),
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id, created_at);
CREATE INDEX audit_events_created_idx ON audit_events(created_at);

CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  storage_key TEXT,
  checksum TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE VIEW equipment_current_state AS
SELECT
  e.id AS equipment_id,
  CASE
    WHEN e.lifecycle_status <> 'active' THEN e.lifecycle_status
    WHEN EXISTS (
      SELECT 1 FROM checkouts c
      WHERE c.equipment_id = e.id AND c.returned_at IS NULL
    ) THEN 'in_use'
    WHEN EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.equipment_id = e.id
        AND r.status = 'active'
        AND r.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND (r.ends_at IS NULL OR r.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) THEN 'reserved'
    ELSE 'free'
  END AS availability
FROM equipment e;
