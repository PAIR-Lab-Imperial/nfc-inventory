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
  "not_unboxed",
]);

const ADMIN_SESSION_SECONDS = 4 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const ITEM_TYPES = new Set(["individual", "bundle"]);
const CONDITIONS = new Set(["good", "fair", "damaged", "unknown"]);
const LIFECYCLE_STATUSES = new Set(["active", "maintenance", "missing", "retired"]);
const ADMIN_AVAILABILITY_VALUES = new Set(["free", "reserved", "in_use", "not_unboxed"]);
const PROPOSAL_STATUSES = new Set(["proposed", "ordered", "received"]);

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
  result.set("access-control-allow-methods", "GET, POST, PUT, PATCH, OPTIONS");
  result.set("access-control-allow-headers", "content-type, authorization");
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
  if (Number.isFinite(contentLength) && contentLength > 30_000) {
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

function optionalUrl(body, field) {
  const value = optionalText(body, field, 2000);
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new RequestError("invalid_body", `${field} must be a valid HTTP or HTTPS URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new RequestError("invalid_body", `${field} must be a valid HTTP or HTTPS URL`);
  }
  return parsed.href;
}

function optionalCalendarDate(body, field) {
  const value = optionalText(body, field, 10);
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RequestError("invalid_body", `${field} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new RequestError("invalid_body", `${field} must be a real calendar date`);
  }
  return value;
}

function enumText(body, field, allowed, { optional = false } = {}) {
  const value = optional ? optionalText(body, field, 50) : requiredText(body, field, 50);
  if (!value) return null;
  const normalized = value.toLocaleLowerCase("en-GB");
  if (!allowed.has(normalized)) throw new RequestError("invalid_body", `${field} is not supported`);
  return normalized;
}

function optionalBoolean(body, field, defaultValue) {
  if (body[field] === undefined) return defaultValue;
  if (typeof body[field] !== "boolean") throw new RequestError("invalid_body", `${field} must be true or false`);
  return body[field];
}

function purchasePriceMinor(body) {
  if (body.purchasePrice === null || body.purchasePrice === undefined || body.purchasePrice === "") return null;
  const value = Number(body.purchasePrice);
  if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new RequestError("invalid_body", "purchasePrice must be a non-negative amount with at most two decimal places");
  }
  return Math.round(value * 100);
}

function optionalMoneyMinor(body, field) {
  if (body[field] === null || body[field] === undefined || body[field] === "") return null;
  const value = Number(body[field]);
  if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new RequestError("invalid_body", `${field} must be a non-negative amount with at most two decimal places`);
  }
  return Math.round(value * 100);
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

function decodeRecordId(value, label = "record") {
  let recordId;
  try {
    recordId = decodeURIComponent(value);
  } catch {
    throw new RequestError("invalid_record_id", `Invalid ${label} identifier`);
  }
  if (!/^[A-Za-z0-9-]{8,80}$/.test(recordId)) {
    throw new RequestError("invalid_record_id", `Invalid ${label} identifier`);
  }
  return recordId;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RequestError("invalid_session", "Administrator session is invalid", 401);
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    throw new RequestError("invalid_session", "Administrator session is invalid", 401);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeBytesEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function timingSafeTextEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  return timingSafeBytesEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

function adminConfiguration(env) {
  const username = typeof env.ADMIN_USERNAME === "string" ? env.ADMIN_USERNAME.trim() : "";
  const password = typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
  if (!username || password.length < 12) throw new Error("Administrator credentials are not configured");
  return { username, password };
}

async function hmacSignature(value, password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function createAdminSession(username, password) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    sub: username,
    iat: issuedAt,
    exp: issuedAt + ADMIN_SESSION_SECONDS,
  })));
  const signature = bytesToBase64Url(await hmacSignature(payload, password));
  return { token: `${payload}.${signature}`, expiresAt: new Date((issuedAt + ADMIN_SESSION_SECONDS) * 1000).toISOString() };
}

