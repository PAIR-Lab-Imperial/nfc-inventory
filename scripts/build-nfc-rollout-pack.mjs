import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import QRCode from "qrcode";
import { loadInventoryWorkbook } from "./lib/inventory-workbook.mjs";
import { buildDummyNfcLabels, DEFAULT_PUBLIC_BASE_URL } from "./lib/nfc-labels.mjs";
import {
  buildRolloutRows,
  generateLabelSheetHtml,
  generateRolloutChecklistCsv,
  labelsFromOperationalExport,
} from "./lib/nfc-rollout.mjs";

function parseArguments(argv) {
  const options = {
    workbook: "data/templates/NFC_Inventory_Import_Template.xlsx",
    outputDirectory: "outputs/nfc-rollout-pack",
    publicBaseUrl: process.env.NFC_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
    operationalExport: null,
  };
  const mappings = new Map([
    ["--workbook", "workbook"],
    ["--output-dir", "outputDirectory"],
    ["--public-base-url", "publicBaseUrl"],
    ["--operational-export", "operationalExport"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = mappings.get(argv[index]);
    if (!key || !argv[index + 1]) throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const workbookPath = path.resolve(options.workbook);
const outputDirectory = path.resolve(options.outputDirectory);
let labels;
let pilot;
if (options.operationalExport) {
  const payload = JSON.parse(await fs.readFile(path.resolve(options.operationalExport), "utf8"));
  labels = labelsFromOperationalExport(payload);
  pilot = false;
} else {
  const { data, report } = await loadInventoryWorkbook(workbookPath);
  if (report.errors.length) {
    throw new Error(`Inventory workbook has ${report.errors.length} validation error(s); rollout pack was not generated`);
  }
  labels = buildDummyNfcLabels(data.equipment, options.publicBaseUrl);
  pilot = true;
}
const rows = buildRolloutRows(labels);
const qrSvgs = await Promise.all(rows.map((row) => QRCode.toString(row.url, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 1,
  width: 256,
  color: { dark: "#102a43", light: "#ffffff" },
})));
const generatedAt = new Date().toISOString();
const checklistPath = path.join(outputDirectory, "nfc-rollout-checklist.csv");
const labelSheetPath = path.join(outputDirectory, "nfc-label-sheet.html");

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(checklistPath, generateRolloutChecklistCsv(rows), "utf8");
await fs.writeFile(labelSheetPath, generateLabelSheetHtml(rows, qrSvgs, { generatedAt, pilot }), "utf8");

console.log(JSON.stringify({
  labels: rows.length,
  maximumNdefBytes: Math.max(...rows.map((row) => row.ndefBytes)),
  minimumRemainingBytes: Math.min(...rows.map((row) => row.remainingBytes)),
  checklist: checklistPath,
  labelSheet: labelSheetPath,
  pilot,
}, null, 2));
