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
    equipment: 78,
    components: 30,
    members: 6,
    files: 34,
  });
  assert.deepEqual(report.warnings, []);
  assert.equal(data.equipment.filter((item) => item.name === "Azure Kinect DK").length, 2);
  assert.equal(data.equipment.filter((item) => item.primaryPhotoUrl).length, 78);
  assert.equal(data.equipment.filter((item) => !item.primaryPhotoUrl.endsWith("equipment-placeholder.svg")).length, 40);
  assert.equal(data.components.filter((item) => item.photoUrl).length, 30);
  assert.equal(data.equipment.filter((item) => item.name === "Reachy Mini Wireless").length, 3);
  assert.equal(data.equipment.filter((item) => item.name === "Reachy Mini Lite").length, 2);
  assert.equal(data.equipment.filter((item) => item.model === "27MR400-B").length, 3);
  assert.equal(data.equipment.filter((item) => item.model === "C26M2020UK").length, 4);
  assert.equal(data.equipment.filter((item) => item.model === "MK270").length, 5);
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
