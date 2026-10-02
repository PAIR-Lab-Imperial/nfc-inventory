ALTER TABLE nfc_labels
  ADD COLUMN scan_url TEXT
  CHECK (
    scan_url IS NULL
    OR scan_url LIKE 'http://%'
    OR scan_url LIKE 'https://%'
  );

-- The current pilot associations use deterministic demo tokens, so their URLs
-- can be reconstructed without replacing the active labels.
UPDATE nfc_labels
SET scan_url = 'https://pair-lab-imperial.github.io/nfc-inventory/?t=demo-'
  || lower((SELECT equipment.asset_code FROM equipment WHERE equipment.id = nfc_labels.equipment_id))
  || '-v1'
WHERE scan_url IS NULL
  AND notes = 'Temporary dummy NFC association';

CREATE UNIQUE INDEX nfc_labels_scan_url_idx
  ON nfc_labels(scan_url)
  WHERE scan_url IS NOT NULL;
