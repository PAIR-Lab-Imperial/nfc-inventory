import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadInventoryWorkbook } from "./lib/inventory-workbook.mjs";
import {
  buildDummyNfcLabels,
  DEFAULT_PUBLIC_BASE_URL,
  generateDummyNfcManifest,
  generateDummyNfcSql,
} from "./lib/nfc-labels.mjs";

const workbookPath = path.resolve("data/templates/NFC_Inventory_Import_Template.xlsx");
const sqlPath = path.resolve("outputs/dummy-nfc-labels.sql");
const manifestPath = path.resolve("outputs/dummy-nfc-labels.csv");
const publicBaseUrl = process.env.NFC_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL;

const { data, report } = await loadInventoryWorkbook(workbookPath);
if (report.errors.length) {
  throw new Error(`Inventory workbook has ${report.errors.length} validation error(s); dummy labels were not generated`);
}

const labels = buildDummyNfcLabels(data.equipment, publicBaseUrl);
await fs.mkdir(path.dirname(sqlPath), { recursive: true });
await fs.writeFile(sqlPath, generateDummyNfcSql(labels), "utf8");
await fs.writeFile(manifestPath, generateDummyNfcManifest(labels), "utf8");

console.log(JSON.stringify({
  labels: labels.length,
  sql: sqlPath,
  manifest: manifestPath,
  publicBaseUrl,
}, null, 2));
