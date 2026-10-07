import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readXlsx } from "../scripts/lib/xlsx-reader.mjs";
import { buildInventoryWorkbook } from "../web/xlsx-export.js";

test("administrator inventory export excludes member usernames", async () => {
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
          quantity: 1, requiredOnReturn: true, operationalStatus: "maintenance", notes: "Return together",
          photoUrl: "https://example.test/robot.jpg",
        }],
      }],
      members: [{ username: "secret.username", displayName: "Ranul", active: true, notes: "Pilot" }],
    }, new Date("2026-10-02T12:00:00.000Z"));
    await fs.writeFile(outputPath, workbook);
    const exported = await readXlsx(outputPath);
    assert.deepEqual(exported.get("Members"), [
      ["display_name", "active", "notes"],
      ["Ranul", "Yes", "Pilot"],
    ]);
    assert.equal(
      [...exported.values()].flat(2).some((value) => value === "secret.username" || value === "username"),
      false,
    );
    assert.equal(exported.get("Equipment")[1][0], "ROB-003");
    assert.equal(exported.get("Equipment")[1][12], 1000);
    assert.equal(exported.get("Bundle contents")[1][7], "maintenance");
    assert.equal(exported.get("Bundle contents")[1][9], "https://example.test/robot.jpg");
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true });
  }
});
