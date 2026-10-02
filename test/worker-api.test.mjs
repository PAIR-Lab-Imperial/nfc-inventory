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
  photo_url: "https://example.test/reachy.jpg",
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
      return { results: this.state.members.map(({ id, display_name }) => ({ id, display_name })) };
    }
    return { results: [] };
  }

  async first() {
    if (this.query.includes("FROM admin_login_attempts")) return this.state.loginAttempt;
    if (this.query.includes("AS equipment_count")) return this.state.adminSummary;
    if (this.query.includes("FROM nfc_labels")) {
      this.state.lastNfcHash = this.parameters[0];
      return this.state.nfcLabel;
    }
    if (this.query.includes("JOIN equipment ON equipment.id = checkout.equipment_id")) {
      return this.state.currentCheckout;
    }
    if (this.query.includes("FROM checkouts")) return this.state.openCheckout;
    if (this.query.includes("FROM categories")) return this.state.categoryRecord;
    if (this.query.includes("FROM proposal_options")) return this.state.proposalOptionRecord;
    if (this.query.includes("FROM proposals")) return this.state.proposalRecord;
    if (this.query.includes("FROM equipment")) return this.state.equipmentRecord;
    if (this.query.includes("FROM members") && (this.query.includes("WHERE username") || this.query.includes("WHERE id"))) return this.state.memberRecord;
    return null;
  }

  async run() {
    this.state.runs.push(this);
    return { success: true };
  }
}

