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
    equipment: 80,
    components: 27,
    members: 7,
    files: 33,
  });
  assert.deepEqual(report.warnings, []);
  const naimeh = data.members.find((member) => member.username === "naimeh.fakhr-vaezi25");
  assert.deepEqual(
    [naimeh?.displayName, naimeh?.active, naimeh?.notes],
    ["Naimeh", 1, null],
  );
  assert.equal(data.equipment.filter((item) => item.name === "Azure Kinect DK").length, 2);
  assert.equal(data.equipment.filter((item) => item.primaryPhotoUrl).length, 80);
  assert.equal(data.equipment.filter((item) => !item.primaryPhotoUrl.endsWith("equipment-placeholder.svg")).length, 57);
  assert.equal(data.components.filter((item) => item.photoUrl).length, 27);
  assert.equal(data.components.every((item) => item.operationalStatus === "available"), true);
  assert.equal(data.components.filter((item) => !item.photoUrl.endsWith("equipment-placeholder.svg")).length, 19);
  assert.equal(data.equipment.some((item) => item.assetCode === "CAM-005"), false);
  assert.equal(data.equipment.filter((item) => item.name === "Reachy Mini Wireless").length, 3);
  assert.equal(data.equipment.filter((item) => item.name === "Reachy Mini Lite").length, 1);
  const rob003 = data.equipment.find((item) => item.assetCode === "ROB-003");
  assert.deepEqual(
    [rob003?.name, rob003?.itemType, rob003?.lifecycleStatus],
    ["NAO Robot", "individual", "retired"],
  );
  assert.equal(data.components.some((item) => item.assetCode === "ROB-003"), false);
  const rob005 = data.equipment.find((item) => item.assetCode === "ROB-005");
  assert.deepEqual(
    [rob005?.name, rob005?.model, rob005?.purchasePriceMinor],
    ["Reachy Mini Wireless", "Reachy Mini Wireless", 43993],
  );
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
  const djiMicSet = data.equipment.find((item) => item.assetCode === "AUD-005");
  assert.deepEqual(
    [djiMicSet?.name, djiMicSet?.itemType, djiMicSet?.manufacturer, djiMicSet?.model],
    ["DJI Mic 3 Set", "individual", "DJI", "DJI Mic 3 (2 TX + 1 RX)"],
  );
  assert.match(djiMicSet?.primaryPhotoUrl ?? "", /473691cc5e140d0341a30b31b479c627/);
  assert.equal(data.components.some((item) => item.assetCode === "AUD-005"), false);
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
  const rob005Robot = data.components.find((item) => item.assetCode === "ROB-005" && item.componentName === "Robot");
  assert.match(rob005Robot.photoUrl, /assets\/equipment\/reachy-mini-wireless\.png$/);
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
  assert.match(sql, /operational_status/);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /BEGIN TRANSACTION|\bCOMMIT\b/i);
});

test("calendar dates accept UK and ISO formats and reject invalid dates", () => {
  assert.equal(parseDate("02/10/2026"), "2026-10-02");
  assert.equal(parseDate("2026-10-02"), "2026-10-02");
  assert.equal(parseDate("31/02/2026"), undefined);
  assert.equal(parseDate(""), null);
});
