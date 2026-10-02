import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRolloutRows,
  generateLabelSheetHtml,
  generateRolloutChecklistCsv,
  labelsFromOperationalExport,
  ndefUriStorageBytes,
  NTAG213_USER_BYTES,
} from "../scripts/lib/nfc-rollout.mjs";

const labels = [
  {
    assetCode: "ROB-003",
    equipmentName: "Reachy Mini Wireless",
    tokenHint: "003-v1",
    url: "https://pair-lab-imperial.github.io/nfc-inventory/?t=demo-rob-003-v1",
  },
  {
    assetCode: "CAM-001",
    equipmentName: "Azure Kinect DK",
    tokenHint: "001-v1",
    url: "https://pair-lab-imperial.github.io/nfc-inventory/?t=demo-cam-001-v1",
  },
];

test("rollout rows fit the NTAG213 user-memory budget", () => {
  const rows = buildRolloutRows(labels);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.ndefBytes <= NTAG213_USER_BYTES));
  assert.ok(rows.every((row) => row.remainingBytes > 40));
  assert.equal(ndefUriStorageBytes(labels[0].url), rows[0].ndefBytes);
});

test("administrator operational exports can drive production label sheets", () => {
  const productionLabels = labelsFromOperationalExport({
    equipment: [{ assetCode: "ROB-003", name: "Reachy Mini Wireless" }],
    nfcLabels: [
      { assetCode: "ROB-003", status: "replaced", tokenHint: "old", scanUrl: "https://example.com/old" },
      { assetCode: "ROB-003", status: "active", tokenHint: "new12345", scanUrl: "https://example.com/?t=production-token" },
    ],
  });
  assert.deepEqual(productionLabels, [{
    assetCode: "ROB-003",
    equipmentName: "Reachy Mini Wireless",
    tokenHint: "new12345",
    url: "https://example.com/?t=production-token",
  }]);
  assert.throws(() => labelsFromOperationalExport({ equipment: [], nfcLabels: [] }), /no active NFC labels/);
});

test("rollout validation rejects duplicate assets and oversized URLs", () => {
  assert.throws(() => buildRolloutRows([labels[0], labels[0]]), /Duplicate asset code/);
  assert.throws(() => buildRolloutRows([{ ...labels[0], url: `https://example.com/${"x".repeat(180)}` }]), /will not fit/);
});

test("rollout checklist and printable sheet include every asset", () => {
  const rows = buildRolloutRows(labels);
  const checklist = generateRolloutChecklistCsv(rows);
  assert.match(checklist, /ntag213_remaining_bytes/);
  assert.match(checklist, /ROB-003/);
  assert.match(checklist, /scan_test_iphone/);
  const sheet = generateLabelSheetHtml(rows, ["<svg></svg>", "<svg></svg>"], { generatedAt: "2026-10-02T00:00:00.000Z" });
  assert.match(sheet, /PAIR Lab NFC rollout labels/);
  assert.match(sheet, /data-asset-code="ROB-003"/);
  assert.match(sheet, /PILOT · KEEP REWRITABLE/);
  assert.equal((sheet.match(/<article class="label"/g) || []).length, 2);
});