async function requireAdmin(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match) throw new RequestError("admin_auth_required", "Administrator sign-in is required", 401);
  const [payloadPart, signaturePart] = match[1].split(".");
  const { username, password } = adminConfiguration(env);
  const expectedSignature = await hmacSignature(payloadPart, password);
  const suppliedSignature = base64UrlToBytes(signaturePart);
  if (!timingSafeBytesEqual(expectedSignature, suppliedSignature)) {
    throw new RequestError("invalid_session", "Administrator session is invalid or expired", 401);
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
  } catch {
    throw new RequestError("invalid_session", "Administrator session is invalid or expired", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload?.sub !== username || !Number.isInteger(payload.exp) || payload.exp <= now) {
    throw new RequestError("invalid_session", "Administrator session is invalid or expired", 401);
  }
  return { username, expiresAt: new Date(payload.exp * 1000).toISOString() };
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
    photoUrl: row.photo_url,
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
      e.primary_photo_url AS photo_url,
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
      e.primary_photo_url AS photo_url,
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
      component.notes,
      component.photo_url
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
          photoUrl: component.photo_url,
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
    SELECT id, display_name
    FROM members
    WHERE active = 1
    ORDER BY display_name COLLATE NOCASE, id
  `).all();
  return json(
    {
      members: result.results.map((member) => ({
        id: member.id,
        displayName: member.display_name,
      })),
    },
    {},
    origin,
  );
}

function proposalInput(body) {
  if (!Array.isArray(body.options) || body.options.length < 1 || body.options.length > 8) {
    throw new RequestError("invalid_body", "options must contain between 1 and 8 equipment choices");
  }
  const options = body.options.map((option, index) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      throw new RequestError("invalid_body", `options[${index}] must be an object`);
    }
    const productUrl = optionalUrl(option, "productUrl");
    if (!productUrl) throw new RequestError("invalid_body", `options[${index}].productUrl is required`);
    const quotedPriceMinor = optionalMoneyMinor(option, "quotedPrice");
    const currency = optionalText(option, "currency", 3)?.toUpperCase() || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new RequestError("invalid_body", `options[${index}].currency must be a three-letter code`);
    }
    if (quotedPriceMinor !== null && !currency) {
      throw new RequestError("invalid_body", `options[${index}].currency is required when quotedPrice is provided`);
    }
    return {
      id: crypto.randomUUID(),
      name: requiredText(option, "name", 200),
      productUrl,
      supplier: optionalText(option, "supplier", 200),
      quotedPriceMinor,
      currency,
      notes: optionalText(option, "notes", 1000),
      displayOrder: index,
    };
  });
  return {
    title: requiredText(body, "title", 180),
    requirement: requiredText(body, "requirement", 3000),
    requestedByMemberId: requiredText(body, "requestedByMemberId", 80),
    options,
  };
}

function mapProposalRows(proposalRows, optionRows, { includeAdmin = false } = {}) {
  const optionsByProposal = new Map();
  for (const row of optionRows) {
    const options = optionsByProposal.get(row.proposal_id) || [];
    options.push({
      id: row.id,
      name: row.name,
      productUrl: row.product_url,
      supplier: row.supplier,
      quotedPrice: row.quoted_price_minor === null ? null : row.quoted_price_minor / 100,
      currency: row.currency,
      notes: row.notes,
      selected: row.id === row.selected_option_id,
    });
    optionsByProposal.set(row.proposal_id, options);
  }
  return proposalRows.map((row) => ({
    id: row.id,
    title: row.title,
    requirement: row.requirement,
    requestedBy: row.requested_by,
    requestedByUsername: includeAdmin ? row.requested_by_username : undefined,
    status: row.status,
    selectedOptionId: row.selected_option_id,
    receivedAssetCode: row.received_asset_code,
    adminNotes: includeAdmin ? row.admin_notes : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    options: optionsByProposal.get(row.id) || [],
  }));
}

async function listProposals(env, origin) {
  const [proposalResult, optionResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT proposal.id, proposal.title, proposal.requirement, proposal.status,
        proposal.selected_option_id, proposal.created_at, proposal.updated_at,
        member.display_name AS requested_by,
        received_equipment.asset_code AS received_asset_code
      FROM proposals proposal
      LEFT JOIN members member ON member.id = proposal.requested_by_member_id
      LEFT JOIN equipment received_equipment ON received_equipment.id = proposal.received_equipment_id
      ORDER BY CASE proposal.status WHEN 'proposed' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
        proposal.updated_at DESC
      LIMIT 100
    `),
    env.DB.prepare(`
      SELECT option.id, option.proposal_id, option.name, option.product_url,
        option.supplier, option.quoted_price_minor, option.currency, option.notes,
        proposal.selected_option_id
      FROM proposal_options option
      JOIN proposals proposal ON proposal.id = option.proposal_id
      ORDER BY option.proposal_id, option.display_order, option.name COLLATE NOCASE
    `),
  ]);
  return json({ proposals: mapProposalRows(proposalResult.results, optionResult.results) }, {}, origin);
}