function mutationEnvironment({ openCheckout = null, currentCheckout = null, nfcLabel = null, loginAttempt = null } = {}) {
  const state = {
    openCheckout,
    currentCheckout,
    nfcLabel,
    lastNfcHash: null,
    loginAttempt,
    runs: [],
    adminSummary: {
      equipment_count: 31,
      category_count: 9,
      active_member_count: 6,
      active_label_count: 31,
      open_checkout_count: 0,
      active_reservation_count: 0,
      proposed_count: 0,
      ordered_count: 0,
      received_count: 0,
    },
    members: [{ id: "member-1", username: "ranul", display_name: "Ranul" }],
    categoryRecord: { id: "category-1", asset_code_prefix: "ROB" },
    equipmentRecord: { id: "equipment-1", asset_code: "ROB-003", name: "Reachy Mini Wireless" },
    memberRecord: { id: "member-1", display_name: "Ranul", active: 1, notes: null },
    adminEquipment: [{
      asset_code: "ROB-003", name: "Reachy Mini Wireless", category: "Robots", item_type: "bundle",
      manufacturer: "Pollen Robotics", model: "Mini", serial_number: "R-001",
      public_specifications: "Wireless robot platform", location: "PAIR Lab", condition: "good",
      lifecycle_status: "active", purchase_date: "2026-09-01", purchase_price_minor: 100000,
      currency: "GBP", supplier: "Supplier", public_notes: null, admin_notes: "Pilot",
      primary_photo_url: "https://example.test/reachy.jpg", availability: "free",
    }],
    adminComponents: [{
      asset_code: "ROB-003", component_name: "Robot", manufacturer: "Pollen Robotics", model: "Mini",
      serial_number: "R-001", quantity: 1, required_on_return: 1, notes: null,
      photo_url: "https://example.test/robot.jpg", display_order: 0,
    }],
    adminLabels: [{
      id: "label-1", asset_code: "ROB-003", token_hint: "003-v1", status: "active",
      scan_url: "https://pair-lab-imperial.github.io/nfc-inventory/?t=demo-rob-003-v1",
      notes: null, created_at: "2026-10-01T10:00:00.000Z", retired_at: null,
    }],
    adminCategories: [{ name: "Robots", asset_code_prefix: "ROB", description: "Robot platforms" }],
    adminFiles: [{ asset_code: "ROB-003", kind: "manual", external_url: "https://example.test/manual.pdf", filename: "manual.pdf", description: "Manual" }],
    adminProposals: [{
      id: "proposal-1", title: "Mobile depth camera", requirement: "Portable depth sensing",
      status: "proposed", selected_option_id: null, admin_notes: null,
      created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z",
      requested_by_username: "ranul", requested_by: "Ranul", received_asset_code: null,
    }],
    adminProposalOptions: [{
      id: "option-1", proposal_id: "proposal-1", name: "Camera A",
      product_url: "https://example.test/camera-a", supplier: "Supplier",
      quoted_price_minor: 12500, currency: "GBP", notes: "Compact", selected_option_id: null,
    }],
    proposalRecord: {
      id: "proposal-1", title: "Mobile depth camera", status: "proposed",
      selected_option_id: null, received_equipment_id: null, admin_notes: null,
    },
    proposalOptionRecord: { id: "option-1", name: "Camera A" },
    operationalReservations: [],
    operationalCheckouts: [],
    operationalAudit: [],
    operationalBackups: [],
    writes: [],
  };
  const environment = {
    ALLOWED_ORIGIN: "https://pair-lab-imperial.github.io",
    ADMIN_USERNAME: "test-admin",
    ADMIN_PASSWORD: "test-password-long-enough",
    DB: {
      prepare(query) {
        return new MutationStatement(query, state);
      },
      async batch(statements) {
        if (statements.length === 8 && statements[0]?.query.includes("primary_photo_url")) {
          return [
            { results: state.adminEquipment },
            { results: state.adminComponents },
            { results: state.members.map((member) => ({ ...member, active: 1, notes: null })) },
            { results: state.adminLabels },
            { results: state.adminCategories },
            { results: state.adminFiles },
            { results: state.adminProposals },
            { results: state.adminProposalOptions },
          ];
        }
        if (statements.length === 2 && statements[0]?.query.includes("FROM proposals proposal")) {
          return [{ results: state.adminProposals }, { results: state.adminProposalOptions }];
        }
        if (statements.length === 4 && statements[0]?.query.includes("FROM reservations reservation")) {
          return [
            { results: state.operationalReservations },
            { results: state.operationalCheckouts },
            { results: state.operationalAudit },
            { results: state.operationalBackups },
          ];
        }
        if (statements[0]?.query.includes("SELECT id, asset_code, name, lifecycle_status")) {
          const memberStatement = statements[1];
          const memberResults = state.members.filter((member) => {
            const usernameMatches = member.username.toLocaleLowerCase("en-GB") === String(memberStatement.parameters[0]).toLocaleLowerCase("en-GB");
            const idMatches = !memberStatement.query.includes("id = ?2") || member.id === memberStatement.parameters[1];
            return usernameMatches && idMatches;
          });
          return [
            { results: [{ id: "equipment-1", asset_code: "ROB-003", name: "Reachy Mini Wireless", lifecycle_status: "active" }] },
            { results: memberResults },
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

async function loginAdmin(environment) {
  const response = await worker.fetch(
    postRequest("/api/v1/admin/login", { username: "test-admin", password: "test-password-long-enough" }),
    environment,
  );
  assert.equal(response.status, 200);
  return (await response.json()).session.token;
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
              ? [{ component_name: "Robot", manufacturer: null, model: null, quantity: 1, required_on_return: 1, notes: null, photo_url: "https://example.test/robot.jpg" }]
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
    photoUrl: "https://example.test/reachy.jpg",
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
  assert.equal(item.components[0].photoUrl, "https://example.test/robot.jpg");
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

test("active members are listed without exposing usernames", async () => {
  const { environment } = mutationEnvironment();
  const response = await worker.fetch(new Request("https://api.example/api/v1/members"), environment);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).members, [{ id: "member-1", displayName: "Ranul" }]);
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
      memberId: "member-1",
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

test("reservation confirmation rejects a username that does not match the selected display name", async () => {
  const { environment } = mutationEnvironment();
  const response = await worker.fetch(
    postRequest("/api/v1/equipment/ROB-003/reservations", {
      memberId: "member-1",
      username: "someone-else",
      startsAt: "2026-10-03T09:00:00.000Z",
      endsAt: "2026-10-04T17:00:00.000Z",
    }),
    environment,
  );
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "member_not_found");
  assert.match(body.error.message, /do not match/);
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

test("administrator login issues a signed session that protects the summary", async () => {
  const { environment } = mutationEnvironment();
  const login = await worker.fetch(
    postRequest("/api/v1/admin/login", {
      username: "test-admin",
      password: "test-password-long-enough",
    }),
    environment,
  );
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.session.username, "test-admin");
  assert.match(loginBody.session.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const summary = await worker.fetch(
    new Request("https://api.example/api/v1/admin/summary", {
      headers: { authorization: `Bearer ${loginBody.session.token}` },
    }),
    environment,
  );
  assert.equal(summary.status, 200);
  const summaryBody = await summary.json();
  assert.equal(summaryBody.admin.username, "test-admin");
  assert.equal(summaryBody.summary.equipmentCount, 31);
  assert.equal(summaryBody.summary.activeLabelCount, 31);
});

test("administrator routes reject invalid credentials and tampered sessions", async () => {
  const { environment, state } = mutationEnvironment();
  const rejected = await worker.fetch(
    postRequest("/api/v1/admin/login", {
      username: "test-admin",
      password: "wrong-password",
    }),
    environment,
  );
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error.code, "invalid_credentials");
  assert.equal(state.runs.length, 1);

  const unauthorized = await worker.fetch(
    new Request("https://api.example/api/v1/admin/summary", {
      headers: { authorization: "Bearer invalid.token" },
    }),
    environment,
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "invalid_session");
});

test("administrator login locks after repeated failures", async () => {
  const { environment } = mutationEnvironment({
    loginAttempt: {
      window_started_at: new Date(Date.now() - 60_000).toISOString(),
      failed_attempts: 4,
      locked_until: null,
    },
  });
  const response = await worker.fetch(
    postRequest("/api/v1/admin/login", {
      username: "test-admin",
      password: "wrong-password",
    }),
    environment,
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "login_temporarily_locked");
});

test("administrator data includes equipment photos, bundle photos, members and NFC labels", async () => {
  const { environment } = mutationEnvironment();
  const token = await loginAdmin(environment);
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/admin/data", { headers: { authorization: `Bearer ${token}` } }),
    environment,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.equipment[0].photoUrl, "https://example.test/reachy.jpg");
  assert.equal(body.equipment[0].components[0].photoUrl, "https://example.test/robot.jpg");
  assert.equal(body.members[0].username, "ranul");
  assert.equal(body.labels[0].tokenHint, "003-v1");
  assert.match(body.labels[0].scanUrl, /\?t=demo-rob-003-v1$/);
  assert.equal(body.equipment[0].files[0].kind, "manual");
  assert.equal(body.proposals[0].options[0].name, "Camera A");
});

test("public proposal routes list and create equipment suggestions", async () => {
  const { environment, state } = mutationEnvironment();
  const listResponse = await worker.fetch(new Request("https://api.example/api/v1/proposals"), environment);
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.proposals[0].title, "Mobile depth camera");
  assert.equal(listBody.proposals[0].options[0].quotedPrice, 125);

  const createResponse = await worker.fetch(
    postRequest("/api/v1/proposals", {
      requestedByMemberId: "member-1",
      title: "New camera",
      requirement: "Portable depth sensing",
      options: [
        { name: "Camera A", productUrl: "https://example.test/camera-a", quotedPrice: 125, currency: "GBP" },
        { name: "Camera B", productUrl: "https://example.test/camera-b", quotedPrice: 150, currency: "GBP" },
      ],
    }),
    environment,
  );
  assert.equal(createResponse.status, 201);
  const createBody = await createResponse.json();
  assert.equal(createBody.proposal.status, "proposed");
  const writes = state.writes.at(-1);
  assert.equal(writes.length, 4);
  assert.match(writes[0].query, /INSERT INTO proposals/);
  assert.match(writes[1].query, /INSERT INTO proposal_options/);
  assert.match(writes[3].query, /proposal\.created/);
});

test("administrator can select and order a proposed option", async () => {
  const { environment, state } = mutationEnvironment();
  const token = await loginAdmin(environment);
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/admin/proposals/proposal-1", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "https://pair-lab-imperial.github.io",
      },
      body: JSON.stringify({ status: "ordered", selectedOptionId: "option-1", adminNotes: "Approved" }),
    }),
    environment,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.proposal.status, "ordered");
  assert.equal(body.proposal.selectedOptionName, "Camera A");
  const writes = state.writes.at(-1);
  assert.match(writes[0].query, /UPDATE proposals SET/);
  assert.match(writes[1].query, /proposal\.updated/);
});

test("administrator operational export is protected and structured", async () => {
  const { environment } = mutationEnvironment();
  const unauthorized = await worker.fetch(new Request("https://api.example/api/v1/admin/export/operations"), environment);
  assert.equal(unauthorized.status, 401);
  const token = await loginAdmin(environment);
  const response = await worker.fetch(new Request("https://api.example/api/v1/admin/export/operations", {
    headers: { authorization: `Bearer ${token}` },
  }), environment);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.exportedBy, "test-admin");
  assert.deepEqual(body.reservations, []);
  assert.deepEqual(body.backupRuns, []);
});

