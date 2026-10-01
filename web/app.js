const status = document.querySelector("#connection-status");
const apiBaseUrl = window.NFC_INVENTORY_CONFIG?.apiBaseUrl?.replace(/\/$/, "");

if (!apiBaseUrl) {
  status.textContent = "The public site scaffold is ready. The API URL will be connected after the first Worker deployment.";
} else {
  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    status.textContent = data.ok
      ? "The inventory API is online."
      : "The inventory API responded but did not report a healthy state.";
  } catch {
    status.textContent = "The inventory API is temporarily unavailable.";
  }
}