async function createProposal(request, env, origin) {
  requireWriteOrigin(request, origin);
  const data = proposalInput(await readJsonBody(request));
  const member = await env.DB.prepare(`
    SELECT id, display_name
    FROM members
    WHERE id = ?1 AND active = 1
    LIMIT 1
  `).bind(data.requestedByMemberId).first();
  if (!member) throw new RequestError("member_not_found", "Active member not found", 404);
  const proposalId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [env.DB.prepare(`
    INSERT INTO proposals (
      id, title, requirement, requested_by_member_id, status, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, 'proposed', ?5, ?5)
  `).bind(proposalId, data.title, data.requirement, member.id, now)];
  for (const option of data.options) {
    statements.push(env.DB.prepare(`
      INSERT INTO proposal_options (
        id, proposal_id, name, product_url, supplier, quoted_price_minor,
        currency, notes, display_order, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(
      option.id, proposalId, option.name, option.productUrl, option.supplier,
      option.quotedPriceMinor, option.currency, option.notes, option.displayOrder, now,
    ));
  }
  statements.push(env.DB.prepare(`
    INSERT INTO audit_events (
      id, actor_type, actor_name, action, entity_type, entity_id, after_json, created_at
    ) VALUES (?1, 'member', ?2, 'proposal.created', 'proposal', ?3, ?4, ?5)
  `).bind(
    crypto.randomUUID(), member.display_name, proposalId,
    JSON.stringify({ title: data.title, requirement: data.requirement, optionCount: data.options.length }), now,
  ));
  await env.DB.batch(statements);
  return json({ proposal: { id: proposalId, title: data.title, status: "proposed", createdAt: now } }, { status: 201 }, origin);
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

async function adminLogin(request, env, origin) {
  requireWriteOrigin(request, origin);
  const body = await readJsonBody(request);
  const suppliedUsername = requiredText(body, "username", 100);
  const suppliedPassword = requiredText(body, "password", 500);
  const { username, password } = adminConfiguration(env);
  const clientAddress = request.headers.get("cf-connecting-ip") || "local-development";
  const attemptKey = await sha256Hex(`admin-login\0${clientAddress}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const windowCutoff = new Date(now.valueOf() - LOGIN_WINDOW_SECONDS * 1000).toISOString();
  const attempt = await env.DB.prepare(`
    SELECT window_started_at, failed_attempts, locked_until
    FROM admin_login_attempts
    WHERE key_hash = ?1
    LIMIT 1
  `).bind(attemptKey).first();
  if (attempt?.locked_until && attempt.locked_until > nowIso) {
    throw new RequestError("login_temporarily_locked", "Too many failed attempts. Try again later", 429);
  }

  const [usernameMatches, passwordMatches] = await Promise.all([
    timingSafeTextEqual(suppliedUsername, username),
    timingSafeTextEqual(suppliedPassword, password),
  ]);
  if (!(usernameMatches && passwordMatches)) {
    const sameWindow = attempt?.window_started_at && attempt.window_started_at > windowCutoff;
    const failedAttempts = sameWindow ? attempt.failed_attempts + 1 : 1;
    const windowStartedAt = sameWindow ? attempt.window_started_at : nowIso;
    const lockedUntil = failedAttempts >= LOGIN_MAX_FAILURES
      ? new Date(now.valueOf() + LOGIN_WINDOW_SECONDS * 1000).toISOString()
      : null;
    await env.DB.prepare(`
      INSERT INTO admin_login_attempts (
        key_hash, window_started_at, failed_attempts, locked_until, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(key_hash) DO UPDATE SET
        window_started_at = excluded.window_started_at,
        failed_attempts = excluded.failed_attempts,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    `).bind(attemptKey, windowStartedAt, failedAttempts, lockedUntil, nowIso).run();
    if (lockedUntil) {
      throw new RequestError("login_temporarily_locked", "Too many failed attempts. Try again later", 429);
    }
    throw new RequestError("invalid_credentials", "Username or password is incorrect", 401);
  }

  const staleCutoff = new Date(now.valueOf() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_login_attempts WHERE key_hash = ?1").bind(attemptKey),
    env.DB.prepare("DELETE FROM admin_login_attempts WHERE updated_at < ?1").bind(staleCutoff),
  ]);
  const session = await createAdminSession(username, password);
  return json({ session: { ...session, username } }, {}, origin);
}

async function getAdminSession(request, env, origin) {
  const admin = await requireAdmin(request, env);
  return json({ session: admin }, {}, origin);
}

async function getAdminSummary(request, env, origin) {
  const admin = await requireAdmin(request, env);
  const summary = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM equipment) AS equipment_count,
      (SELECT COUNT(*) FROM categories WHERE active = 1) AS category_count,
      (SELECT COUNT(*) FROM members WHERE active = 1) AS active_member_count,
      (SELECT COUNT(*) FROM nfc_labels WHERE status = 'active') AS active_label_count,
      (SELECT COUNT(*) FROM nfc_labels WHERE status = 'active' AND written_at IS NOT NULL) AS written_label_count,
      (SELECT COUNT(*) FROM checkouts WHERE returned_at IS NULL) AS open_checkout_count,
      (SELECT COUNT(*) FROM reservations WHERE status = 'active' AND (ends_at IS NULL OR ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) AS active_reservation_count,
      (SELECT COUNT(*) FROM proposals WHERE status = 'proposed') AS proposed_count,
      (SELECT COUNT(*) FROM proposals WHERE status = 'ordered') AS ordered_count,
      (SELECT COUNT(*) FROM proposals WHERE status = 'received') AS received_count
  `).first();
  return json(
    {
      admin,
      summary: {
        equipmentCount: summary.equipment_count,
        categoryCount: summary.category_count,
        activeMemberCount: summary.active_member_count,
        activeLabelCount: summary.active_label_count,
        writtenLabelCount: summary.written_label_count,
        openCheckoutCount: summary.open_checkout_count,
        activeReservationCount: summary.active_reservation_count,
        proposals: {
          proposed: summary.proposed_count,
          ordered: summary.ordered_count,
          received: summary.received_count,
        },
      },
    },
    {},
    origin,
  );
}

function adminEquipmentInput(body) {
  const itemType = enumText(body, "itemType", ITEM_TYPES);
  const priceMinor = purchasePriceMinor(body);
  const currency = optionalText(body, "currency", 3)?.toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new RequestError("invalid_body", "currency must be a three-letter code");
  if (priceMinor !== null && !currency) throw new RequestError("invalid_body", "currency is required when purchasePrice is provided");
  if (body.components !== undefined && !Array.isArray(body.components)) {
    throw new RequestError("invalid_body", "components must be an array");
  }
  const componentNames = new Set();
  const components = (body.components || []).map((component, index) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      throw new RequestError("invalid_body", `components[${index}] must be an object`);
    }
    const name = requiredText(component, "name", 150);
    const key = name.toLocaleLowerCase("en-GB");
    if (componentNames.has(key)) throw new RequestError("invalid_body", `Duplicate component name: ${name}`);
    componentNames.add(key);
    const quantity = Number(component.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new RequestError("invalid_body", `components[${index}].quantity must be a whole number from 1 to 1000`);
    }
    return {
      id: crypto.randomUUID(),
      name,
      manufacturer: optionalText(component, "manufacturer", 150),
      model: optionalText(component, "model", 150),
      serialNumber: optionalText(component, "serialNumber", 200),
      quantity,
      requiredOnReturn: optionalBoolean(component, "requiredOnReturn", true),
      notes: optionalText(component, "notes", 500),
      photoUrl: optionalUrl(component, "photoUrl"),
      displayOrder: index,
    };
  });
  if (itemType === "individual" && components.length) {
    throw new RequestError("invalid_body", "Individual equipment cannot have bundle components");
  }
  return {
    name: requiredText(body, "name", 150),
    category: requiredText(body, "category", 150),
    itemType,
    manufacturer: optionalText(body, "manufacturer", 150),
    model: optionalText(body, "model", 150),
    serialNumber: optionalText(body, "serialNumber", 200),
    publicSpecifications: optionalText(body, "publicSpecifications", 2000),
    location: optionalText(body, "location", 200),
    condition: enumText(body, "condition", CONDITIONS, { optional: true }),
    lifecycleStatus: enumText(body, "lifecycleStatus", LIFECYCLE_STATUSES),
    purchaseDate: optionalCalendarDate(body, "purchaseDate"),
    purchasePriceMinor: priceMinor,
    currency,
    supplier: optionalText(body, "supplier", 200),
    publicNotes: optionalText(body, "publicNotes", 1000),
    adminNotes: optionalText(body, "adminNotes", 2000),
    photoUrl: optionalUrl(body, "photoUrl"),
    components,
  };
}

async function getAdminData(request, env, origin) {
  const admin = await requireAdmin(request, env);
  const [equipmentResult, componentsResult, membersResult, labelsResult, categoriesResult, filesResult, proposalsResult, proposalOptionsResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT
        e.asset_code, e.name, cat.name AS category, e.item_type, e.manufacturer,
        e.model, e.serial_number, e.public_specifications, e.location, e.condition,
        e.lifecycle_status, e.purchase_date, e.purchase_price_minor, e.currency,
        e.supplier, e.public_notes, e.admin_notes, e.primary_photo_url,
        state.availability,
        CASE state.availability
          WHEN 'in_use' THEN (
            SELECT member.display_name
            FROM checkouts checkout
            JOIN members member ON member.id = checkout.member_id
            WHERE checkout.equipment_id = e.id AND checkout.returned_at IS NULL
            ORDER BY checkout.checked_out_at DESC LIMIT 1
          )
          WHEN 'reserved' THEN (
            SELECT member.display_name
            FROM reservations reservation
            JOIN members member ON member.id = reservation.member_id
            WHERE reservation.equipment_id = e.id AND reservation.status = 'active'
              AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ORDER BY reservation.starts_at DESC LIMIT 1
          )
        END AS current_user,
        CASE state.availability
          WHEN 'in_use' THEN (
            SELECT member.username
            FROM checkouts checkout
            JOIN members member ON member.id = checkout.member_id
            WHERE checkout.equipment_id = e.id AND checkout.returned_at IS NULL
            ORDER BY checkout.checked_out_at DESC LIMIT 1
          )
          WHEN 'reserved' THEN (
            SELECT member.username
            FROM reservations reservation
            JOIN members member ON member.id = reservation.member_id
            WHERE reservation.equipment_id = e.id AND reservation.status = 'active'
              AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ORDER BY reservation.starts_at DESC LIMIT 1
          )
        END AS current_username,
        CASE state.availability
          WHEN 'in_use' THEN (
            SELECT checkout.expected_return_at FROM checkouts checkout
            WHERE checkout.equipment_id = e.id AND checkout.returned_at IS NULL
            ORDER BY checkout.checked_out_at DESC LIMIT 1
          )
          WHEN 'reserved' THEN (
            SELECT reservation.ends_at FROM reservations reservation
            WHERE reservation.equipment_id = e.id AND reservation.status = 'active'
              AND reservation.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              AND (reservation.ends_at IS NULL OR reservation.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ORDER BY reservation.starts_at DESC LIMIT 1
          )
        END AS availability_until
      FROM equipment e
      JOIN categories cat ON cat.id = e.category_id
      JOIN equipment_current_state state ON state.equipment_id = e.id
      ORDER BY e.asset_code COLLATE NOCASE
      LIMIT 200
    `),
    env.DB.prepare(`
      SELECT e.asset_code, component.component_name, component.manufacturer,
        component.model, component.serial_number, component.quantity,
        component.required_on_return, component.notes, component.photo_url,
        component.display_order
      FROM bundle_components component
      JOIN equipment e ON e.id = component.equipment_id
      ORDER BY e.asset_code COLLATE NOCASE, component.display_order, component.component_name COLLATE NOCASE
    `),
    env.DB.prepare(`
      SELECT username, display_name, active, notes
      FROM members
      ORDER BY active DESC, display_name COLLATE NOCASE
    `),
    env.DB.prepare(`
      SELECT label.id, e.asset_code, label.token_hint, label.scan_url,
        label.status, label.notes, label.created_at, label.retired_at,
        label.written_at, label.written_by
      FROM nfc_labels label
      JOIN equipment e ON e.id = label.equipment_id
      ORDER BY (label.status = 'active') DESC, e.asset_code COLLATE NOCASE, label.created_at DESC
      LIMIT 500
    `),
    env.DB.prepare(`
      SELECT name, asset_code_prefix, description
      FROM categories
      WHERE active = 1
      ORDER BY name COLLATE NOCASE
    `),
    env.DB.prepare(`
      SELECT equipment.asset_code, file.kind, file.external_url, file.filename, file.description
      FROM equipment_files file
      JOIN equipment ON equipment.id = file.equipment_id
      WHERE file.external_url IS NOT NULL
      ORDER BY equipment.asset_code COLLATE NOCASE, file.created_at
    `),
    env.DB.prepare(`
      SELECT proposal.id, proposal.title, proposal.requirement, proposal.status,
        proposal.selected_option_id, proposal.admin_notes, proposal.created_at,
        proposal.updated_at, member.username AS requested_by_username,
        member.display_name AS requested_by,
        received_equipment.asset_code AS received_asset_code
      FROM proposals proposal
      LEFT JOIN members member ON member.id = proposal.requested_by_member_id
      LEFT JOIN equipment received_equipment ON received_equipment.id = proposal.received_equipment_id
      ORDER BY proposal.updated_at DESC
      LIMIT 200
    `),
    env.DB.prepare(`
      SELECT option.id, option.proposal_id, option.name, option.product_url,
        option.supplier, option.quoted_price_minor, option.currency, option.notes,
        proposal.selected_option_id
      FROM proposal_options option
      JOIN proposals proposal ON proposal.id = option.proposal_id
      ORDER BY option.proposal_id, option.display_order, option.name COLLATE NOCASE
    `),
  ]);
  const componentsByAsset = new Map();
  for (const component of componentsResult.results) {
    const collection = componentsByAsset.get(component.asset_code) || [];
    collection.push({
      name: component.component_name,
      manufacturer: component.manufacturer,
      model: component.model,
      serialNumber: component.serial_number,
      quantity: component.quantity,
      requiredOnReturn: component.required_on_return === 1,
      notes: component.notes,
      photoUrl: component.photo_url,
    });
    componentsByAsset.set(component.asset_code, collection);
  }
  const filesByAsset = new Map();
  for (const file of filesResult.results) {
    const collection = filesByAsset.get(file.asset_code) || [];
    collection.push({ kind: file.kind, url: file.external_url, filename: file.filename, description: file.description });
    filesByAsset.set(file.asset_code, collection);
  }
  return json({
    admin,
    categories: categoriesResult.results.map((row) => ({ name: row.name, assetCodePrefix: row.asset_code_prefix, description: row.description })),
    equipment: equipmentResult.results.map((row) => ({
      assetCode: row.asset_code,
      name: row.name,
      category: row.category,
      itemType: row.item_type,
      manufacturer: row.manufacturer,
      model: row.model,
      serialNumber: row.serial_number,
      publicSpecifications: row.public_specifications,
      location: row.location,
      condition: row.condition,
      lifecycleStatus: row.lifecycle_status,
      purchaseDate: row.purchase_date,
      purchasePrice: row.purchase_price_minor === null ? null : row.purchase_price_minor / 100,
      currency: row.currency,
      supplier: row.supplier,
      publicNotes: row.public_notes,
      adminNotes: row.admin_notes,
      photoUrl: row.primary_photo_url,
      availability: row.availability,
      currentUser: row.current_user,
      currentUsername: row.current_username,
      availabilityUntil: row.availability_until,
      components: componentsByAsset.get(row.asset_code) || [],
      files: filesByAsset.get(row.asset_code) || [],
    })),
    members: membersResult.results.map((row) => ({
      username: row.username,
      displayName: row.display_name,
      active: row.active === 1,
      notes: row.notes,
    })),
    labels: labelsResult.results.map((row) => ({
      id: row.id,
      assetCode: row.asset_code,
      tokenHint: row.token_hint,
      scanUrl: row.scan_url,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      retiredAt: row.retired_at,
      writtenAt: row.written_at,
      writtenBy: row.written_by,
    })),
    proposals: mapProposalRows(proposalsResult.results, proposalOptionsResult.results, { includeAdmin: true }),
  }, {}, origin);
}

