const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const AVAILABILITY_VALUES = new Set([
  "free",
  "reserved",
  "in_use",
  "maintenance",
  "missing",
  "retired",
]);

class RequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function withCors(headers, origin) {
  const result = new Headers(headers);
  result.set("access-control-allow-origin", origin);
  result.set("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  result.set("access-control-allow-headers", "content-type");
  result.set("vary", "Origin");
  return result;
}

function json(data, init = {}, origin = "*") {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: withCors({ ...jsonHeaders, ...init.headers }, origin),
  });
}

function errorResponse(code, message, status, origin) {
  return json({ error: { code, message } }, { status }, origin);
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 10_000) {
    throw new RequestError("request_too_large", "Request body is too large", 413);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new RequestError("invalid_json", "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("invalid_body", "Request body must be a JSON object");
  }
  return body;
}

function requiredText(body, field, maxLength = 100) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (!value) throw new RequestError("invalid_body", `${field} is required`);
  if (value.length > maxLength) throw new RequestError("invalid_body", `${field} is too long`);
  return value;
}

function optionalText(body, field, maxLength = 500) {
  if (body[field] === null || body[field] === undefined || body[field] === "") return null;
  if (typeof body[field] !== "string") throw new RequestError("invalid_body", `${field} must be text`);
  const value = body[field].trim();
  if (value.length > maxLength) throw new RequestError("invalid_body", `${field} is too long`);
  return value || null;
}

