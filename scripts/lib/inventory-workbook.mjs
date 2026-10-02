import { createHash } from "node:crypto";
import { readXlsx } from "./xlsx-reader.mjs";

const REQUIRED_HEADERS = Object.freeze({
  Categories: ["category", "asset_code_prefix", "description"],
  Equipment: [
    "asset_code",
    "equipment_name",
    "category",
    "item_type",
    "manufacturer",
    "model",
    "serial_number",
    "public_specifications",
    "location",
    "condition",
    "lifecycle_status",
    "purchase_date",
    "purchase_price",
    "currency",
    "supplier",
    "public_notes",
    "admin_notes",
    "manual_url",
    "certificate_reference",
    "receipt_reference",
    "record_reference",
    "photo_reference",
  ],
  "Bundle contents": [
    "asset_code",
    "component_name",
    "manufacturer",
    "model",
    "serial_number",
    "quantity",
    "required_on_return",
    "notes",
  ],
  Members: ["username", "display_name", "active", "notes"],
});

const ITEM_TYPES = new Map([
  ["individual", "individual"],
  ["bundle", "bundle"],
]);
const CONDITIONS = new Map([
  ["good", "good"],
  ["fair", "fair"],
  ["damaged", "damaged"],
  ["unknown", "unknown"],
]);
const LIFECYCLE_STATUSES = new Map([
  ["active", "active"],
  ["maintenance", "maintenance"],
  ["missing", "missing"],
  ["retired", "retired"],
]);

function cellPrimitive(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== "object") return value;
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }
  if (typeof value.text === "string") return value.text;
  if ("result" in value) return value.result;
  return String(value);
}

function textValue(value) {
  const primitive = cellPrimitive(value);
  if (primitive === null) return "";
  return String(primitive).trim();
}

function normalizedKey(value) {
  return textValue(value).toLocaleLowerCase("en-GB");
}

function readSheet(workbook, sheetName, errors) {
  const sheetRows = workbook.get(sheetName);
  if (!sheetRows) {
    errors.push({ sheet: sheetName, row: 1, field: null, message: `Missing worksheet: ${sheetName}` });
    return [];
  }

  const headers = new Map();
  for (const [columnIndex, cellValue] of (sheetRows[0] ?? []).entries()) {
    const header = textValue(cellValue);
    const columnNumber = columnIndex + 1;
    if (header) headers.set(header, columnNumber);
  }

  for (const header of REQUIRED_HEADERS[sheetName]) {
    if (!headers.has(header)) {
      errors.push({ sheet: sheetName, row: 1, field: header, message: `Missing required column: ${header}` });
    }
  }
  if (REQUIRED_HEADERS[sheetName].some((header) => !headers.has(header))) return [];

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheetRows.length; rowNumber += 1) {
    const row = sheetRows[rowNumber - 1] ?? [];
    const record = { _row: rowNumber };
    let hasValue = false;
    for (const header of REQUIRED_HEADERS[sheetName]) {
      const value = cellPrimitive(row[headers.get(header) - 1]);
      record[header] = value;
      if (textValue(value) !== "") hasValue = true;
    }
    if (hasValue) rows.push(record);
  }
  return rows;
}

function requiredText(record, field, sheet, errors) {
  const value = textValue(record[field]);
  if (!value) {
    errors.push({ sheet, row: record._row, field, message: `${field} is required` });
  }
  return value;
}

function parseEnum(record, field, values, sheet, errors, { optional = false } = {}) {
  const source = textValue(record[field]);
  if (!source && optional) return null;
  const result = values.get(source.toLocaleLowerCase("en-GB"));
  if (!result) {
    errors.push({ sheet, row: record._row, field, message: `Invalid ${field}: ${source || "(blank)"}` });
    return null;
  }
  return result;
}

function parseYesNo(record, field, sheet, errors) {
  const value = normalizedKey(record[field]);
  if (value === "yes") return 1;
  if (value === "no") return 0;
  errors.push({ sheet, row: record._row, field, message: `${field} must be Yes or No` });
  return null;
}

function isValidCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseDate(value) {
  if (value === null || value === undefined || textValue(value) === "") return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + 1;
    const day = value.getUTCDate();
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const text = textValue(value);
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    const british = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (british) match = [british[0], british[3], british[2].padStart(2, "0"), british[1].padStart(2, "0")];
  }
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!isValidCalendarDate(year, month, day)) return undefined;
  return `${yearText}-${monthText}-${dayText}`;
}

