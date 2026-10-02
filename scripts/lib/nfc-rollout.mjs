const URI_PREFIXES = [
  "http://www.",
  "https://www.",
  "http://",
  "https://",
];

export const NTAG213_USER_BYTES = 144;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function ndefUriStorageBytes(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("NFC label URLs must use HTTP or HTTPS");
  }
  const serialized = url.toString();
  const prefix = URI_PREFIXES.find((candidate) => serialized.startsWith(candidate));
  const encodedRemainder = new TextEncoder().encode(prefix ? serialized.slice(prefix.length) : serialized).length;
  // Type 2 TLV + short NDEF URI record + terminator. URI prefix compression is
  // represented by one byte in the payload.
  return encodedRemainder + 8;
}

export function buildRolloutRows(labels) {
  const seenAssets = new Set();
  const seenUrls = new Set();
  return labels.map((label, index) => {
    if (!label.assetCode || !label.equipmentName || !label.url) {
      throw new Error(`Label ${index + 1} is missing assetCode, equipmentName or url`);
    }
    if (seenAssets.has(label.assetCode)) throw new Error(`Duplicate asset code in rollout pack: ${label.assetCode}`);
    if (seenUrls.has(label.url)) throw new Error(`Duplicate NFC URL in rollout pack: ${label.url}`);
    seenAssets.add(label.assetCode);
    seenUrls.add(label.url);
    const ndefBytes = ndefUriStorageBytes(label.url);
    if (ndefBytes > NTAG213_USER_BYTES) {
      throw new Error(`${label.assetCode} requires ${ndefBytes} bytes and will not fit an NTAG213 tag`);
    }
    return {
      sequence: index + 1,
      assetCode: label.assetCode,
      equipmentName: label.equipmentName,
      url: label.url,
      tokenHint: label.tokenHint || "",
      ndefBytes,
      remainingBytes: NTAG213_USER_BYTES - ndefBytes,
    };
  });
}

export function labelsFromOperationalExport(payload) {
  if (!payload || !Array.isArray(payload.equipment) || !Array.isArray(payload.nfcLabels)) {
    throw new Error("Operational export must contain equipment and nfcLabels arrays");
  }
  const equipmentNames = new Map(payload.equipment.map((item) => [item.assetCode, item.name]));
  const labels = payload.nfcLabels
    .filter((label) => label.status === "active")
    .map((label) => ({
      assetCode: label.assetCode,
      equipmentName: equipmentNames.get(label.assetCode),
      tokenHint: label.tokenHint,
      url: label.scanUrl,
    }));
  if (!labels.length) throw new Error("Operational export contains no active NFC labels");
  const missingUrl = labels.find((label) => !label.url);
  if (missingUrl) throw new Error(`Active label for ${missingUrl.assetCode} does not contain a recoverable scan URL`);
  return labels;
}

export function generateRolloutChecklistCsv(rows) {
  const values = [
    [
      "sequence", "asset_code", "equipment_name", "nfc_url", "token_hint",
      "ndef_bytes", "ntag213_remaining_bytes", "sticker_type", "placement",
      "programmed_by", "programmed_at", "scan_test_android", "scan_test_iphone",
      "qr_test", "applied", "notes",
    ],
    ...rows.map((row) => [
      row.sequence, row.assetCode, row.equipmentName, row.url, row.tokenHint,
      row.ndefBytes, row.remainingBytes, "", "", "", "", "", "", "", "", "",
    ]),
  ];
  return `${values.map((row) => row.map(csvValue).join(",")).join("\n")}\n`;
}

export function generateLabelSheetHtml(rows, qrSvgs, { generatedAt = new Date().toISOString(), pilot = true } = {}) {
  if (rows.length !== qrSvgs.length) throw new Error("Every label row must have one QR code");
  const cards = rows.map((row, index) => `
    <article class="label" data-asset-code="${escapeHtml(row.assetCode)}">
      <div class="qr">${qrSvgs[index]}</div>
      <div class="label-copy">
        <p class="asset-code">${escapeHtml(row.assetCode)}</p>
        <h2>${escapeHtml(row.equipmentName)}</h2>
        <p class="instruction">Tap NFC or scan QR</p>
        <p class="token-hint">PAIR Lab inventory · ${escapeHtml(row.tokenHint)}</p>
        ${pilot ? '<p class="pilot">PILOT · KEEP REWRITABLE</p>' : ""}
      </div>
    </article>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PAIR Lab NFC label sheet</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; color: #102a43; background: #eef4f8; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .screen-header { max-width: 1100px; margin: 28px auto 16px; padding: 0 20px; }
    .screen-header h1 { margin: 0 0 8px; font-size: 28px; }
    .screen-header p { margin: 4px 0; color: #52667a; line-height: 1.45; }
    .sheet { width: 196mm; margin: 0 auto 24px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 2mm; }
    .label { height: 53mm; padding: 4mm; display: grid; grid-template-columns: 36mm 1fr; gap: 4mm; align-items: center; overflow: hidden; background: white; border: 0.35mm dashed #8da2b5; border-radius: 2mm; break-inside: avoid; page-break-inside: avoid; }
    .qr, .qr svg { display: block; width: 34mm; height: 34mm; }
    .label-copy { min-width: 0; }
    .asset-code { margin: 0 0 2mm; color: #007f9e; font-size: 19pt; font-weight: 800; letter-spacing: 0.04em; }
    h2 { margin: 0; font-size: 12pt; line-height: 1.18; overflow-wrap: anywhere; }
    .instruction { margin: 3mm 0 0; font-size: 9pt; font-weight: 700; }
    .token-hint { margin: 1.5mm 0 0; color: #52667a; font-size: 7.5pt; }
    .pilot { display: inline-block; margin: 2mm 0 0; padding: 1mm 1.8mm; color: #7a3e00; background: #fff2cc; border-radius: 1mm; font-size: 6.8pt; font-weight: 800; letter-spacing: 0.03em; }
    @page { size: A4 portrait; margin: 7mm; }
    @media print {
      :root { background: white; }
      .screen-header { display: none; }
      .sheet { width: auto; margin: 0; gap: 2mm; }
    }
  </style>
</head>
<body>
  <header class="screen-header">
    <h1>PAIR Lab NFC rollout labels</h1>
    <p>${rows.length} labels · generated ${escapeHtml(generatedAt)}</p>
    <p>Print at 100% scale on A4, cut on the dashed lines, and keep pilot NFC tags rewritable.</p>
  </header>
  <main class="sheet">${cards}
  </main>
</body>
</html>
`;
}
