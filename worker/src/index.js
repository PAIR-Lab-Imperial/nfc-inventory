const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://pair-lab-imperial.github.io";

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
          version: "0.1.0",
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
          status: "foundation",
        },
        {},
        allowedOrigin,
      );
    }

    return json(
      { error: { code: "not_found", message: "Route not found" } },
      { status: 404 },
      allowedOrigin,
    );
  },
};
