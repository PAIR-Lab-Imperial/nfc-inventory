const baseUrl = process.argv[2]?.replace(/\/$/, "");

if (!baseUrl) {
  console.error("Usage: node scripts/smoke-worker.mjs <worker-base-url>");
  process.exit(2);
}

for (const path of ["/health", "/api/v1"]) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      Origin: "https://pair-lab-imperial.github.io",
    },
  });
  const body = await response.json();
  const allowOrigin = response.headers.get("access-control-allow-origin");
  console.log(JSON.stringify({ path, status: response.status, allowOrigin, body }));
  if (!response.ok || allowOrigin !== "https://pair-lab-imperial.github.io") {
    process.exitCode = 1;
  }
}