function timestamp(body, field, { required = false } = {}) {
  const value = body[field];
  if ((value === null || value === undefined || value === "") && !required) return null;
  if (typeof value !== "string") throw new RequestError("invalid_body", `${field} must be an ISO-8601 timestamp`);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new RequestError("invalid_body", `${field} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

function requireWriteOrigin(request, allowedOrigin) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== allowedOrigin) {
    throw new RequestError("origin_not_allowed", "This action is not allowed from the requesting site", 403);
  }
}

function decodeAssetCode(value) {
  let assetCode;
  try {
    assetCode = decodeURIComponent(value);
  } catch {
    throw new RequestError("invalid_asset_code", "Invalid equipment asset code");
  }
  if (!/^[A-Z][A-Z0-9]{1,7}-\d{3,6}$/i.test(assetCode)) {
    throw new RequestError("invalid_asset_code", "Invalid equipment asset code");
  }
  return assetCode;
}

function decodeNfcToken(value) {
  let token;
  try {
    token = decodeURIComponent(value);
  } catch {
    throw new RequestError("invalid_nfc_token", "Invalid NFC label identifier");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    throw new RequestError("invalid_nfc_token", "Invalid NFC label identifier");
  }
  return token;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nullableBoolean(value) {
  return value === null || value === undefined ? null : value === 1;
}

function mapEquipmentSummary(row) {
  return {
    assetCode: row.asset_code,
    name: row.name,
    category: row.category,
    itemType: row.item_type,
    manufacturer: row.manufacturer,
    model: row.model,
    location: row.location,
    condition: row.condition,
    lifecycleStatus: row.lifecycle_status,
    availability: row.availability,
    currentUser: row.current_user,
    reservedUntil: row.reserved_until,
    canShare: nullableBoolean(row.can_share),
  };
}

function mapEquipmentDetail(row) {
  return {
    ...mapEquipmentSummary(row),
    publicSpecifications: row.public_specifications,
    purchaseDate: row.purchase_date,
    publicNotes: row.public_notes,
  };
}

function validateCatalogueQuery(searchParams) {
  const search = (searchParams.get("search") || "").trim();
  const category = (searchParams.get("category") || "").trim();
  const availability = (searchParams.get("availability") || "").trim();
  if (search.length > 100) return { error: "search may not exceed 100 characters" };
  if (category.length > 100) return { error: "category may not exceed 100 characters" };
  if (availability && !AVAILABILITY_VALUES.has(availability)) {
    return { error: "availability is not a supported value" };
  }
  return { search, category, availability };
}

async function listEquipment(env, url, origin) {
  const filters = validateCatalogueQuery(url.searchParams);
  if (filters.error) return errorResponse("invalid_query", filters.error, 400, origin);

  const clauses = [];
  const parameters = [];
  if (filters.search) {
    const escaped = filters.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    parameters.push(`%${escaped}%`);
    clauses.push(`(
      e.asset_code LIKE ?${parameters.length} ESCAPE '\\' COLLATE NOCASE
      OR e.name LIKE ?${parameters.length} ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(e.manufacturer, '') LIKE ?${parameters.length} ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(e.model, '') LIKE ?${parameters.length} ESCAPE '\\' COLLATE NOCASE
    )`);
  }
  if (filters.category) {
    parameters.push(filters.category);
    clauses.push(`cat.name = ?${parameters.length} COLLATE NOCASE`);
  }
  if (filters.availability) {
    parameters.push(filters.availability);
    clauses.push(`state.availability = ?${parameters.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const catalogueStatement = env.DB.prepare(`
    SELECT
      e.asset_code,
      e.name,
      cat.name AS category,
      e.item_type,
      e.manufacturer,
      e.model,
      e.location,
      e.condition,
      e.lifecycle_status,
      state.availability,
      CASE state.availability
        WHEN 'in_use' THEN (
          SELECT m.display_name
          FROM checkouts checkout
          JOIN members m ON m.id = checkout.member_id
          WHERE checkout.equipment_id = e.id AND checkout.returned_at IS NULL
          LIMIT 1
        )
        WHEN 'reserved' THEN (
          SELECT m.display_name
          FROM reservations reservation
          JOIN members m ON m.id = reservation.member_id
          WHERE reservation.equipment_id = e.id
            AND reservation.status = 'active'
            AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY reservation.created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END AS current_user,
      CASE state.availability
        WHEN 'reserved' THEN (
          SELECT reservation.ends_at
          FROM reservations reservation
          WHERE reservation.equipment_id = e.id
            AND reservation.status = 'active'
            AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY reservation.created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END AS reserved_until,
      CASE state.availability
        WHEN 'reserved' THEN (
          SELECT reservation.can_share
          FROM reservations reservation
          WHERE reservation.equipment_id = e.id
            AND reservation.status = 'active'
            AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY reservation.created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END AS can_share
    FROM equipment e
    JOIN categories cat ON cat.id = e.category_id
    JOIN equipment_current_state state ON state.equipment_id = e.id
    ${where}
    ORDER BY cat.name COLLATE NOCASE, e.name COLLATE NOCASE, e.asset_code COLLATE NOCASE
    LIMIT 100
  `).bind(...parameters);

  const categoriesStatement = env.DB.prepare(`
    SELECT c.name, c.asset_code_prefix, COUNT(e.id) AS equipment_count
    FROM categories c
    LEFT JOIN equipment e ON e.category_id = c.id
    WHERE c.active = 1
    GROUP BY c.id, c.name, c.asset_code_prefix
    ORDER BY c.name COLLATE NOCASE
  `);

  const [catalogueResult, categoriesResult] = await env.DB.batch([
    catalogueStatement,
    categoriesStatement,
  ]);
  const items = catalogueResult.results.map(mapEquipmentSummary);
  return json(
    {
      items,
      count: items.length,
      categories: categoriesResult.results.map((row) => ({
        name: row.name,
        assetCodePrefix: row.asset_code_prefix,
        equipmentCount: row.equipment_count,
      })),
    },
    {},
    origin,
  );
}

async function getEquipment(env, assetCode, origin) {
  if (!/^[A-Z][A-Z0-9]{1,7}-\d{3,6}$/i.test(assetCode)) {
    return errorResponse("invalid_asset_code", "Invalid equipment asset code", 400, origin);
  }

  const itemStatement = env.DB.prepare(`
    SELECT
      e.asset_code,
      e.name,
      cat.name AS category,
      e.item_type,
      e.manufacturer,
      e.model,
      e.public_specifications,
      e.location,
      e.condition,
      e.lifecycle_status,
      e.purchase_date,
      e.public_notes,
      state.availability,
      CASE state.availability
        WHEN 'in_use' THEN (
          SELECT m.display_name
          FROM checkouts checkout
          JOIN members m ON m.id = checkout.member_id
          WHERE checkout.equipment_id = e.id AND checkout.returned_at IS NULL
          LIMIT 1
        )
        WHEN 'reserved' THEN (
          SELECT m.display_name
          FROM reservations reservation
          JOIN members m ON m.id = reservation.member_id
          WHERE reservation.equipment_id = e.id
            AND reservation.status = 'active'
            AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY reservation.created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END AS current_user,
      CASE state.availability
        WHEN 'reserved' THEN (
          SELECT reservation.ends_at
          FROM reservations reservation
          WHERE reservation.equipment_id = e.id
            AND reservation.status = 'active'
            AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY reservation.created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END AS reserved_until,
      CASE state.availability
        WHEN 'reserved' THEN (
          SELECT reservation.can_share
          FROM reservations reservation
          WHERE reservation.equipment_id = e.id
            AND reservation.status = 'active'
            AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ORDER BY reservation.created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END AS can_share
    FROM equipment e
    JOIN categories cat ON cat.id = e.category_id
    JOIN equipment_current_state state ON state.equipment_id = e.id
    WHERE e.asset_code = ?1 COLLATE NOCASE
    LIMIT 1
  `).bind(assetCode);

  const componentsStatement = env.DB.prepare(`
    SELECT
      component.component_name,
      component.manufacturer,
      component.model,
      component.quantity,
      component.required_on_return,
      component.notes
    FROM bundle_components component
    JOIN equipment e ON e.id = component.equipment_id
    WHERE e.asset_code = ?1 COLLATE NOCASE
    ORDER BY component.display_order, component.component_name COLLATE NOCASE
  `).bind(assetCode);

  const reservationsStatement = env.DB.prepare(`
    SELECT
      reservation.id,
      reservation.starts_at,
      reservation.ends_at,
      reservation.can_share,
      reservation.sharing_notes,
      member.display_name
    FROM reservations reservation
    JOIN equipment e ON e.id = reservation.equipment_id
    JOIN members member ON member.id = reservation.member_id
    WHERE e.asset_code = ?1 COLLATE NOCASE
      AND reservation.status = 'active'
      AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ORDER BY reservation.starts_at, reservation.created_at
    LIMIT 20
  `).bind(assetCode);

  const [itemResult, componentsResult, reservationsResult] = await env.DB.batch([
    itemStatement,
    componentsStatement,
    reservationsStatement,
  ]);
  const row = itemResult.results[0];
  if (!row) return errorResponse("equipment_not_found", "Equipment not found", 404, origin);

  return json(
    {
      item: {
        ...mapEquipmentDetail(row),
        components: componentsResult.results.map((component) => ({
          name: component.component_name,
          manufacturer: component.manufacturer,
          model: component.model,
          quantity: component.quantity,
          requiredOnReturn: component.required_on_return === 1,
          notes: component.notes,
        })),
        reservations: reservationsResult.results.map((reservation) => ({
          id: reservation.id,
          startsAt: reservation.starts_at,
          endsAt: reservation.ends_at,
          canShare: reservation.can_share === 1,
          sharingNotes: reservation.sharing_notes,
          memberName: reservation.display_name,
        })),
      },
    },
    {},
    origin,
  );
}

async function listMembers(env, origin) {
  const result = await env.DB.prepare(`
    SELECT username, display_name
    FROM members
    WHERE active = 1
    ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE
  `).all();
  return json(
    {
      members: result.results.map((member) => ({
        username: member.username,
        displayName: member.display_name,
      })),
    },
    {},
    origin,
  );
}

async function resolveNfcLabel(env, token, origin) {
  const tokenHash = await sha256Hex(token);
  const label = await env.DB.prepare(`
    SELECT equipment.asset_code, label.token_hint
    FROM nfc_labels label
    JOIN equipment ON equipment.id = label.equipment_id
    WHERE label.token_hash = ?1 AND label.status = 'active'
    LIMIT 1
  `).bind(tokenHash).first();
  if (!label) {
    throw new RequestError("nfc_label_not_found", "This NFC label is unknown, replaced, or no longer active", 404);
  }
  return json(
    {
      label: {
        assetCode: label.asset_code,
        tokenHint: label.token_hint,
      },
    },
    {},
    origin,
  );
}

async function findEquipmentAndMember(env, assetCode, username) {
  const [equipmentResult, memberResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, asset_code, name, lifecycle_status
      FROM equipment
      WHERE asset_code = ?1 COLLATE NOCASE
      LIMIT 1
    `).bind(assetCode),
    env.DB.prepare(`
      SELECT id, username, display_name
      FROM members
      WHERE username = ?1 COLLATE NOCASE AND active = 1
      LIMIT 1
    `).bind(username),
  ]);
  const equipment = equipmentResult.results[0];
  const member = memberResult.results[0];
  if (!equipment) throw new RequestError("equipment_not_found", "Equipment not found", 404);
  if (!member) throw new RequestError("member_not_found", "Active member username not found", 404);
  if (equipment.lifecycle_status !== "active") {
    throw new RequestError("equipment_unavailable", `Equipment is marked as ${equipment.lifecycle_status}`, 409);
  }
  return { equipment, member };
}

async function createReservation(request, env, assetCode, origin) {
  requireWriteOrigin(request, origin);
  const body = await readJsonBody(request);
  const username = requiredText(body, "username", 80);
  const startsAt = timestamp(body, "startsAt", { required: true });
  const endsAt = timestamp(body, "endsAt");
  if (endsAt && endsAt <= startsAt) {
    throw new RequestError("invalid_time_range", "endsAt must be later than startsAt");
  }
  if (body.canShare !== undefined && typeof body.canShare !== "boolean") {
    throw new RequestError("invalid_body", "canShare must be true or false");
  }
  const canShare = body.canShare === true ? 1 : 0;
  const sharingNotes = optionalText(body, "sharingNotes");
  const { equipment, member } = await findEquipmentAndMember(env, assetCode, username);
  const reservationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  const reservation = {
    id: reservationId,
    assetCode: equipment.asset_code,
    memberName: member.display_name,
    startsAt,
    endsAt,
    canShare: canShare === 1,
    sharingNotes,
    status: "active",
  };

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO reservations (
        id, equipment_id, member_id, starts_at, ends_at, can_share,
        sharing_notes, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8)
    `).bind(reservationId, equipment.id, member.id, startsAt, endsAt, canShare, sharingNotes, now),
    env.DB.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_name, action, entity_type, entity_id,
        after_json, created_at
      ) VALUES (?1, 'member', ?2, 'reservation.created', 'reservation', ?3, ?4, ?5)
    `).bind(auditId, member.display_name, reservationId, JSON.stringify(reservation), now),
  ]);

  return json({ reservation }, { status: 201 }, origin);
}

async function createCheckout(request, env, assetCode, origin) {
  requireWriteOrigin(request, origin);
  const body = await readJsonBody(request);
  const username = requiredText(body, "username", 80);
  const expectedReturnAt = timestamp(body, "expectedReturnAt");
  const checkoutNotes = optionalText(body, "checkoutNotes");
  const { equipment, member } = await findEquipmentAndMember(env, assetCode, username);
  const openCheckout = await env.DB.prepare(`
    SELECT id
    FROM checkouts
    WHERE equipment_id = ?1 AND returned_at IS NULL
    LIMIT 1
  `).bind(equipment.id).first();
  if (openCheckout) {
    throw new RequestError("already_checked_out", "Equipment is already checked out", 409);
  }

  const checkoutId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  if (expectedReturnAt && expectedReturnAt <= now) {
    throw new RequestError("invalid_time_range", "expectedReturnAt must be in the future");
  }
  const checkout = {
    id: checkoutId,
    assetCode: equipment.asset_code,
    memberName: member.display_name,
    checkedOutAt: now,
    expectedReturnAt,
    checkoutNotes,
  };

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO checkouts (
          id, equipment_id, member_id, checked_out_at, expected_return_at,
          checkout_notes, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4)
      `).bind(checkoutId, equipment.id, member.id, now, expectedReturnAt, checkoutNotes),
      env.DB.prepare(`
        INSERT INTO audit_events (
          id, actor_type, actor_name, action, entity_type, entity_id,
          after_json, created_at
        ) VALUES (?1, 'member', ?2, 'checkout.created', 'checkout', ?3, ?4, ?5)
      `).bind(auditId, member.display_name, checkoutId, JSON.stringify(checkout), now),
    ]);
  } catch (error) {
    if (String(error).toLocaleLowerCase("en-GB").includes("unique")) {
      throw new RequestError("already_checked_out", "Equipment is already checked out", 409);
    }
    throw error;
  }

  return json({ checkout }, { status: 201 }, origin);
}

