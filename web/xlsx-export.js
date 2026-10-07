const encoder = new TextEncoder();

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellXml(value, rowIndex, columnIndex, style = 0) {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
  const styleAttribute = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${reference}"${styleAttribute}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
  const text = String(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t${preserve}>${xmlEscape(text)}</t></is></c>`;
}

function worksheetXml(rows, widths) {
  const columnXml = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cellXml(value, rowIndex, columnIndex, rowIndex === 0 ? 1 : 0)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastColumn = columnName(Math.max(0, (rows[0]?.length || 1) - 1));
  const lastRow = Math.max(1, rows.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columnXml}</cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function headerBytes(length) {
  return new Uint8Array(length);
}

function write16(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function write32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true);
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function zipStore(files, date = new Date()) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const stamp = dosDateTime(date);
  for (const file of files) {
    const name = encoder.encode(file.name.replaceAll("\\", "/"));
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(data);
    const local = headerBytes(30);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 6, 0x0800);
    write16(local, 8, 0);
    write16(local, 10, stamp.time);
    write16(local, 12, stamp.date);
    write32(local, 14, checksum);
    write32(local, 18, data.length);
    write32(local, 22, data.length);
    write16(local, 26, name.length);
    write16(local, 28, 0);
    localParts.push(local, name, data);

    const central = headerBytes(46);
    write32(central, 0, 0x02014b50);
    write16(central, 4, 20);
    write16(central, 6, 20);
    write16(central, 8, 0x0800);
    write16(central, 10, 0);
    write16(central, 12, stamp.time);
    write16(central, 14, stamp.date);
    write32(central, 16, checksum);
    write32(central, 20, data.length);
    write32(central, 24, data.length);
    write16(central, 28, name.length);
    write16(central, 30, 0);
    write16(central, 32, 0);
    write16(central, 34, 0);
    write16(central, 36, 0);
    write32(central, 38, 0);
    write32(central, 42, localOffset);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const centralDirectory = concatBytes(centralParts);
  const end = headerBytes(22);
  write32(end, 0, 0x06054b50);
  write16(end, 4, 0);
  write16(end, 6, 0);
  write16(end, 8, files.length);
  write16(end, 10, files.length);
  write32(end, 12, centralDirectory.length);
  write32(end, 16, localOffset);
  write16(end, 20, 0);
  return concatBytes([...localParts, centralDirectory, end]);
}

function firstFileUrl(item, kind) {
  return item.files?.find((file) => file.kind === kind)?.url || "";
}

function inventorySheets(data, generatedAt) {
  const readMe = [
    ["PAIR Lab NFC Inventory export", ""],
    ["Generated", generatedAt.toISOString()],
    ["Purpose", "Inventory workbook export. Equipment, bundle and category columns match the maintained import template."],
    ["Member privacy", "The Members sheet includes display names, active state and notes only. Usernames are intentionally excluded."],
    ["Workflow", "Member rows from this export cannot be imported because usernames are not included."],
    ["Operational data", "Reservations, checkouts, NFC labels, proposals and audit history are exported separately from the administrator dashboard."],
  ];
  const categories = [["category", "asset_code_prefix", "description"], ...data.categories.map((category) => [
    category.name, category.assetCodePrefix, category.description || "",
  ])];
  const equipment = [[
    "asset_code", "equipment_name", "category", "item_type", "manufacturer", "model",
    "serial_number", "public_specifications", "location", "condition", "lifecycle_status",
    "purchase_date", "purchase_price", "currency", "supplier", "public_notes", "admin_notes",
    "manual_url", "certificate_reference", "receipt_reference", "record_reference", "photo_reference",
  ], ...data.equipment.map((item) => [
    item.assetCode, item.name, item.category, item.itemType === "bundle" ? "Bundle" : "Individual",
    item.manufacturer || "", item.model || "", item.serialNumber || "", item.publicSpecifications || "",
    item.location || "", item.condition || "", item.lifecycleStatus || "Active", item.purchaseDate || "",
    item.purchasePrice ?? "", item.currency || "", item.supplier || "", item.publicNotes || "",
    item.adminNotes || "", firstFileUrl(item, "manual"), firstFileUrl(item, "certificate"),
    firstFileUrl(item, "receipt"), firstFileUrl(item, "record"), item.photoUrl || "",
  ])];
  const components = [[
    "asset_code", "component_name", "manufacturer", "model", "serial_number", "quantity",
    "required_on_return", "notes", "photo_reference",
  ]];
  for (const item of data.equipment) {
    for (const component of item.components || []) {
      components.push([
        item.assetCode, component.name, component.manufacturer || "", component.model || "",
        component.serialNumber || "", component.quantity, component.requiredOnReturn ? "Yes" : "No",
        component.notes || "", component.photoUrl || "",
      ]);
    }
  }
  const members = [["display_name", "active", "notes"], ...data.members.map((member) => [
    member.displayName, member.active ? "Yes" : "No", member.notes || "",
  ])];
  return [
    { name: "Read me", rows: readMe, widths: [28, 110] },
    { name: "Categories", rows: categories, widths: [30, 20, 55] },
    { name: "Equipment", rows: equipment, widths: [14, 28, 28, 13, 20, 20, 18, 45, 20, 14, 18, 16, 16, 11, 24, 38, 38, 42, 30, 30, 30, 55] },
    { name: "Bundle contents", rows: components, widths: [14, 28, 20, 20, 18, 10, 20, 42, 55] },
    { name: "Members", rows: members, widths: [28, 12, 45] },
  ];
}

export function buildInventoryWorkbook(data, generatedAt = new Date()) {
  const sheets = inventorySheets(data, generatedAt);
  const contentOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRelationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const styleRelationshipId = sheets.length + 1;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentOverrides}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships}<Relationship Id="rId${styleRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
  ];
  sheets.forEach((sheet, index) => files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet.rows, sheet.widths) }));
  return zipStore(files, generatedAt);
}
