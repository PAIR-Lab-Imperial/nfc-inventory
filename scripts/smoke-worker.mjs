const baseUrl = process.argv[2]?.replace(/\/$/, "");

if (!baseUrl) {
  console.error("Usage: node scripts/smoke-worker.mjs <worker-base-url>");
  process.exit(2);
}

const checks = [
  {
    path: "/health",
    validate: (body) => body.ok === true && body.version === "0.2.0",
    summarize: (body) => ({ ok: body.ok, version: body.version }),
  },
  {
    path: "/api/v1",
    validate: (body) => body.status === "catalogue",
    summarize: (body) => ({ status: body.status }),
  },
  {
    path: "/api/v1/equipment",
    validate: (body) => body.count === 31 && body.items?.length === 31,
    summarize: (body) => ({ count: body.count, categories: body.categories?.length }),
  },
  {
    path: "/api/v1/equipment/ROB-003",
    validate: (body) => body.item?.assetCode === "ROB-003" && body.item.components?.length === 3,
    summarize: (body) => ({ assetCode: body.item?.assetCode, components: body.item?.components?.length }),
  },
];

for (const check of checks) {
  const { path } = check;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      Origin: "https://pair-lab-imperial.github.io",
    },
  });
  const body = await response.json();
  const allowOrigin = response.headers.get("access-control-allow-origin");
  const summary = check.summarize(body);
  console.log(JSON.stringify({ path, status: response.status, allowOrigin, summary }));
  if (!response.ok || allowOrigin !== "https://pair-lab-imperial.github.io" || !check.validate(body)) {
    process.exitCode = 1;
  }
}
