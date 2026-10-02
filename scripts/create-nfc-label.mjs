import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildNfcLabel,
  DEFAULT_PUBLIC_BASE_URL,
  generateReplacementNfcSql,
} from "./lib/nfc-labels.mjs";

function parseArguments(argv) {
  const options = {
    assetCode: null,
    token: null,
    previousStatus: "replaced",
    publicBaseUrl: process.env.NFC_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const key = new Map([
      ["--asset-code", "assetCode"],
      ["--token", "token"],
      ["--previous-status", "previousStatus"],
      ["--public-base-url", "publicBaseUrl"],
      ["--output", "output"],
    ]).get(argument);
    if (!key || !argv[index + 1]) throw new Error(`Unknown or incomplete argument: ${argument}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  if (!options.assetCode) throw new Error("--asset-code is required");
  return options;
}

const options = parseArguments(process.argv.slice(2));
const token = options.token || randomBytes(18).toString("base64url");
const label = buildNfcLabel({
  assetCode: options.assetCode,
  token,
  publicBaseUrl: options.publicBaseUrl,
});
const outputPath = path.resolve(options.output || `outputs/nfc-label-${label.assetCode.toLocaleLowerCase("en-GB")}.sql`);
const urlPath = outputPath.replace(/\.sql$/i, ".url.txt");

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, generateReplacementNfcSql(label, options.previousStatus), "utf8");
await fs.writeFile(urlPath, `${label.url}\n`, "utf8");

console.log(JSON.stringify({
  assetCode: label.assetCode,
  tokenHint: label.tokenHint,
  sql: outputPath,
  urlFile: urlPath,
  previousStatus: options.previousStatus,
}, null, 2));
