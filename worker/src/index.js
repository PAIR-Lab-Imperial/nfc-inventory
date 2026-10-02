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
          version: "0.2.0",
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
      return listEquipment(env, url, allowedOrigin);
    }

    const equipmentMatch = /^\/api\/v1\/equipment\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && equipmentMatch) {
      let assetCode;
      try {
        assetCode = decodeURIComponent(equipmentMatch[1]);
      } catch {
        return errorResponse("invalid_asset_code", "Invalid equipment asset code", 400, allowedOrigin);
      }
      return getEquipment(env, assetCode, allowedOrigin);
    }

      return errorResponse("not_found", "Route not found", 404, allowedOrigin);
    } catch (error) {
      console.error("Inventory API request failed", error);
      return errorResponse("internal_error", "The inventory service is temporarily unavailable", 500, allowedOrigin);
    }
  },
};
