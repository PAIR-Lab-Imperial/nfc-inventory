ALTER TABLE equipment
  ADD COLUMN availability_override TEXT
  CHECK (
    availability_override IS NULL
    OR availability_override = 'not_unboxed'
  );

DROP VIEW equipment_current_state;

CREATE VIEW equipment_current_state AS
SELECT
  e.id AS equipment_id,
  CASE
    WHEN e.lifecycle_status <> 'active' THEN e.lifecycle_status
    WHEN e.availability_override = 'not_unboxed' THEN 'not_unboxed'
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

