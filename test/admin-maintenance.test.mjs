import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGE_BYTES, suggestAssetCode, validateImageFile } from "../web/admin-maintenance.js";

test("asset code suggestions use the selected category prefix and next number", () => {
  const categories = [
    { name: "Audio equipment", assetCodePrefix: "AUD" },
    { name: "Robots", assetCodePrefix: "ROB" },
  ];
  const equipment = [
    { assetCode: "AUD-003" },
    { assetCode: "AUD-005" },
    { assetCode: "ROB-002" },
  ];
  assert.equal(suggestAssetCode(categories, equipment, "Audio equipment"), "AUD-006");
  assert.equal(suggestAssetCode(categories, equipment, "Robots"), "ROB-003");
  assert.equal(suggestAssetCode(categories, equipment, "Unknown"), "");
});

test("image validation accepts supported files and rejects unsafe or oversized uploads", () => {
  assert.equal(validateImageFile({ type: "image/jpeg", size: 1024 }), null);
  assert.equal(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES }), null);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 1024 }), /JPEG, PNG or WebP/);
  assert.match(validateImageFile({ type: "image/webp", size: MAX_IMAGE_BYTES + 1 }), /8 MB/);
  assert.match(validateImageFile({ type: "image/png", size: 0 }), /empty/);
});
