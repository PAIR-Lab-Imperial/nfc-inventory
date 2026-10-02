import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { generateInventorySql, loadInventoryWorkbook, parseDate } from "../scripts/lib/inventory-workbook.mjs";

const workbookPath = path.resolve("data/templates/NFC_Inventory_Import_Template.xlsx");

test("canonical workbook validates and contains the expected seed records", async () => {
  const { data, report } = await loadInventoryWorkbook(workbookPath);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.counts, {
    categories: 13,
    equipment: 79,
    components: 30,
    members: 6,
    files: 33,
  });
  assert.deepEqual(report.warnings, []);
  assert.equal(data.equipment.filter((item) => item.name === "Azure Kinect DK").length, 2);
  assert.equal(data.equipment.filter((item) => item.primaryPhotoUrl).length, 79);
  assert.equal(data.equipment.filter((item) => !item.primaryPhotoUrl.endsWith("equipment-placeholder.svg")).length, 57);
  assert.equal(data.components.filter((item) => item.photoUrl).length, 30);
  assert.equal(data.components.filter((item) => !item.photoUrl.endsWith("equipment-placeholder.svg")).length, 20);
  assert.equal(data.equipment.some((item) => item.assetCode === "CAM-005"), false);
  assert.equal(data.equipment.filter((item) => item.name === "Reachy Mini Wireless").length, 4);
  assert.equal(data.equipment.filter((item) => item.name === "Reachy Mini Lite").length, 1);
  const rob006 = data.equipment.find((item) => item.assetCode === "ROB-006");
  assert.equal(rob006.model, "Reachy Mini Wireless");
  assert.match(rob006.primaryPhotoUrl, /assets\/equipment\/reachy-mini-wireless\.png$/);
  const rob006Robot = data.components.find((item) => item.assetCode === "ROB-006" && item.componentName === "Robot");
  assert.equal(rob006Robot.model, "Reachy Mini Wireless");
  assert.match(rob006Robot.photoUrl, /assets\/equipment\/reachy-mini-wireless\.png$/);
  assert.equal(data.equipment.filter((item) => item.model === "27MR400-B").length, 3);
  assert.equal(data.equipment.filter((item) => item.model === "C26M2020UK").length, 4);
  assert.equal(data.equipment.filter((item) => item.model === "MK270").length, 5);
  assert.deepEqual(
    data.equipment
      .filter((item) => item.model === "DMT03")
      .map((item) => [item.assetCode, item.name, item.manufacturer]),
    [
      ["AUD-003", "DJI Mic 3 Transmitter", "DJI"],
      ["AUD-004", "DJI Mic 3 Transmitter", "DJI"],
    ],
  );
  assert.deepEqual(
    ["MNT-003", "MNT-004", "MNT-005", "MNT-008", "MNT-009"].map((assetCode) => {
      const item = data.equipment.find((equipment) => equipment.assetCode === assetCode);
      return [item.assetCode, item.name, item.manufacturer, item.model];
    }),
    [
      ["MNT-003", "PEMOTech Tripod", "PEMOTech", null],
      ["MNT-004", "Victiv Tripod", "Victiv", "NT70"],
      ["MNT-005", "K&F Tripod", "K&F Concept", "K234A0"],
      ["MNT-008", "Unbranded Three-Stage Tripod", "Unbranded", null],
      ["MNT-009", "Unbranded Three-Stage Tripod", "Unbranded", null],
    ],
  );
  assert.match(data.equipment[0].primaryPhotoUrl, /assets\/equipment\/misty-ii\.png$/);
  assert.match(data.components[0].photoUrl, /assets\/equipment\/reachy-mini-wireless\.png$/);
});

test("generated SQL is upsert-only and escapes apostrophes", async () => {
  const { data, report } = await loadInventoryWorkbook(workbookPath);
  assert.equal(report.errors.length, 0);
  data.equipment[0].adminNotes = "Lab's first robot";
  const sql = generateInventorySql(data);
  assert.match(sql, /ON CONFLICT\(asset_code\) DO UPDATE/);
  assert.match(sql, /Lab''s first robot/);
  assert.match(sql, /primary_photo_url/);
  assert.match(sql, /photo_url/);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /BEGIN TRANSACTION|\bCOMMIT\b/i);
});

test("calendar dates accept UK and ISO formats and reject invalid dates", () => {
  assert.equal(parseDate("02/10/2026"), "2026-10-02");
  assert.equal(parseDate("2026-10-02"), "2026-10-02");
  assert.equal(parseDate("31/02/2026"), undefined);
  assert.equal(parseDate(""), null);
});
