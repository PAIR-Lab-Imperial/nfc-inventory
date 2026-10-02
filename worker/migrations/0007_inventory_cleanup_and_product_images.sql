PRAGMA foreign_keys = ON;

-- CAM-005 was entered in error and never represented a lab asset.
UPDATE proposals
SET received_equipment_id = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE received_equipment_id = (
  SELECT id FROM equipment WHERE asset_code = 'CAM-005' COLLATE NOCASE
);

DELETE FROM reservations
WHERE equipment_id = (SELECT id FROM equipment WHERE asset_code = 'CAM-005' COLLATE NOCASE);

DELETE FROM checkouts
WHERE equipment_id = (SELECT id FROM equipment WHERE asset_code = 'CAM-005' COLLATE NOCASE);

DELETE FROM nfc_labels
WHERE equipment_id = (SELECT id FROM equipment WHERE asset_code = 'CAM-005' COLLATE NOCASE);

DELETE FROM equipment
WHERE asset_code = 'CAM-005' COLLATE NOCASE;

UPDATE equipment
SET primary_photo_url = CASE
  WHEN asset_code IN ('TAB-001', 'TAB-002') THEN 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/lenovo-tab-m10-gen3.jpg'
  WHEN asset_code IN ('MON-001', 'MON-002', 'MON-003') THEN 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/lg-27mr400-b.jpg'
  WHEN asset_code IN ('NET-001', 'NET-002', 'NET-003') THEN 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/tp-link-archer-ax1500.jpg'
  WHEN asset_code IN ('NET-004', 'NET-005') THEN 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/tp-link-tl-wr841n.jpg'
  WHEN asset_code IN ('PER-001', 'PER-002', 'PER-003', 'PER-004', 'PER-005') THEN 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/logitech-mk270.png'
  WHEN asset_code = 'LGT-005' THEN 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/ikea-tokabo.jpg'
  ELSE primary_photo_url
END,
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE asset_code IN (
  'TAB-001', 'TAB-002',
  'MON-001', 'MON-002', 'MON-003',
  'NET-001', 'NET-002', 'NET-003', 'NET-004', 'NET-005',
  'PER-001', 'PER-002', 'PER-003', 'PER-004', 'PER-005',
  'LGT-005'
);

UPDATE bundle_components
SET photo_url = 'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment/logitech-mk270.png',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE equipment_id IN (
  SELECT id
  FROM equipment
  WHERE asset_code IN ('PER-001', 'PER-002', 'PER-003', 'PER-004', 'PER-005')
);
