SELECT 'categories' AS entity, COUNT(*) AS record_count FROM categories
UNION ALL
SELECT 'equipment', COUNT(*) FROM equipment
UNION ALL
SELECT 'bundle_components', COUNT(*) FROM bundle_components
UNION ALL
SELECT 'members', COUNT(*) FROM members
UNION ALL
SELECT 'active_nfc_labels', COUNT(*) FROM nfc_labels WHERE status = 'active'
UNION ALL
SELECT 'equipment_files', COUNT(*) FROM equipment_files
ORDER BY entity;