function parsePriceMinor(record, errors) {
  const value = cellPrimitive(record.purchase_price);
  if (value === null || value === undefined || textValue(value) === "") return null;
  const number = typeof value === "number" ? value : Number(textValue(value));
  if (!Number.isFinite(number) || number < 0) {
    errors.push({ sheet: "Equipment", row: record._row, field: "purchase_price", message: "purchase_price must be a non-negative number" });
    return null;
  }
  const minor = Math.round(number * 100);
  if (Math.abs(number * 100 - minor) > 1e-7) {
    errors.push({ sheet: "Equipment", row: record._row, field: "purchase_price", message: "purchase_price may have at most two decimal places" });
    return null;
  }
  return minor;
}

function stableImportId(namespace, value) {
  const bytes = createHash("sha256").update(`${namespace}\0${value.toLocaleLowerCase("en-GB")}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateUnique(records, field, sheet, errors) {
  const seen = new Map();
  for (const record of records) {
    const key = normalizedKey(record[field]);
    if (!key) continue;
    if (seen.has(key)) {
      errors.push({ sheet, row: record._row, field, message: `Duplicate ${field}; first used on row ${seen.get(key)}` });
    } else {
      seen.set(key, record._row);
    }
  }
}

function referenceFile(assetCode, kind, visibility, rawValue, field, row, errors) {
  const reference = textValue(rawValue);
  if (!reference) return null;
  const isUrl = /^https?:\/\//i.test(reference);
  if (field === "manual_url" && !isUrl) {
    errors.push({ sheet: "Equipment", row, field, message: "manual_url must begin with http:// or https://" });
    return null;
  }
  return {
    id: stableImportId("equipment-file", `${assetCode}/${kind}/${reference}`),
    assetCode,
    kind,
    visibility,
    storageKey: isUrl ? null : reference,
    externalUrl: isUrl ? reference : null,
    filename: null,
    description: `Imported from ${field}`,
  };
}

export async function loadInventoryWorkbook(inputPath) {
  const workbook = await readXlsx(inputPath);

  const errors = [];
  const warnings = [];
  const rawCategories = readSheet(workbook, "Categories", errors);
  const rawEquipment = readSheet(workbook, "Equipment", errors);
  const rawComponents = readSheet(workbook, "Bundle contents", errors);
  const rawMembers = readSheet(workbook, "Members", errors);

  validateUnique(rawCategories, "category", "Categories", errors);
  validateUnique(rawCategories, "asset_code_prefix", "Categories", errors);
  validateUnique(rawEquipment, "asset_code", "Equipment", errors);
  validateUnique(rawMembers, "username", "Members", errors);

  const categories = rawCategories.map((record) => {
    const name = requiredText(record, "category", "Categories", errors);
    const prefix = requiredText(record, "asset_code_prefix", "Categories", errors).toUpperCase();
    if (prefix && !/^[A-Z][A-Z0-9]{1,7}$/.test(prefix)) {
      errors.push({ sheet: "Categories", row: record._row, field: "asset_code_prefix", message: "asset_code_prefix must be 2-8 uppercase letters or digits and start with a letter" });
    }
    return {
      id: stableImportId("category", name),
      name,
      prefix,
      description: textValue(record.description) || null,
      active: 1,
      row: record._row,
    };
  });
  const categoryByName = new Map(categories.map((category) => [category.name.toLocaleLowerCase("en-GB"), category]));

  const equipment = rawEquipment.map((record) => {
    const assetCode = requiredText(record, "asset_code", "Equipment", errors).toUpperCase();
    const name = requiredText(record, "equipment_name", "Equipment", errors);
    const categoryName = requiredText(record, "category", "Equipment", errors);
    const category = categoryByName.get(categoryName.toLocaleLowerCase("en-GB"));
    if (categoryName && !category) {
      errors.push({ sheet: "Equipment", row: record._row, field: "category", message: `Unknown category: ${categoryName}` });
    }
    if (assetCode && !/^[A-Z][A-Z0-9]{1,7}-\d{3,6}$/.test(assetCode)) {
      errors.push({ sheet: "Equipment", row: record._row, field: "asset_code", message: "asset_code must look like ROB-001" });
    }
    if (category && assetCode && !assetCode.startsWith(`${category.prefix}-`)) {
      errors.push({ sheet: "Equipment", row: record._row, field: "asset_code", message: `asset_code must use the ${category.prefix} prefix for ${category.name}` });
    }
    const purchaseDate = parseDate(record.purchase_date);
    if (purchaseDate === undefined) {
      errors.push({ sheet: "Equipment", row: record._row, field: "purchase_date", message: "purchase_date must be a real date in dd/mm/yyyy or yyyy-mm-dd format" });
    }
    const purchasePriceMinor = parsePriceMinor(record, errors);
    const currencyText = textValue(record.currency).toUpperCase();
    if (currencyText && !/^[A-Z]{3}$/.test(currencyText)) {
      errors.push({ sheet: "Equipment", row: record._row, field: "currency", message: "currency must be a three-letter code such as GBP" });
    }
    if (purchasePriceMinor !== null && !currencyText) {
      errors.push({ sheet: "Equipment", row: record._row, field: "currency", message: "currency is required when purchase_price is provided" });
    }
    return {
      id: stableImportId("equipment", assetCode),
      assetCode,
      name,
      categoryName,
      itemType: parseEnum(record, "item_type", ITEM_TYPES, "Equipment", errors),
      manufacturer: textValue(record.manufacturer) || null,
      model: textValue(record.model) || null,
      serialNumber: textValue(record.serial_number) || null,
      publicSpecifications: textValue(record.public_specifications) || null,
      location: textValue(record.location) || null,
      condition: parseEnum(record, "condition", CONDITIONS, "Equipment", errors, { optional: true }),
      lifecycleStatus: parseEnum(record, "lifecycle_status", LIFECYCLE_STATUSES, "Equipment", errors),
      purchaseDate: purchaseDate ?? null,
      purchasePriceMinor,
      currency: currencyText || null,
      supplier: textValue(record.supplier) || null,
      publicNotes: textValue(record.public_notes) || null,
      adminNotes: textValue(record.admin_notes) || null,
      row: record._row,
      raw: record,
    };
  });
  const equipmentByAssetCode = new Map(equipment.map((item) => [item.assetCode.toLocaleLowerCase("en-GB"), item]));

  const componentKeys = new Map();
  const components = rawComponents.map((record) => {
    const assetCode = requiredText(record, "asset_code", "Bundle contents", errors).toUpperCase();
    const componentName = requiredText(record, "component_name", "Bundle contents", errors);
    const parent = equipmentByAssetCode.get(assetCode.toLocaleLowerCase("en-GB"));
    if (!parent) {
      errors.push({ sheet: "Bundle contents", row: record._row, field: "asset_code", message: `Unknown asset_code: ${assetCode}` });
    } else if (parent.itemType !== "bundle") {
      errors.push({ sheet: "Bundle contents", row: record._row, field: "asset_code", message: `${assetCode} is not marked as a Bundle` });
    }
    const quantityValue = cellPrimitive(record.quantity);
    const quantity = typeof quantityValue === "number" ? quantityValue : Number(textValue(quantityValue));
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.push({ sheet: "Bundle contents", row: record._row, field: "quantity", message: "quantity must be a whole number of at least 1" });
    }
    const key = `${assetCode.toLocaleLowerCase("en-GB")}\0${componentName.toLocaleLowerCase("en-GB")}`;
    if (componentKeys.has(key)) {
      errors.push({ sheet: "Bundle contents", row: record._row, field: "component_name", message: `Duplicate component for ${assetCode}; first used on row ${componentKeys.get(key)}` });
    } else {
      componentKeys.set(key, record._row);
    }
    return {
      id: stableImportId("bundle-component", `${assetCode}/${componentName}`),
      assetCode,
      componentName,
      manufacturer: textValue(record.manufacturer) || null,
      model: textValue(record.model) || null,
      serialNumber: textValue(record.serial_number) || null,
      quantity,
      requiredOnReturn: parseYesNo(record, "required_on_return", "Bundle contents", errors),
      notes: textValue(record.notes) || null,
      displayOrder: record._row - 2,
      row: record._row,
    };
  });

  const componentAssets = new Set(components.map((component) => component.assetCode.toLocaleLowerCase("en-GB")));
  for (const item of equipment.filter((candidate) => candidate.itemType === "bundle")) {
    if (!componentAssets.has(item.assetCode.toLocaleLowerCase("en-GB"))) {
      warnings.push({ sheet: "Equipment", row: item.row, field: "item_type", message: `${item.assetCode} is a Bundle but has no rows in Bundle contents` });
    }
  }

  const members = rawMembers.map((record) => {
    const username = requiredText(record, "username", "Members", errors);
    if (username && !/^[A-Za-z0-9._-]+$/.test(username)) {
      errors.push({ sheet: "Members", row: record._row, field: "username", message: "username may contain letters, numbers, dots, underscores and hyphens only" });
    }
    return {
      id: stableImportId("member", username),
      username,
      displayName: requiredText(record, "display_name", "Members", errors),
      active: parseYesNo(record, "active", "Members", errors),
      notes: textValue(record.notes) || null,
      row: record._row,
    };
  });

  const files = [];
  const fileMappings = [
    ["manual_url", "manual", "public"],
    ["certificate_reference", "certificate", "admin"],
    ["receipt_reference", "receipt", "admin"],
    ["record_reference", "record", "admin"],
    ["photo_reference", "photo", "admin"],
  ];
  for (const item of equipment) {
    for (const [field, kind, visibility] of fileMappings) {
      const file = referenceFile(item.assetCode, kind, visibility, item.raw[field], field, item.row, errors);
      if (file) files.push(file);
    }
    delete item.raw;
  }

  return {
    data: { categories, equipment, components, members, files },
    report: {
      errors,
      warnings,
      counts: {
        categories: categories.length,
        equipment: equipment.length,
        components: components.length,
        members: members.length,
        files: files.length,
      },
    },
  };
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cannot serialize a non-finite number to SQL");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function values(items) {
  return items.map(sqlValue).join(", ");
}

export function generateInventorySql(data) {
  const lines = [
    "-- Generated by scripts/import-inventory.mjs. Do not edit by hand.",
    "-- The import is upsert-only: records absent from the workbook are preserved.",
    "PRAGMA foreign_keys = ON;",
    "",
  ];
  const timestamp = new Date().toISOString();

  for (const category of data.categories) {
    lines.push(
      `INSERT INTO categories (id, name, asset_code_prefix, description, active, updated_at) VALUES (${values([category.id, category.name, category.prefix, category.description, category.active, timestamp])}) ON CONFLICT(name) DO UPDATE SET asset_code_prefix = excluded.asset_code_prefix, description = excluded.description, active = excluded.active, updated_at = excluded.updated_at;`,
    );
  }
  lines.push("");

  for (const member of data.members) {
    lines.push(
      `INSERT INTO members (id, username, display_name, active, notes, updated_at) VALUES (${values([member.id, member.username, member.displayName, member.active, member.notes, timestamp])}) ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, active = excluded.active, notes = excluded.notes, updated_at = excluded.updated_at;`,
    );
  }
  lines.push("");

  for (const item of data.equipment) {
    const categoryId = `(SELECT id FROM categories WHERE name = ${sqlValue(item.categoryName)} COLLATE NOCASE)`;
    lines.push(
      `INSERT INTO equipment (id, asset_code, name, category_id, item_type, manufacturer, model, serial_number, public_specifications, location, condition, lifecycle_status, purchase_date, purchase_price_minor, currency, supplier, public_notes, admin_notes, updated_at) VALUES (${values([item.id, item.assetCode, item.name])}, ${categoryId}, ${values([item.itemType, item.manufacturer, item.model, item.serialNumber, item.publicSpecifications, item.location, item.condition, item.lifecycleStatus, item.purchaseDate, item.purchasePriceMinor, item.currency, item.supplier, item.publicNotes, item.adminNotes, timestamp])}) ON CONFLICT(asset_code) DO UPDATE SET name = excluded.name, category_id = excluded.category_id, item_type = excluded.item_type, manufacturer = excluded.manufacturer, model = excluded.model, serial_number = excluded.serial_number, public_specifications = excluded.public_specifications, location = excluded.location, condition = excluded.condition, lifecycle_status = excluded.lifecycle_status, purchase_date = excluded.purchase_date, purchase_price_minor = excluded.purchase_price_minor, currency = excluded.currency, supplier = excluded.supplier, public_notes = excluded.public_notes, admin_notes = excluded.admin_notes, updated_at = excluded.updated_at;`,
    );
  }
  lines.push("");

  for (const component of data.components) {
    const equipmentId = `(SELECT id FROM equipment WHERE asset_code = ${sqlValue(component.assetCode)} COLLATE NOCASE)`;
    lines.push(
      `INSERT INTO bundle_components (id, equipment_id, component_name, manufacturer, model, serial_number, quantity, required_on_return, notes, display_order, updated_at) VALUES (${sqlValue(component.id)}, ${equipmentId}, ${values([component.componentName, component.manufacturer, component.model, component.serialNumber, component.quantity, component.requiredOnReturn, component.notes, component.displayOrder, timestamp])}) ON CONFLICT(equipment_id, component_name) DO UPDATE SET manufacturer = excluded.manufacturer, model = excluded.model, serial_number = excluded.serial_number, quantity = excluded.quantity, required_on_return = excluded.required_on_return, notes = excluded.notes, display_order = excluded.display_order, updated_at = excluded.updated_at;`,
    );
  }
  lines.push("");

  for (const file of data.files) {
    const equipmentId = `(SELECT id FROM equipment WHERE asset_code = ${sqlValue(file.assetCode)} COLLATE NOCASE)`;
    lines.push(
      `INSERT INTO equipment_files (id, equipment_id, kind, visibility, storage_key, external_url, filename, description) VALUES (${sqlValue(file.id)}, ${equipmentId}, ${values([file.kind, file.visibility, file.storageKey, file.externalUrl, file.filename, file.description])}) ON CONFLICT(id) DO UPDATE SET equipment_id = excluded.equipment_id, kind = excluded.kind, visibility = excluded.visibility, storage_key = excluded.storage_key, external_url = excluded.external_url, filename = excluded.filename, description = excluded.description;`,
    );
  }

  return `${lines.join("\n")}\n`;
}
