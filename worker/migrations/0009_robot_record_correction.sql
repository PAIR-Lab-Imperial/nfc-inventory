PRAGMA foreign_keys = ON;

-- ROB-005 was entered in error. Preserve complete audit snapshots before
-- removing it and its operational associations, so the correction remains
-- recoverable even though the mistaken live record is removed.
INSERT INTO audit_events (
  id,
  actor_type,
  actor_name,
  action,
  entity_type,
  entity_id,
  before_json
)
SELECT
  '10f4af23-539a-4c28-a2be-5683501e96a2',
  'admin',
  'record-correction',
  'equipment.deleted_as_error',
  'equipment',
  id,
  json_object(
    'assetCode', asset_code,
    'name', name,
    'categoryId', category_id,
    'itemType', item_type,
    'manufacturer', manufacturer,
    'model', model,
    'serialNumber', serial_number,
    'publicSpecifications', public_specifications,
    'location', location,
    'condition', condition,
    'lifecycleStatus', lifecycle_status,
    'purchaseDate', purchase_date,
    'purchasePriceMinor', purchase_price_minor,
    'currency', currency,
    'supplier', supplier,
    'publicNotes', public_notes,
    'adminNotes', admin_notes,
    'recordVersion', record_version,
    'primaryPhotoUrl', primary_photo_url,
    'availabilityOverride', availability_override,
    'createdAt', created_at,
    'updatedAt', updated_at
  )
FROM equipment
WHERE asset_code = 'ROB-005' COLLATE NOCASE;

INSERT INTO audit_events (
  id, actor_type, actor_name, action, entity_type, entity_id, before_json
)
SELECT
  'record-correction-component-' || bc.id,
  'admin',
  'record-correction',
  'bundle_component.deleted_with_incorrect_equipment',
  'bundle_component',
  bc.id,
  json_object(
    'equipmentId', bc.equipment_id,
    'componentName', bc.component_name,
    'manufacturer', bc.manufacturer,
    'model', bc.model,
    'serialNumber', bc.serial_number,
    'quantity', bc.quantity,
    'requiredOnReturn', bc.required_on_return,
    'notes', bc.notes,
    'displayOrder', bc.display_order,
    'photoUrl', bc.photo_url,
    'createdAt', bc.created_at,
    'updatedAt', bc.updated_at
  )
FROM bundle_components bc
JOIN equipment e ON e.id = bc.equipment_id
WHERE e.asset_code = 'ROB-005' COLLATE NOCASE;

INSERT INTO audit_events (
  id, actor_type, actor_name, action, entity_type, entity_id, before_json
)
SELECT
  'record-correction-label-' || n.id,
  'admin',
  'record-correction',
  'nfc_label.deleted_with_incorrect_equipment',
  'nfc_label',
  n.id,
  json_object(
    'equipmentId', n.equipment_id,
    'tokenHash', n.token_hash,
    'tokenHint', n.token_hint,
    'status', n.status,
    'notes', n.notes,
    'scanUrl', n.scan_url,
    'writtenAt', n.written_at,
    'writtenBy', n.written_by,
    'createdAt', n.created_at,
    'retiredAt', n.retired_at
  )
FROM nfc_labels n
JOIN equipment e ON e.id = n.equipment_id
WHERE e.asset_code = 'ROB-005' COLLATE NOCASE;

INSERT INTO audit_events (
  id, actor_type, actor_name, action, entity_type, entity_id, before_json
)
SELECT
  'record-correction-reservation-' || r.id,
  'admin',
  'record-correction',
  'reservation.deleted_with_incorrect_equipment',
  'reservation',
  r.id,
  json_object(
    'equipmentId', r.equipment_id,
    'memberId', r.member_id,
    'startsAt', r.starts_at,
    'endsAt', r.ends_at,
    'canShare', r.can_share,
    'sharingNotes', r.sharing_notes,
    'status', r.status,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  )
FROM reservations r
JOIN equipment e ON e.id = r.equipment_id
WHERE e.asset_code = 'ROB-005' COLLATE NOCASE;

INSERT INTO audit_events (
  id, actor_type, actor_name, action, entity_type, entity_id, before_json
)
SELECT
  'record-correction-checkout-' || c.id,
  'admin',
  'record-correction',
  'checkout.deleted_with_incorrect_equipment',
  'checkout',
  c.id,
  json_object(
    'equipmentId', c.equipment_id,
    'memberId', c.member_id,
    'checkedOutAt', c.checked_out_at,
    'expectedReturnAt', c.expected_return_at,
    'returnedAt', c.returned_at,
    'checkoutNotes', c.checkout_notes,
    'returnNotes', c.return_notes,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at
  )
