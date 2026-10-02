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

class MutationStatement extends FakeStatement {
  constructor(query, state) {
    super(query);
    this.state = state;
  }

  async all() {
    if (this.query.includes("FROM members")) {
      return { results: this.state.members.map(({ username, display_name }) => ({ username, display_name })) };
    }
    return { results: [] };
  }

  async first() {
    if (this.query.includes("FROM nfc_labels")) {
      this.state.lastNfcHash = this.parameters[0];
      return this.state.nfcLabel;
    }
    if (this.query.includes("JOIN equipment ON equipment.id = checkout.equipment_id")) {
      return this.state.currentCheckout;
    }
    if (this.query.includes("FROM checkouts")) return this.state.openCheckout;
    return null;
  }
}

function mutationEnvironment({ openCheckout = null, currentCheckout = null, nfcLabel = null } = {}) {
  const state = {
    openCheckout,
    currentCheckout,
    nfcLabel,
    lastNfcHash: null,
    members: [{ id: "member-1", username: "ranul", display_name: "Ranul" }],
    writes: [],
  };
  const environment = {
    ALLOWED_ORIGIN: "https://pair-lab-imperial.github.io",
    DB: {
      prepare(query) {
        return new MutationStatement(query, state);
      },
      async batch(statements) {
        if (statements[0]?.query.includes("SELECT id, asset_code, name, lifecycle_status")) {
          return [
            { results: [{ id: "equipment-1", asset_code: "ROB-003", name: "Reachy Mini Wireless", lifecycle_status: "active" }] },
            { results: state.members },
          ];
        }
        state.writes.push(statements);
        return statements.map(() => ({ success: true }));
      },
    },
  };
  return { environment, state };
}

function postRequest(path, body, origin = "https://pair-lab-imperial.github.io") {
  return new Request(`https://api.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
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

test("active members are listed for the reservation selector", async () => {
  const { environment } = mutationEnvironment();
  const response = await worker.fetch(new Request("https://api.example/api/v1/members"), environment);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).members, [{ username: "ranul", displayName: "Ranul" }]);
});

test("active NFC labels resolve by hash without exposing the raw token", async () => {
  const { environment, state } = mutationEnvironment({
    nfcLabel: { asset_code: "ROB-003", token_hint: "-003-v1" },
  });
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/nfc/demo-rob-003-v1"),
    environment,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    label: { assetCode: "ROB-003", tokenHint: "-003-v1" },
  });
  assert.match(state.lastNfcHash, /^[a-f0-9]{64}$/);
  assert.notEqual(state.lastNfcHash, "demo-rob-003-v1");
});

test("unknown and malformed NFC labels return stable errors", async () => {
  const { environment } = mutationEnvironment();
  const missing = await worker.fetch(
    new Request("https://api.example/api/v1/nfc/demo-rob-999-v1"),
    environment,
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "nfc_label_not_found");

  const invalid = await worker.fetch(
    new Request("https://api.example/api/v1/nfc/short"),
    environment,
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_nfc_token");
});

test("reservation creation accepts overlapping advisory bookings and audits the write", async () => {
  const { environment, state } = mutationEnvironment();
  const response = await worker.fetch(
    postRequest("/api/v1/equipment/ROB-003/reservations", {
      username: "ranul",
      startsAt: "2026-10-03T09:00:00.000Z",
      endsAt: "2026-10-04T17:00:00.000Z",
      canShare: true,
      sharingNotes: "Ask first",
    }),
    environment,
  );
  assert.equal(response.status, 201);
  const { reservation } = await response.json();
  assert.equal(reservation.assetCode, "ROB-003");
  assert.equal(reservation.memberName, "Ranul");
  assert.equal(reservation.canShare, true);
  assert.equal(state.writes.length, 1);
  assert.match(state.writes[0][0].query, /INSERT INTO reservations/);
  assert.match(state.writes[0][1].query, /INSERT INTO audit_events/);
});

test("checkout creates one open checkout and rejects an existing one", async () => {
  const first = mutationEnvironment();
  const response = await worker.fetch(
    postRequest("/api/v1/equipment/ROB-003/checkouts", {
      username: "ranul",
      expectedReturnAt: "2099-10-04T17:00:00.000Z",
      checkoutNotes: "Bench test",
    }),
    first.environment,
  );
  assert.equal(response.status, 201);
  assert.match(first.state.writes[0][0].query, /INSERT INTO checkouts/);

  const existing = mutationEnvironment({ openCheckout: { id: "checkout-open" } });
  const conflict = await worker.fetch(
    postRequest("/api/v1/equipment/ROB-003/checkouts", { username: "ranul" }),
    existing.environment,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "already_checked_out");
});

test("return requires the current holder username", async () => {
  const { environment, state } = mutationEnvironment({
    currentCheckout: {
      id: "checkout-1",
      equipment_id: "equipment-1",
      checked_out_at: "2026-10-02T09:00:00.000Z",
      member_id: "member-1",
      username: "ranul",
      display_name: "Ranul",
      asset_code: "ROB-003",
    },
  });
  const mismatch = await worker.fetch(
    postRequest("/api/v1/equipment/ROB-003/return", { username: "someone-else" }),
    environment,
  );
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, "username_mismatch");

  const returned = await worker.fetch(
    postRequest("/api/v1/equipment/ROB-003/return", { username: "RANUL", returnNotes: "Complete" }),
    environment,
  );
  assert.equal(returned.status, 200);
  assert.equal((await returned.json()).checkout.returnNotes, "Complete");
  assert.match(state.writes[0][0].query, /UPDATE checkouts/);
});

test("write routes reject a different browser origin", async () => {
  const { environment } = mutationEnvironment();
  const response = await worker.fetch(
    postRequest(
      "/api/v1/equipment/ROB-003/reservations",
      { username: "ranul", startsAt: "2026-10-03T09:00:00.000Z" },
      "https://malicious.example",
    ),
    environment,
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "origin_not_allowed");
});