async function overrideAdminAvailability(request, env, origin, assetCode) {
  requireWriteOrigin(request, origin);
  const admin = await requireAdmin(request, env);
  const body = await readJsonBody(request);
  const availability = enumText(body, "availability", ADMIN_AVAILABILITY_VALUES);
  const note = optionalText(body, "note", 500);
  const canShare = optionalBoolean(body, "canShare", false);
  const until = timestamp(body, "until");
  const equipment = await env.DB.prepare(`
    SELECT equipment.id, equipment.asset_code, equipment.name,
      equipment.lifecycle_status, state.availability
    FROM equipment
    JOIN equipment_current_state state ON state.equipment_id = equipment.id
    WHERE equipment.asset_code = ?1 COLLATE NOCASE
    LIMIT 1
  `).bind(assetCode).first();
  if (!equipment) throw new RequestError("equipment_not_found", "Equipment not found", 404);
  if (equipment.lifecycle_status !== "active") {
    throw new RequestError("equipment_unavailable", "Only lifecycle-active equipment can receive an availability override", 409);
  }

  let member = null;
  if (["reserved", "in_use"].includes(availability)) {
    const username = validUsername(requiredText(body, "username", 80));
    member = await env.DB.prepare(`
      SELECT id, username, display_name
      FROM members
      WHERE username = ?1 COLLATE NOCASE AND active = 1
      LIMIT 1
    `).bind(username).first();
    if (!member) throw new RequestError("member_not_found", "Active member not found", 404);
  }

  const now = new Date().toISOString();
  if (until && until <= now) throw new RequestError("invalid_time_range", "until must be later than now");
  const statements = [
    env.DB.prepare(`
      UPDATE equipment
      SET availability_override = ?1, record_version = record_version + 1, updated_at = ?2
      WHERE id = ?3
    `).bind(availability === "not_unboxed" ? "not_unboxed" : null, now, equipment.id),
    env.DB.prepare(`
      UPDATE reservations
      SET status = 'cancelled', updated_at = ?2
      WHERE equipment_id = ?1 AND status = 'active'
        AND starts_at <= ?2
        AND (ends_at IS NULL OR ends_at > ?2)
    `).bind(equipment.id, now),
    env.DB.prepare(`
      UPDATE checkouts
      SET returned_at = ?2, return_notes = COALESCE(return_notes, ?3), updated_at = ?2
      WHERE equipment_id = ?1 AND returned_at IS NULL
    `).bind(equipment.id, now, note || "Closed by administrator availability override"),
  ];
  let createdRecordId = null;
  if (availability === "reserved") {
    createdRecordId = crypto.randomUUID();
    statements.push(env.DB.prepare(`
      INSERT INTO reservations (
        id, equipment_id, member_id, starts_at, ends_at, can_share,
        sharing_notes, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?4, ?4)
    `).bind(createdRecordId, equipment.id, member.id, now, until, canShare ? 1 : 0, note));
  } else if (availability === "in_use") {
    createdRecordId = crypto.randomUUID();
    statements.push(env.DB.prepare(`
      INSERT INTO checkouts (
        id, equipment_id, member_id, checked_out_at, expected_return_at,
        checkout_notes, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4)
    `).bind(createdRecordId, equipment.id, member.id, now, until, note));
  }
  const after = {
    assetCode: equipment.asset_code,
    availability,
    memberName: member?.display_name || null,
    until,
    canShare: availability === "reserved" && canShare,
    note,
    recordId: createdRecordId,
  };
  statements.push(env.DB.prepare(`
    INSERT INTO audit_events (
      id, actor_type, actor_name, action, entity_type, entity_id,
      before_json, after_json, created_at
    ) VALUES (?1, 'admin', ?2, 'equipment.availability_overridden', 'equipment', ?3, ?4, ?5, ?6)
  `).bind(
    crypto.randomUUID(), admin.username, equipment.id,
    JSON.stringify({ assetCode: equipment.asset_code, availability: equipment.availability }),
    JSON.stringify(after), now,
  ));
  await env.DB.batch(statements);
  return json({ availability: after }, {}, origin);
}

