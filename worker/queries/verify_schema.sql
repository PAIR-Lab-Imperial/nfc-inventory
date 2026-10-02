SELECT name
FROM sqlite_master
WHERE type IN ('table', 'view')
  AND name NOT LIKE '_cf_%'
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;
