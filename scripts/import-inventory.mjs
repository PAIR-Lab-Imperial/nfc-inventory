import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { generateInventorySql, loadInventoryWorkbook } from "./lib/inventory-workbook.mjs";

function parseArguments(argv) {
  const options = {
    input: path.resolve("data/templates/NFC_Inventory_Import_Template.xlsx"),
    output: path.resolve("outputs/inventory-import.sql"),
    validateOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--validate-only") {
      options.validateOnly = true;
    } else if (argument === "--input" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      options[argument === "--input" ? "input" : "output"] = path.resolve(value);
      index += 1;
    } else if (argument === "--help") {
      console.log("Usage: node scripts/import-inventory.mjs [--input workbook.xlsx] [--output import.sql] [--validate-only]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const { data, report } = await loadInventoryWorkbook(options.input);

for (const issue of report.errors) {
  console.error(`ERROR ${issue.sheet}!row ${issue.row}${issue.field ? ` (${issue.field})` : ""}: ${issue.message}`);
}
for (const issue of report.warnings) {
  console.warn(`WARNING ${issue.sheet}!row ${issue.row}${issue.field ? ` (${issue.field})` : ""}: ${issue.message}`);
}

console.log(JSON.stringify({ input: options.input, counts: report.counts, errors: report.errors.length, warnings: report.warnings.length }, null, 2));

if (report.errors.length > 0) process.exit(1);
if (!options.validateOnly) {
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, generateInventorySql(data), "utf8");
  await fs.writeFile(`${options.output}.report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.output}`);
  console.log(`Wrote ${options.output}.report.json`);
}