async function returnEquipment(request, env, assetCode, origin) {
  requireWriteOrigin(request, origin);
  const body = await readJsonBody(request);
  const username = requiredText(body, "username", 80);
  const returnNotes = optionalText(body, "returnNotes");
  const result = await env.DB.prepare(`
    SELECT
      checkout.id,
      checkout.equipment_id,
      checkout.checked_out_at,
      member.id AS member_id,
      member.username,
      member.display_name,
      equipment.asset_code
    FROM checkouts checkout
    JOIN equipment ON equipment.id = checkout.equipment_id
    JOIN members member ON member.id = checkout.member_id
    WHERE equipment.asset_code = ?1 COLLATE NOCASE
      AND checkout.returned_at IS NULL
    LIMIT 1
  `).bind(assetCode).first();
  if (!result) throw new RequestError("not_checked_out", "Equipment is not currently checked out", 409);
  if (result.username.toLocaleLowerCase("en-GB") !== username.toLocaleLowerCase("en-GB")) {
    throw new RequestError("username_mismatch", "Username does not match the current holder", 409);
  }

  const returnedAt = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const before = {
    id: result.id,
    assetCode: result.asset_code,
    memberName: result.display_name,
    checkedOutAt: result.checked_out_at,
    returnedAt: null,
  };
  const after = { ...before, returnedAt, returnNotes };
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE checkouts
      SET returned_at = ?1, return_notes = ?2, updated_at = ?1
      WHERE id = ?3 AND returned_at IS NULL
    `).bind(returnedAt, returnNotes, result.id),
    env.DB.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_name, action, entity_type, entity_id,
        before_json, after_json, created_at
      ) VALUES (?1, 'member', ?2, 'checkout.returned', 'checkout', ?3, ?4, ?5, ?6)
    `).bind(auditId, result.display_name, result.id, JSON.stringify(before), JSON.stringify(after), returnedAt),
  ]);
  return json({ checkout: after }, {}, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://pair-lab-imperial.github.io";

    try {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors({}, allowedOrigin),
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        {
          ok: true,
          service: "pair-lab-nfc-inventory-api",
          version: "0.4.0",
        },
        {},
        allowedOrigin,
      );
    }

    if (request.method === "GET" && url.pathname === "/api/v1") {
      return json(
        {
          name: "PAIR Lab NFC Inventory API",
          version: "v1",
          status: "catalogue",
        },
        {},
        allowedOrigin,
      );
    }

    if (request.method === "GET" && url.pathname === "/api/v1/equipment") {
      return await listEquipment(env, url, allowedOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/members") {
      return await listMembers(env, allowedOrigin);
    }

    const nfcMatch = /^\/api\/v1\/nfc\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && nfcMatch) {
      const token = decodeNfcToken(nfcMatch[1]);
      return await resolveNfcLabel(env, token, allowedOrigin);
    }

    const equipmentActionMatch = /^\/api\/v1\/equipment\/([^/]+)\/(reservations|checkouts|return)$/.exec(url.pathname);
    if (request.method === "POST" && equipmentActionMatch) {
      const assetCode = decodeAssetCode(equipmentActionMatch[1]);
      if (equipmentActionMatch[2] === "reservations") {
        return await createReservation(request, env, assetCode, allowedOrigin);
      }
      if (equipmentActionMatch[2] === "checkouts") {
        return await createCheckout(request, env, assetCode, allowedOrigin);
      }
      return await returnEquipment(request, env, assetCode, allowedOrigin);
    }

    const equipmentMatch = /^\/api\/v1\/equipment\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && equipmentMatch) {
      const assetCode = decodeAssetCode(equipmentMatch[1]);
      return await getEquipment(env, assetCode, allowedOrigin);
    }

      return errorResponse("not_found", "Route not found", 404, allowedOrigin);
    } catch (error) {
      if (error instanceof RequestError) {
        return errorResponse(error.code, error.message, error.status, allowedOrigin);
      }
      console.error("Inventory API request failed", error);
      return errorResponse("internal_error", "The inventory service is temporarily unavailable", 500, allowedOrigin);
    }
  },
};
