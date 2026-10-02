import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/src/index.js";

const summaryRow = {
  asset_code: "ROB-003",
  name: "Reachy Mini Wireless",
  category: "Robots",
  item_type: "bundle",
  manufacturer: null,
  model: null,
  location: "PAIR Lab",
  condition: "good",
  lifecycle_status: "active",
  availability: "reserved",
  current_user: "Ranul",
  reserved_until: "2026-10-05T12:00:00.000Z",
  can_share: 1,
  public_specifications: "Wireless robot platform",
  purchase_date: "2026-09-01",
  public_notes: "Return as a complete bundle",
};

class FakeStatement {
  constructor(query) {
    this.query = query;
    this.parameters = [];
  }

  bind(...parameters) {
    this.parameters = parameters;
    return this;
  }
}

function fakeEnvironment({ found = true } = {}) {
  return {
    ALLOWED_ORIGIN: "https://pair-lab-imperial.github.io",
    DB: {
      prepare(query) {
        return new FakeStatement(query);
      },
      async batch(statements) {
        if (statements.length === 2) {
          return [
            { results: [summaryRow] },
            { results: [{ name: "Robots", asset_code_prefix: "ROB", equipment_count: 4 }] },
          ];
        }
        return [
          { results: found ? [summaryRow] : [] },
          {
            results: found
              ? [{ component_name: "Robot", manufacturer: null, model: null, quantity: 1, required_on_return: 1, notes: null }]
              : [],
          },
          {
            results: found
              ? [{ starts_at: "2026-10-02T09:00:00.000Z", ends_at: "2026-10-05T12:00:00.000Z", can_share: 1, sharing_notes: "Ask first", display_name: "Ranul" }]
              : [],
          },
        ];
      },
    },
  };
}

test("catalogue route returns public equipment summaries and categories", async () => {
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/equipment?category=Robots&availability=reserved"),
    fakeEnvironment(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://pair-lab-imperial.github.io");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.deepEqual(body.items[0], {
    assetCode: "ROB-003",
    name: "Reachy Mini Wireless",
    category: "Robots",
    itemType: "bundle",
    manufacturer: null,
    model: null,
    location: "PAIR Lab",
    condition: "good",
    lifecycleStatus: "active",
    availability: "reserved",
    currentUser: "Ranul",
    reservedUntil: "2026-10-05T12:00:00.000Z",
    canShare: true,
  });
  assert.deepEqual(body.categories[0], {
    name: "Robots",
    assetCodePrefix: "ROB",
    equipmentCount: 4,
  });
});

test("equipment detail includes public metadata, bundle contents and reservations", async () => {
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/equipment/ROB-003"),
    fakeEnvironment(),
  );
  assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.equal(item.assetCode, "ROB-003");
  assert.equal(item.publicSpecifications, "Wireless robot platform");
  assert.equal(item.components[0].name, "Robot");
  assert.equal(item.components[0].requiredOnReturn, true);
  assert.equal(item.reservations[0].memberName, "Ranul");
  assert.equal(item.reservations[0].canShare, true);
  assert.equal("adminNotes" in item, false);
  assert.equal("purchasePrice" in item, false);
});

test("invalid filters and unknown equipment use stable error responses", async () => {
  const invalidResponse = await worker.fetch(
    new Request("https://api.example/api/v1/equipment?availability=busy"),
    fakeEnvironment(),
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error.code, "invalid_query");

  const missingResponse = await worker.fetch(
    new Request("https://api.example/api/v1/equipment/ROB-999"),
    fakeEnvironment({ found: false }),
  );
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).error.code, "equipment_not_found");
});
