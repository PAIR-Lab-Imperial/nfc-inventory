import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNfcLabel,
  buildDummyNfcLabels,
  buildProductionNfcLabels,
  generateDummyNfcManifest,
  generateDummyNfcSql,
  generateProductionNfcSql,
  generateReplacementNfcSql,
  sha256Hex,
} from "../scripts/lib/nfc-labels.mjs";

const equipment = [
  { assetCode: "ROB-003", name: "Reachy Mini Wireless" },
  { assetCode: "AUD-001", name: "RØDE microphone bundle" },
];

test("dummy NFC labels have stable URLs and hashed database tokens", () => {
  const first = buildDummyNfcLabels(equipment);
  const second = buildDummyNfcLabels(equipment);
  assert.deepEqual(first, second);
  assert.equal(first[0].token, "demo-rob-003-v1");
  assert.equal(first[0].tokenHash, sha256Hex(first[0].token));
  assert.equal(first[0].url, "https://pair-lab-imperial.github.io/nfc-inventory/?t=demo-rob-003-v1");
  assert.match(first[0].id, /^[a-f0-9-]{36}$/);
});

test("dummy label SQL is idempotent and stores the recoverable scan URL", () => {
  const labels = buildDummyNfcLabels(equipment);
  const sql = generateDummyNfcSql(labels);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/);
  assert.match(sql, new RegExp(labels[0].tokenHash));
  assert.match(sql, /\?t=demo-rob-003-v1/);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
});

test("dummy label manifest contains the programming URLs", () => {
  const labels = buildDummyNfcLabels(equipment);
  const manifest = generateDummyNfcManifest(labels);
  assert.match(manifest, /^asset_code,equipment_name,dummy_token,nfc_url,token_hint/m);
  assert.match(manifest, /ROB-003,Reachy Mini Wireless,demo-rob-003-v1/);
  assert.match(manifest, /RØDE microphone bundle/);
});

test("replacement SQL retires the prior association and stores its scan URL", () => {
  const label = buildNfcLabel({ assetCode: "ROB-003", token: "demo-rob-003-v2" });
  const sql = generateReplacementNfcSql(label, "lost");
  assert.match(sql, /SET status = 'lost'/);
  assert.match(sql, /nfc_label\.replaced/);
  assert.match(sql, new RegExp(label.tokenHash));
  assert.match(sql, /\?t=demo-rob-003-v2/);
  assert.match(label.url, /\?t=demo-rob-003-v2$/);
});

test("production batches use unique random-style tokens and replace active demo labels", () => {
  const tokens = ["abcdefghijklmnopqrstuvwx", "zyxwvutsrqponmlkjihgfedc"];
  const labels = buildProductionNfcLabels(equipment, undefined, () => tokens.shift());
  assert.equal(labels.length, 2);
  assert.doesNotMatch(labels[0].url, /demo-/);
  assert.notEqual(labels[0].tokenHash, labels[1].tokenHash);
  const sql = generateProductionNfcSql(labels);
  assert.match(sql, /SET status = 'replaced'/);
  assert.match(sql, /Production NFC association/);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/);
  assert.doesNotMatch(sql, /BEGIN TRANSACTION|\bCOMMIT\b/);
  assert.doesNotMatch(sql, /Temporary dummy NFC association/);
});
