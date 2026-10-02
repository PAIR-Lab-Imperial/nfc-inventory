import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadInventoryWorkbook } from "../scripts/lib/inventory-workbook.mjs";
import { buildInventoryWorkbook } from "../web/xlsx-export.js";

test("administrator inventory export round-trips through the canonical importer", async () => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "nfc-inventory-export-"));
  const outputPath = path.join(outputDirectory, "inventory.xlsx");
  try {
    const workbook = buildInventoryWorkbook({
      categories: [{ name: "Robots", assetCodePrefix: "ROB", description: "Robot platforms" }],
      equipment: [{
        assetCode: "ROB-003", name: "Reachy Mini Wireless", category: "Robots", itemType: "bundle",
        manufacturer: "Pollen Robotics", model: "Mini", serialNumber: "R-001",
        publicSpecifications: "Wireless robot platform", location: "PAIR Lab", condition: "good",
        lifecycleStatus: "active", purchaseDate: "2026-09-01", purchasePrice: 1000,
        currency: "GBP", supplier: "Supplier", publicNotes: "Public", adminNotes: "Admin",
        photoUrl: "https://example.test/reachy.jpg",
        files: [{ kind: "manual", url: "https://example.test/manual.pdf" }],
        components: [{
          name: "Robot", manufacturer: "Pollen Robotics", model: "Mini", serialNumber: "R-001",
          quantity: 1, requiredOnReturn: true, notes: "Return together",
          photoUrl: "https://example.test/robot.jpg",
        }],
      }],
      members: [{ username: "ranul", displayName: "Ranul", active: true, notes: "Pilot" }],
    }, new Date("2026-10-02T12:00:00.000Z"));
    await fs.writeFile(outputPath, workbook);
    const { data, report } = await loadInventoryWorkbook(outputPath);
    assert.deepEqual(report.errors, []);
    assert.equal(report.warnings.length, 0);
    assert.deepEqual(report.counts, { categories: 1, equipment: 1, components: 1, members: 1, files: 1 });
    assert.equal(data.equipment[0].assetCode, "ROB-003");
    assert.equal(data.equipment[0].purchasePriceMinor, 100000);
    assert.equal(data.components[0].photoUrl, "https://example.test/robot.jpg");
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true });
  }
});
