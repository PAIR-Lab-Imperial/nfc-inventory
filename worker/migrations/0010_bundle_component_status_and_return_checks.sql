ALTER TABLE bundle_components
  ADD COLUMN operational_status TEXT NOT NULL DEFAULT 'available'
  CHECK (operational_status IN ('available', 'not_unboxed', 'maintenance', 'missing', 'retired'));

ALTER TABLE checkouts
  ADD COLUMN return_component_check_json TEXT
  CHECK (return_component_check_json IS NULL OR json_valid(return_component_check_json));