FROM checkouts c
JOIN equipment e ON e.id = c.equipment_id
WHERE e.asset_code = 'ROB-005' COLLATE NOCASE;

INSERT INTO audit_events (
  id, actor_type, actor_name, action, entity_type, entity_id, before_json
)
SELECT
  'record-correction-file-' || f.id,
  'admin',
  'record-correction',
  'equipment_file.deleted_with_incorrect_equipment',
  'equipment_file',
  f.id,
  json_object(
    'equipmentId', f.equipment_id,
    'kind', f.kind,
    'visibility', f.visibility,
    'storageKey', f.storage_key,
    'externalUrl', f.external_url,
    'filename', f.filename,
    'description', f.description,
    'createdAt', f.created_at
  )
FROM equipment_files f
JOIN equipment e ON e.id = f.equipment_id
WHERE e.asset_code = 'ROB-005' COLLATE NOCASE;

INSERT INTO audit_events (
  id, actor_type, actor_name, action, entity_type, entity_id, before_json
)
SELECT
  'record-correction-proposal-' || p.id,
  'admin',
  'record-correction',
  'proposal.received_equipment_unlinked',
  'proposal',
  p.id,
  json_object(
    'receivedEquipmentId', p.received_equipment_id,
    'status', p.status,
    'updatedAt', p.updated_at
  )
FROM proposals p
JOIN equipment e ON e.id = p.received_equipment_id
WHERE e.asset_code = 'ROB-005' COLLATE NOCASE;

UPDATE proposals
SET received_equipment_id = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE received_equipment_id = (
  SELECT id FROM equipment WHERE asset_code = 'ROB-005' COLLATE NOCASE
);

DELETE FROM reservations
WHERE equipment_id = (SELECT id FROM equipment WHERE asset_code = 'ROB-005' COLLATE NOCASE);

DELETE FROM checkouts
WHERE equipment_id = (SELECT id FROM equipment WHERE asset_code = 'ROB-005' COLLATE NOCASE);

DELETE FROM nfc_labels
WHERE equipment_id = (SELECT id FROM equipment WHERE asset_code = 'ROB-005' COLLATE NOCASE);

DELETE FROM equipment
WHERE asset_code = 'ROB-005' COLLATE NOCASE;

-- The real robot previously recorded as ROB-003 becomes ROB-005. Its stable
-- equipment id is retained, so its bundle, files and NFC history remain linked.
INSERT INTO audit_events (
  id,
  actor_type,
  actor_name,
  action,
  entity_type,
  entity_id,
  before_json,
  after_json
)
SELECT
  'e19d196d-78e3-41f7-b835-5574ec57a85f',
  'admin',
  'record-correction',
  'equipment.asset_code_changed',
  'equipment',
  id,
  json_object('assetCode', 'ROB-003', 'name', name),
  json_object('assetCode', 'ROB-005', 'name', name)
FROM equipment
WHERE asset_code = 'ROB-003' COLLATE NOCASE;

UPDATE equipment
SET asset_code = 'ROB-005',
    record_version = record_version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE asset_code = 'ROB-003' COLLATE NOCASE;

-- Reuse ROB-003 for the retired NAO Robot as explicitly requested.
INSERT INTO equipment (
  id,
  asset_code,
  name,
  category_id,
  item_type,
  lifecycle_status,
  currency,
  primary_photo_url
)
SELECT
  'd1d0ec4d-ab0b-40f2-9fd3-d90816f37825',
  'ROB-003',
  'NAO Robot',
  id,
  'individual',
  'retired',
  'GBP',
  'https://pair-lab-imperial.github.io/nfc-inventory/assets/equipment-placeholder.svg'
FROM categories
WHERE asset_code_prefix = 'ROB' COLLATE NOCASE;

INSERT INTO audit_events (
  id,
  actor_type,
  actor_name,
  action,
  entity_type,
  entity_id,
  after_json
)
SELECT
  'a9a21853-7a15-43f5-9b7a-b6db3f059b53',
  'admin',
  'record-correction',
  'equipment.created',
  'equipment',
  id,
  json_object(
    'assetCode', asset_code,
    'name', name,
    'lifecycleStatus', lifecycle_status
  )
FROM equipment
WHERE asset_code = 'ROB-003' COLLATE NOCASE;
