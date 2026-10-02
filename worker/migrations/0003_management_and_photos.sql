ALTER TABLE equipment
  ADD COLUMN primary_photo_url TEXT
  CHECK (
    primary_photo_url IS NULL
    OR primary_photo_url LIKE 'http://%'
    OR primary_photo_url LIKE 'https://%'
  );

ALTER TABLE bundle_components
  ADD COLUMN photo_url TEXT
  CHECK (
    photo_url IS NULL
    OR photo_url LIKE 'http://%'
    OR photo_url LIKE 'https://%'
  );
