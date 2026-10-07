const baseUrl = process.argv[2]?.replace(/\/$/, "");

if (!baseUrl) {
  console.error("Usage: node scripts/smoke-worker.mjs <worker-base-url>");
  process.exit(2);
}

const checks = [
  {
    path: "/health",
    validate: (body) => body.ok === true && body.version === "0.17.0",
    summarize: (body) => ({ ok: body.ok, version: body.version }),
  },
  {
    path: "/api/v1",
    validate: (body) => body.status === "catalogue" && body.features?.imageUploads === true,
    summarize: (body) => ({ status: body.status, imageUploads: body.features?.imageUploads }),
  },
  {
    path: "/api/v1/members",
    validate: (body) => Array.isArray(body.members) && body.members.length === 7,
    summarize: (body) => ({ members: body.members?.length }),
  },
  {
    path: "/api/v1/admin/summary",
    expectedStatus: 401,
    validate: (body) => body.error?.code === "admin_auth_required",
    summarize: (body) => ({ protected: body.error?.code }),
  },
  {
    path: "/api/v1/equipment",
    validate: (body) => body.count === 80 && body.items?.length === 80 && body.items.every((item) => item.photoUrl),
    summarize: (body) => ({ count: body.count, categories: body.categories?.length, photos: body.items?.filter((item) => item.photoUrl).length }),
  },
  {
    path: "/api/v1/equipment/ROB-005",
    validate: (body) => body.item?.assetCode === "ROB-005" && body.item.photoUrl && body.item.components?.length === 3 && body.item.components.every((item) => item.photoUrl && item.operationalStatus === "available"),
    summarize: (body) => ({ assetCode: body.item?.assetCode, components: body.item?.components?.length, componentPhotos: body.item?.components?.filter((item) => item.photoUrl).length, componentStatuses: body.item?.components?.map((item) => item.operationalStatus) }),
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
  const expectedStatus = check.expectedStatus ?? 200;
  if (response.status !== expectedStatus || allowOrigin !== "https://pair-lab-imperial.github.io" || !check.validate(body)) {
    process.exitCode = 1;
  }
}
