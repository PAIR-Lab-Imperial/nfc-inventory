const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(window.location.hostname);

window.NFC_INVENTORY_CONFIG = Object.freeze({
  // Public Worker URL only. Never put API keys or passwords in this file.
  apiBaseUrl: isLocalDevelopment
    ? "http://127.0.0.1:8787"
    : "https://pair-lab-nfc-inventory-api.pair-lab-nfc-inventory.workers.dev",
});