async function saveAdminEquipment(request, env, origin, routeAssetCode = null) {
  requireWriteOrigin(request, origin);
  const admin = await requireAdmin(request, env);
  const body = await readJsonBody(request);
  const creating = routeAssetCode === null;
  const assetCode = creating ? decodeAssetCode(requiredText(body, "assetCode", 20)) : routeAssetCode;
  const data = adminEquipmentInput(body);
  const publicAppUrl = env.PUBLIC_APP_URL || `${origin}/nfc-inventory/`;
  const placeholderPhotoUrl = new URL("assets/equipment-placeholder.svg", publicAppUrl).href;
  data.photoUrl ||= placeholderPhotoUrl;
  for (const component of data.components) component.photoUrl ||= placeholderPhotoUrl;
  const category = await env.DB.prepare(`
    SELECT id, asset_code_prefix
    FROM categories
    WHERE name = ?1 COLLATE NOCASE AND active = 1
    LIMIT 1
  `).bind(data.category).first();
  if (!category) throw new RequestError("category_not_found", "Active category not found", 404);
  if (!assetCode.toUpperCase().startsWith(`${category.asset_code_prefix.toUpperCase()}-`)) {
    throw new RequestError("invalid_asset_code", `Asset code must use the ${category.asset_code_prefix} category prefix`);
  }
  const existing = await env.DB.prepare(`
    SELECT id, asset_code, name
    FROM equipment
    WHERE asset_code = ?1 COLLATE NOCASE
    LIMIT 1
  `).bind(assetCode).first();
  if (creating && existing) throw new RequestError("asset_code_exists", "That asset code already exists", 409);
  if (!creating && !existing) throw new RequestError("equipment_not_found", "Equipment not found", 404);
  const equipmentId = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [];
  if (creating) {
    statements.push(env.DB.prepare(`
      INSERT INTO equipment (
        id, asset_code, name, category_id, item_type, manufacturer, model,
        serial_number, public_specifications, location, condition, lifecycle_status,
        purchase_date, purchase_price_minor, currency, supplier, public_notes,
        admin_notes, primary_photo_url, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)
    `).bind(
      equipmentId, assetCode.toUpperCase(), data.name, category.id, data.itemType,
      data.manufacturer, data.model, data.serialNumber, data.publicSpecifications,
      data.location, data.condition, data.lifecycleStatus, data.purchaseDate,
      data.purchasePriceMinor, data.currency, data.supplier, data.publicNotes,
      data.adminNotes, data.photoUrl, now,
    ));
  } else {
    statements.push(env.DB.prepare(`
      UPDATE equipment SET
        name = ?1, category_id = ?2, item_type = ?3, manufacturer = ?4,
        model = ?5, serial_number = ?6, public_specifications = ?7,
        location = ?8, condition = ?9, lifecycle_status = ?10,
        purchase_date = ?11, purchase_price_minor = ?12, currency = ?13,
        supplier = ?14, public_notes = ?15, admin_notes = ?16,
        primary_photo_url = ?17, record_version = record_version + 1,
        updated_at = ?18
      WHERE id = ?19
    `).bind(
      data.name, category.id, data.itemType, data.manufacturer, data.model,
      data.serialNumber, data.publicSpecifications, data.location, data.condition,
      data.lifecycleStatus, data.purchaseDate, data.purchasePriceMinor, data.currency,
      data.supplier, data.publicNotes, data.adminNotes, data.photoUrl, now, equipmentId,
    ));
    statements.push(env.DB.prepare("DELETE FROM bundle_components WHERE equipment_id = ?1").bind(equipmentId));
  }
  for (const component of data.components) {
    statements.push(env.DB.prepare(`
      INSERT INTO bundle_components (
        id, equipment_id, component_name, manufacturer, model, serial_number,
        quantity, required_on_return, notes, photo_url, display_order, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
    `).bind(
      component.id, equipmentId, component.name, component.manufacturer, component.model,
      component.serialNumber, component.quantity, component.requiredOnReturn ? 1 : 0,
      component.notes, component.photoUrl, component.displayOrder, now,
    ));
  }
  statements.push(env.DB.prepare(`
    INSERT INTO audit_events (
      id, actor_type, actor_name, action, entity_type, entity_id,
      before_json, after_json, created_at
    ) VALUES (?1, 'admin', ?2, ?3, 'equipment', ?4, ?5, ?6, ?7)
  `).bind(
    crypto.randomUUID(), admin.username, creating ? "equipment.created" : "equipment.updated",
    equipmentId, existing ? JSON.stringify({ assetCode: existing.asset_code, name: existing.name }) : null,
    JSON.stringify({ assetCode: assetCode.toUpperCase(), ...data, purchasePriceMinor: data.purchasePriceMinor }), now,
  ));
  await env.DB.batch(statements);
  return json({ equipment: { assetCode: assetCode.toUpperCase(), name: data.name }, created: creating }, { status: creating ? 201 : 200 }, origin);
}