test("administrator can update a bundle and its component photos", async () => {
  const { environment, state } = mutationEnvironment();
  const token = await loginAdmin(environment);
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/admin/equipment/ROB-003", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "https://pair-lab-imperial.github.io",
      },
      body: JSON.stringify({
        name: "Reachy Mini Wireless",
        category: "Robots",
        itemType: "bundle",
        lifecycleStatus: "active",
        currency: "GBP",
        photoUrl: "https://example.test/reachy-new.jpg",
        components: [{ name: "Robot", quantity: 1, requiredOnReturn: true, photoUrl: "https://example.test/robot-new.jpg" }],
      }),
    }),
    environment,
  );
  assert.equal(response.status, 200);
  const writes = state.writes.at(-1);
  assert.match(writes[0].query, /UPDATE equipment SET/);
  assert.match(writes[1].query, /DELETE FROM bundle_components/);
  assert.match(writes[2].query, /INSERT INTO bundle_components/);
  assert.equal(writes[0].parameters[16], "https://example.test/reachy-new.jpg");
  assert.equal(writes[2].parameters[9], "https://example.test/robot-new.jpg");
});

test("administrator generates and stores a recoverable replacement NFC URL", async () => {
  const { environment, state } = mutationEnvironment();
  const token = await loginAdmin(environment);
  const response = await worker.fetch(
    new Request("https://api.example/api/v1/admin/labels", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "https://pair-lab-imperial.github.io",
      },
      body: JSON.stringify({ assetCode: "ROB-003", notes: "Replacement test" }),
    }),
    environment,
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.label.scanUrl, /^https:\/\/pair-lab-imperial\.github\.io\/nfc-inventory\/\?t=/);
  const writes = state.writes.at(-1);
  assert.match(writes[0].query, /status = 'replaced'/);
  assert.match(writes[1].parameters[2], /^[a-f0-9]{64}$/);
  assert.equal(writes[1].parameters.includes(body.label.scanUrl), true);
});