function validUsername(value) {
  let username;
  try {
    username = decodeURIComponent(value);
  } catch {
    throw new RequestError("invalid_username", "Invalid member username");
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(username)) throw new RequestError("invalid_username", "Invalid member username");
  return username;
}

async function saveAdminMember(request, env, origin, routeUsername = null) {
  requireWriteOrigin(request, origin);
  const admin = await requireAdmin(request, env);
  const body = await readJsonBody(request);
  const creating = routeUsername === null;
  const username = creating ? validUsername(requiredText(body, "username", 80)) : routeUsername;
  const displayName = requiredText(body, "displayName", 150);
  const active = optionalBoolean(body, "active", true);
  const notes = optionalText(body, "notes", 1000);
  const existing = await env.DB.prepare(`
    SELECT id, display_name, active, notes FROM members WHERE username = ?1 COLLATE NOCASE LIMIT 1
  `).bind(username).first();
  if (creating && existing) throw new RequestError("username_exists", "That username already exists", 409);
  if (!creating && !existing) throw new RequestError("member_not_found", "Member not found", 404);
  const memberId = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const memberStatement = creating
    ? env.DB.prepare(`
        INSERT INTO members (id, username, display_name, active, notes, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      `).bind(memberId, username, displayName, active ? 1 : 0, notes, now)
    : env.DB.prepare(`
        UPDATE members SET display_name = ?1, active = ?2, notes = ?3, updated_at = ?4 WHERE id = ?5
      `).bind(displayName, active ? 1 : 0, notes, now, memberId);
  await env.DB.batch([
    memberStatement,
    env.DB.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_name, action, entity_type, entity_id,
        before_json, after_json, created_at
      ) VALUES (?1, 'admin', ?2, ?3, 'member', ?4, ?5, ?6, ?7)
    `).bind(
      crypto.randomUUID(), admin.username, creating ? "member.created" : "member.updated",
      memberId, existing ? JSON.stringify(existing) : null,
      JSON.stringify({ username, displayName, active, notes }), now,
    ),
  ]);
  return json({ member: { username, displayName, active }, created: creating }, { status: creating ? 201 : 200 }, origin);
}

async function replaceAdminLabel(request, env, origin) {
  requireWriteOrigin(request, origin);
  const admin = await requireAdmin(request, env);
  const body = await readJsonBody(request);
  const assetCode = decodeAssetCode(requiredText(body, "assetCode", 20));
  const notes = optionalText(body, "notes", 500);
  const equipment = await env.DB.prepare(`
    SELECT id, asset_code FROM equipment WHERE asset_code = ?1 COLLATE NOCASE LIMIT 1
  `).bind(assetCode).first();
  if (!equipment) throw new RequestError("equipment_not_found", "Equipment not found", 404);
  const tokenBytes = new Uint8Array(24);
  crypto.getRandomValues(tokenBytes);
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const tokenHint = token.slice(-6);
  const labelId = crypto.randomUUID();
  const now = new Date().toISOString();
  const publicAppUrl = env.PUBLIC_APP_URL || `${origin}/nfc-inventory/`;
  const scanUrl = new URL(`?t=${encodeURIComponent(token)}`, publicAppUrl).href;
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE nfc_labels SET status = 'replaced', retired_at = ?1
      WHERE equipment_id = ?2 AND status = 'active'
    `).bind(now, equipment.id),
    env.DB.prepare(`
      INSERT INTO nfc_labels (
        id, equipment_id, token_hash, token_hint, scan_url, status, notes, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)
    `).bind(labelId, equipment.id, tokenHash, tokenHint, scanUrl, notes, now),
    env.DB.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_name, action, entity_type, entity_id, after_json, created_at
      ) VALUES (?1, 'admin', ?2, 'nfc_label.replaced', 'nfc_label', ?3, ?4, ?5)
    `).bind(crypto.randomUUID(), admin.username, labelId, JSON.stringify({ assetCode: equipment.asset_code, tokenHint }), now),
  ]);
  return json({
    label: { id: labelId, assetCode: equipment.asset_code, tokenHint, scanUrl, createdAt: now },
  }, { status: 201 }, origin);
}

async function setAdminLabelWritten(request, env, origin, labelId) {
  requireWriteOrigin(request, origin);
  const admin = await requireAdmin(request, env);
  const body = await readJsonBody(request);
  const written = optionalBoolean(body, "written", null);
  if (written === null) throw new RequestError("invalid_body", "written must be true or false");
  const label = await env.DB.prepare(`
    SELECT label.id, label.status, label.written_at, label.written_by,
      equipment.asset_code
    FROM nfc_labels label
    JOIN equipment ON equipment.id = label.equipment_id
    WHERE label.id = ?1
    LIMIT 1
  `).bind(labelId).first();
  if (!label) throw new RequestError("nfc_label_not_found", "NFC label not found", 404);
  if (label.status !== "active") {
    throw new RequestError("nfc_label_inactive", "Only the active NFC label can be marked as written", 409);
  }
  const now = new Date().toISOString();
  const writtenAt = written ? now : null;
  const writtenBy = written ? admin.username : null;
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE nfc_labels
      SET written_at = ?1, written_by = ?2
      WHERE id = ?3 AND status = 'active'
    `).bind(writtenAt, writtenBy, label.id),
    env.DB.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_name, action, entity_type, entity_id,
        before_json, after_json, created_at
      ) VALUES (?1, 'admin', ?2, 'nfc_label.written_status_updated', 'nfc_label', ?3, ?4, ?5, ?6)
    `).bind(
      crypto.randomUUID(), admin.username, label.id,
      JSON.stringify({ assetCode: label.asset_code, writtenAt: label.written_at, writtenBy: label.written_by }),
      JSON.stringify({ assetCode: label.asset_code, writtenAt, writtenBy }), now,
    ),
  ]);
  return json({
    label: { id: label.id, assetCode: label.asset_code, written, writtenAt, writtenBy },
  }, {}, origin);
}

async function saveAdminProposal(request, env, origin, proposalId) {
  requireWriteOrigin(request, origin);
  const admin = await requireAdmin(request, env);
  const body = await readJsonBody(request);
  const status = enumText(body, "status", PROPOSAL_STATUSES);
  const selectedOptionId = optionalText(body, "selectedOptionId", 80);
  const receivedAssetCodeText = optionalText(body, "receivedAssetCode", 20);
  const receivedAssetCode = receivedAssetCodeText ? decodeAssetCode(receivedAssetCodeText) : null;
  const adminNotes = optionalText(body, "adminNotes", 2000);
  if (["ordered", "received"].includes(status) && !selectedOptionId) {
    throw new RequestError("invalid_body", "Select an equipment option before marking the proposal ordered or received");
  }
  if (status === "received" && !receivedAssetCode) {
    throw new RequestError("invalid_body", "receivedAssetCode is required when the proposal is received");
  }
  const existing = await env.DB.prepare(`
    SELECT id, title, status, selected_option_id, received_equipment_id, admin_notes
    FROM proposals
    WHERE id = ?1
    LIMIT 1
  `).bind(proposalId).first();
  if (!existing) throw new RequestError("proposal_not_found", "Proposal not found", 404);
  let selectedOption = null;
  if (selectedOptionId) {
    selectedOption = await env.DB.prepare(`
      SELECT id, name FROM proposal_options WHERE id = ?1 AND proposal_id = ?2 LIMIT 1
    `).bind(selectedOptionId, proposalId).first();
    if (!selectedOption) throw new RequestError("proposal_option_not_found", "Selected option does not belong to this proposal", 404);
  }
  let receivedEquipment = null;
  if (receivedAssetCode) {
    receivedEquipment = await env.DB.prepare(`
      SELECT id, asset_code FROM equipment WHERE asset_code = ?1 COLLATE NOCASE LIMIT 1
    `).bind(receivedAssetCode).first();
    if (!receivedEquipment) throw new RequestError("equipment_not_found", "Received equipment record not found", 404);
  }
  const now = new Date().toISOString();
  const after = {
    status,
    selectedOptionId: selectedOption?.id || null,
    selectedOptionName: selectedOption?.name || null,
    receivedAssetCode: receivedEquipment?.asset_code || null,
    adminNotes,
  };
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE proposals SET status = ?1, selected_option_id = ?2,
        received_equipment_id = ?3, admin_notes = ?4, updated_at = ?5
      WHERE id = ?6
    `).bind(status, selectedOption?.id || null, receivedEquipment?.id || null, adminNotes, now, proposalId),
    env.DB.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_name, action, entity_type, entity_id,
        before_json, after_json, created_at
      ) VALUES (?1, 'admin', ?2, 'proposal.updated', 'proposal', ?3, ?4, ?5, ?6)
    `).bind(crypto.randomUUID(), admin.username, proposalId, JSON.stringify(existing), JSON.stringify(after), now),
  ]);
  return json({ proposal: { id: proposalId, title: existing.title, ...after, updatedAt: now } }, {}, origin);
}

function parseAuditJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function getAdminOperationalExport(request, env, origin) {
  const admin = await requireAdmin(request, env);
  const [reservationsResult, checkoutsResult, auditResult, backupsResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT reservation.id, equipment.asset_code, member.username, member.display_name,
        reservation.starts_at, reservation.ends_at, reservation.can_share,
        reservation.sharing_notes, reservation.status, reservation.created_at,
        reservation.updated_at
      FROM reservations reservation
      JOIN equipment ON equipment.id = reservation.equipment_id
      JOIN members member ON member.id = reservation.member_id
      ORDER BY reservation.created_at DESC
    `),
    env.DB.prepare(`
      SELECT checkout.id, equipment.asset_code, member.username, member.display_name,
        checkout.checked_out_at, checkout.expected_return_at, checkout.returned_at,
        checkout.checkout_notes, checkout.return_notes, checkout.created_at,
        checkout.updated_at
      FROM checkouts checkout
      JOIN equipment ON equipment.id = checkout.equipment_id
      JOIN members member ON member.id = checkout.member_id
      ORDER BY checkout.created_at DESC
    `),
    env.DB.prepare(`
      SELECT id, actor_type, actor_name, action, entity_type, entity_id,
        before_json, after_json, created_at
      FROM audit_events
      ORDER BY created_at DESC
      LIMIT 10000
    `),
    env.DB.prepare(`
      SELECT id, status, storage_key, checksum, error_message, started_at, completed_at
      FROM backup_runs
      ORDER BY started_at DESC
      LIMIT 500
    `),
  ]);
  return json({
    exportedAt: new Date().toISOString(),
    exportedBy: admin.username,
    reservations: reservationsResult.results.map((row) => ({
      id: row.id, assetCode: row.asset_code, username: row.username,
      memberName: row.display_name, startsAt: row.starts_at, endsAt: row.ends_at,
      canShare: row.can_share === 1, sharingNotes: row.sharing_notes,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    checkouts: checkoutsResult.results.map((row) => ({
      id: row.id, assetCode: row.asset_code, username: row.username,
      memberName: row.display_name, checkedOutAt: row.checked_out_at,
      expectedReturnAt: row.expected_return_at, returnedAt: row.returned_at,
      checkoutNotes: row.checkout_notes, returnNotes: row.return_notes,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    auditEvents: auditResult.results.map((row) => ({
      id: row.id, actorType: row.actor_type, actorName: row.actor_name,
      action: row.action, entityType: row.entity_type, entityId: row.entity_id,
      before: parseAuditJson(row.before_json), after: parseAuditJson(row.after_json),
      createdAt: row.created_at,
    })),
    backupRuns: backupsResult.results.map((row) => ({
      id: row.id, status: row.status, storageKey: row.storage_key,
      checksum: row.checksum, errorMessage: row.error_message,
      startedAt: row.started_at, completedAt: row.completed_at,
    })),
  }, {}, origin);
}

async function findEquipmentAndMember(env, assetCode, username, memberId = null) {
  const memberStatement = memberId
    ? env.DB.prepare(`
      SELECT id, username, display_name
      FROM members
      WHERE username = ?1 COLLATE NOCASE AND id = ?2 AND active = 1
      LIMIT 1
    `).bind(username, memberId)
    : env.DB.prepare(`
      SELECT id, username, display_name
      FROM members
      WHERE username = ?1 COLLATE NOCASE AND active = 1
      LIMIT 1
    `).bind(username);
  const [equipmentResult, memberResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, asset_code, name, lifecycle_status, availability_override
      FROM equipment
      WHERE asset_code = ?1 COLLATE NOCASE
      LIMIT 1
    `).bind(assetCode),
    memberStatement,
  ]);
  const equipment = equipmentResult.results[0];
  const member = memberResult.results[0];
  if (!equipment) throw new RequestError("equipment_not_found", "Equipment not found", 404);
  if (!member) {
    throw new RequestError(
      "member_not_found",
      memberId ? "Selected member and username do not match an active member" : "Active member username not found",
      404,
    );
  }
  if (equipment.lifecycle_status !== "active") {
    throw new RequestError("equipment_unavailable", `Equipment is marked as ${equipment.lifecycle_status}`, 409);
  }
  if (equipment.availability_override === "not_unboxed") {
    throw new RequestError("equipment_not_unboxed", "Equipment has not yet been unboxed", 409);
  }
  return { equipment, member };
}

async function createReservation(request, env, assetCode, origin) {
  requireWriteOrigin(request, origin);
  const body = await readJsonBody(request);
  const memberId = requiredText(body, "memberId", 80);
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
  const { equipment, member } = await findEquipmentAndMember(env, assetCode, username, memberId);
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
          version: "0.13.0",
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

    if (request.method === "GET" && url.pathname === "/api/v1/proposals") {
      return await listProposals(env, allowedOrigin);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/proposals") {
      return await createProposal(request, env, allowedOrigin);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/login") {
      return await adminLogin(request, env, allowedOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/admin/session") {
      return await getAdminSession(request, env, allowedOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/admin/summary") {
      return await getAdminSummary(request, env, allowedOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/admin/data") {
      return await getAdminData(request, env, allowedOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/admin/export/operations") {
      return await getAdminOperationalExport(request, env, allowedOrigin);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/equipment") {
      return await saveAdminEquipment(request, env, allowedOrigin);
    }

    const adminAvailabilityMatch = /^\/api\/v1\/admin\/equipment\/([^/]+)\/availability$/.exec(url.pathname);
    if (request.method === "PUT" && adminAvailabilityMatch) {
      return await overrideAdminAvailability(
        request,
        env,
        allowedOrigin,
        decodeAssetCode(adminAvailabilityMatch[1]),
      );
    }

    const adminEquipmentMatch = /^\/api\/v1\/admin\/equipment\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && adminEquipmentMatch) {
      return await saveAdminEquipment(request, env, allowedOrigin, decodeAssetCode(adminEquipmentMatch[1]));
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/members") {
      return await saveAdminMember(request, env, allowedOrigin);
    }

    const adminMemberMatch = /^\/api\/v1\/admin\/members\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && adminMemberMatch) {
      return await saveAdminMember(request, env, allowedOrigin, validUsername(adminMemberMatch[1]));
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/labels") {
      return await replaceAdminLabel(request, env, allowedOrigin);
    }

    const adminLabelWrittenMatch = /^\/api\/v1\/admin\/labels\/([^/]+)\/written$/.exec(url.pathname);
    if (request.method === "PUT" && adminLabelWrittenMatch) {
      return await setAdminLabelWritten(
        request,
        env,
        allowedOrigin,
        decodeRecordId(adminLabelWrittenMatch[1], "NFC label"),
      );
    }

    const adminProposalMatch = /^\/api\/v1\/admin\/proposals\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && adminProposalMatch) {
      return await saveAdminProposal(
        request,
        env,
        allowedOrigin,
        decodeRecordId(adminProposalMatch[1], "proposal"),
      );
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
